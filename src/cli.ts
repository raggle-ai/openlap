#!/usr/bin/env node

import { stat, readFile, readdir } from 'fs/promises';
import { readFileSync, realpathSync } from 'fs';
import { dirname, resolve, delimiter, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createInterface } from 'readline/promises';
import { EXAMPLE_QUERIES, formatExamples } from './examples.js';
import { resolveExampleQuery } from './example.js';
import { getCompletionScript, isCompletionShell, type CompletionShell } from './completions.js';
import {
  composePrompt,
  runOpencode,
  runOpencodeProcess,
  type OpencodeOutputFormat,
  type QuestionPolicy,
  type RunTerminalState,
} from './opencode.js';
import {
  readInteractivePromptOpenTui,
  readPromptSelectionOpenTui,
  type InteractivePromptContext,
  type PromptTemplateChoice,
} from './tui.js';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type ThinkingColor = 'yellow' | 'cyan' | 'magenta' | 'blue' | 'gray';

interface CliOptions {
  promptFilePath?: string;
  promptText?: string;
  instruction?: string;
  cwd: string;
  model?: string;
  outputFormat: OpencodeOutputFormat;
  formatJson: boolean;
  prettyEvents: boolean;
  showToolOutput: boolean;
  printLogs: boolean;
  logLevel: LogLevel;
  streamOutput: boolean;
  launchInteractive: boolean;
  launchTui: boolean;
  useClipboard: boolean;
  forceInteractiveInput: boolean;
  statusJson: boolean;
  questionPolicy?: QuestionPolicy;
  questionDefaultAnswer?: string;
  thinkingModels?: string[];
  thinkingColor: ThinkingColor;
  promptSearchPaths?: string[];
}

interface CliConfig {
  model?: string;
  thinkingModels?: string[];
  thinkingColor?: ThinkingColor;
  noInteractive?: boolean;
  promptSearchPaths?: string[];
}

interface CliEnvDefaults {
  model?: string;
  cwd?: string;
  thinkingModels?: string[];
  noInteractive?: boolean;
  promptSearchPaths?: string[];
}

type CliAction = 'run' | 'help' | 'list-examples' | 'version' | 'completions' | 'doctor' | 'prompt';

export interface ParsedCli {
  action: CliAction;
  options: CliOptions;
  completionShell?: CompletionShell;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseThinkingModels(value: unknown, sourceLabel: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const models = value.map(item => String(item).trim()).filter(Boolean);
    return models.length > 0 ? models : undefined;
  }

  if (typeof value === 'string') {
    const models = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    return models.length > 0 ? models : undefined;
  }

  throw new Error(`Invalid Openlap config in ${sourceLabel}: "thinking-models" must be a string or string array.`);
}

function parseThinkingColor(value: unknown, sourceLabel: string): ThinkingColor | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'yellow' || value === 'cyan' || value === 'magenta' || value === 'blue' || value === 'gray') {
    return value;
  }

  throw new Error(`Invalid Openlap config in ${sourceLabel}: "thinking-color" must be one of yellow, cyan, magenta, blue, or gray.`);
}

function parseNoInteractive(value: unknown, sourceLabel: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  throw new Error(`Invalid Openlap config in ${sourceLabel}: "no-interactive" must be a boolean.`);
}

function parsePromptSearchPaths(value: unknown, sourceLabel: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    const entries = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    return entries.length > 0 ? entries : undefined;
  }

  if (Array.isArray(value)) {
    const entries = value
      .map(item => String(item).trim())
      .filter(Boolean);
    return entries.length > 0 ? entries : undefined;
  }

  throw new Error(`Invalid Openlap config in ${sourceLabel}: "prompt-search-paths" must be a string or string array.`);
}

function parseCliConfig(rawConfig: unknown, sourceLabel: string): CliConfig {
  if (!isRecord(rawConfig)) {
    throw new Error(`Invalid Openlap config in ${sourceLabel}: expected an object.`);
  }

  const model = typeof rawConfig.model === 'string' ? rawConfig.model : undefined;
  if (rawConfig.model !== undefined && model === undefined) {
    throw new Error(`Invalid Openlap config in ${sourceLabel}: "model" must be a string.`);
  }

  const thinkingModels = parseThinkingModels(rawConfig['thinking-models'] ?? rawConfig.thinkingModels, sourceLabel);
  const thinkingColor = parseThinkingColor(rawConfig['thinking-color'] ?? rawConfig.thinkingColor, sourceLabel);
  const noInteractive = parseNoInteractive(rawConfig['no-interactive'] ?? rawConfig.noInteractive, sourceLabel);
  const promptSearchPaths = parsePromptSearchPaths(
    rawConfig['prompt-search-paths'] ?? rawConfig.promptSearchPaths,
    sourceLabel,
  );

  return {
    model,
    thinkingModels,
    thinkingColor,
    noInteractive,
    promptSearchPaths,
  };
}

function loadConfigFile(cwd: string): CliConfig {
  const dotOpenlapConfigPath = resolve(cwd, '.openlap.json');
  try {
    const raw = readFileSync(dotOpenlapConfigPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parseCliConfig(parsed, '.openlap.json');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        throw new Error('Invalid Openlap config in .openlap.json: invalid JSON.');
      }
      throw error;
    }
  }

  const openlapConfigPath = resolve(cwd, 'openlap.json');
  try {
    const raw = readFileSync(openlapConfigPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parseCliConfig(parsed, 'openlap.json');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        throw new Error('Invalid Openlap config in openlap.json: invalid JSON.');
      }
      throw error;
    }
  }

  const packageJsonPath = resolve(cwd, 'package.json');
  try {
    const raw = readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.openlap === undefined) {
      return {};
    }
    return parseCliConfig(parsed.openlap, 'package.json#openlap');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new Error('Invalid package.json: invalid JSON.');
    }
    throw error;
  }
}

function parseEnvBoolean(value: string | undefined, variableName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid ${variableName}: use true/false, 1/0, yes/no, or on/off.`);
}

function loadEnvDefaults(baseCwd: string, env: NodeJS.ProcessEnv): CliEnvDefaults {
  const model = env.OPENLAP_MODEL?.trim() || undefined;
  const rawCwd = env.OPENLAP_CWD?.trim();
  const cwd = rawCwd ? resolve(baseCwd, rawCwd) : undefined;
  const thinkingModels = parseThinkingModels(env.OPENLAP_THINKING_MODELS, 'environment variable OPENLAP_THINKING_MODELS');
  const noInteractive = parseEnvBoolean(env.OPENLAP_NO_INTERACTIVE, 'OPENLAP_NO_INTERACTIVE');
  const promptSearchPaths = parsePromptSearchPaths(
    env.OPENLAP_PROMPT_SEARCH_PATHS,
    'environment variable OPENLAP_PROMPT_SEARCH_PATHS',
  );

  return {
    model,
    cwd,
    thinkingModels,
    noInteractive,
    promptSearchPaths,
  };
}

const HELP_TEXT = `openlap - request lapper for OpenCode CLI

Usage:
  openlap
  openlap prompt
  openlap "<prompt text>"
  echo "<prompt text>" | openlap
  openlap --file ./prompt.md --instruction "extra direction"
  openlap --copy
  openlap --example explain
  openlap --completions bash
  openlap --doctor

Options:
  -f, --file <path>       Read prompt text from a file
  -i, --instruction <txt> Append extra instruction to the prompt
  -m, --model <name>      OpenCode model id
  -C, --cwd <path>        Working directory for opencode run (default: current dir)
  -c, --copy              Read prompt from clipboard
      --launch-tui        Launch OpenCode TUI directly with combined prompt
      --input             Prompt for additional input and append it
      --example <name>    Use a built-in example query
      --list-examples     Show built-in examples
      --completions <sh>  Print completion script (bash|zsh|fish)
      --doctor            Run environment diagnostics
      --output-format <f> pretty|raw|json-events|json-final|jsonl
      --raw               Disable JSON output format
      --no-pretty         Disable pretty event rendering
      --show-tool-output  Print tool output lines
      --no-interactive    Skip launching interactive OpenCode after run
      --print-logs        Enable OpenCode logs
      --log-level <lvl>   DEBUG | INFO | WARN | ERROR
      --no-stream         Return only final output
      --status-json       Emit run-end status as JSON to stderr
      --question-policy   fail-fast|default-answer|abort for question tool in non-interactive runs
      --question-default-answer  Default answer text used when --question-policy=default-answer
      --thinking-models   CSV of models that get thinking highlight
      --thinking-color    yellow|cyan|magenta|blue|gray
  -v, --version           Show version
  -h, --help              Show help
`;

const VERSION_TEXT = getPackageVersion();

async function readClipboard(): Promise<string | null> {
  const candidates: Array<{ command: string; args: string[] }> = [];

  if (process.platform === 'darwin') {
    candidates.push({ command: 'pbpaste', args: [] });
  } else if (process.platform === 'win32') {
    candidates.push({ command: 'powershell', args: ['-NoProfile', '-Command', 'Get-Clipboard'] });
    candidates.push({ command: 'pwsh', args: ['-NoProfile', '-Command', 'Get-Clipboard'] });
    candidates.push({ command: 'clipboard.exe', args: [] });
  } else {
    candidates.push({ command: 'wl-paste', args: ['-n'] });
    candidates.push({ command: 'xclip', args: ['-selection', 'clipboard', '-o'] });
    candidates.push({ command: 'xsel', args: ['--clipboard', '--output'] });
  }

  for (const candidate of candidates) {
    const output = await runCommandCapture(candidate.command, candidate.args, 1200);
    if (output && output.trim()) {
      return output.trim();
    }
  }

  return null;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    const stats = await stat(filePath);
    if (stats.isFile()) {
      return readFile(filePath, 'utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

async function runCommandCapture(command: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let output = '';
    let timeoutId: NodeJS.Timeout | undefined;
    let settled = false;

    const finish = (result: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolvePromise(result);
    };

    timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      finish(null);
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      output += chunk.toString();
    });

    child.on('error', () => {
      finish(null);
    });

    child.on('close', code => {
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(output);
    });
  });
}

async function readStdinIfPiped(): Promise<string | null> {
  if (process.stdin.isTTY) {
    return null;
  }

  return new Promise(resolvePromise => {
    let data = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      const value = data.trim();
      resolvePromise(value ? value : null);
    });
    process.stdin.on('error', () => {
      resolvePromise(null);
    });
  });
}

async function readInteractivePrompt(promptLabel = 'Enter prompt: ', context?: InteractivePromptContext): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  try {
    return await readInteractivePromptOpenTui(promptLabel, context);
  } catch {
    // Fall back to readline when OpenTUI is unavailable.
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const firstLine = await rl.question(promptLabel);
    const trailingPastedInput = await captureTrailingPastedInput();
    const value = `${firstLine}${trailingPastedInput}`.trim();
    return value || null;
  } finally {
    rl.close();
  }
}

function showStatusLine(message: string): void {
  process.stderr.write(`[openlap] ${message}\n`);
}

function colorBeige(text: string): string {
  if (!process.stderr.isTTY) {
    return text;
  }
  return `\u001b[38;2;232;220;199m${text}\u001b[0m`;
}

function buildPreviewLines(text: string, maxLines = 2, maxLineChars = 120): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const sourceLines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  if (sourceLines.length === 0) {
    return [];
  }

  const previewLines = sourceLines.slice(0, maxLines).map(line => {
    if (line.length <= maxLineChars) {
      return line;
    }
    return `${line.slice(0, Math.max(1, maxLineChars - 3)).trimEnd()}...`;
  });

  if (sourceLines.length > maxLines && previewLines.length > 0) {
    const lastIndex = previewLines.length - 1;
    const last = previewLines[lastIndex];
    previewLines[lastIndex] = last.endsWith('...') ? last : `${last} ...`;
  }

  return previewLines;
}

function toInlinePreview(text: string, maxChars = 140): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '(none)';
  }
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function resolveQuestionPolicy(options: CliOptions): QuestionPolicy | undefined {
  if (options.questionPolicy) {
    return options.questionPolicy;
  }

  return options.launchInteractive ? undefined : 'fail-fast';
}

function composeQuestionPolicyInstruction(defaultAnswer?: string): string {
  const fallback = (defaultAnswer || 'Use the best reasonable default and continue without pausing for user input.').trim();
  return [
    'Non-interactive execution policy:',
    '- Do not call any question/ask-user tool.',
    `- If user input would normally be required, assume this default answer and continue: ${fallback}`,
  ].join('\n');
}

function applyQuestionPolicyPrompt(prompt: string, policy: QuestionPolicy | undefined, defaultAnswer?: string): string {
  if (policy !== 'default-answer') {
    return prompt;
  }

  return `${prompt.trimEnd()}\n\n${composeQuestionPolicyInstruction(defaultAnswer)}\n`;
}

function formatTerminalState(state: RunTerminalState): string {
  const base = `run ended: ${state.status}`;
  const details: string[] = [];
  if (state.tool) {
    details.push(`tool=${state.tool}`);
  }
  if (state.input) {
    details.push(`input=${toInlinePreview(state.input, 100)}`);
  }
  if (state.policy) {
    details.push(`policy=${state.policy}`);
  }
  if (state.message) {
    details.push(`reason=${toInlinePreview(state.message, 100)}`);
  }
  return details.length > 0 ? `${base} (${details.join(', ')})` : base;
}

function emitTerminalStateJson(state: RunTerminalState, sessionId: string | null): void {
  const payload = {
    type: 'openlap.run.terminal_state',
    sessionID: sessionId || undefined,
    status: state.status,
    tool: state.tool,
    input: state.input,
    policy: state.policy,
    message: state.message,
    time: new Date().toISOString(),
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

function showRunInputSummary(loadedPrompt: string, customInput: string): void {
  const promptLines = buildPreviewLines(loadedPrompt, 2, 120);
  if (promptLines.length > 0) {
    showStatusLine('loaded prompt:');
    for (const line of promptLines) {
      showStatusLine(`  ${colorBeige(line)}`);
    }
  }
  showStatusLine(`custom input: ${toInlinePreview(customInput, 140)}`);
}

async function readAdditionalInput(promptLabel = 'Append input: '): Promise<string | null> {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    showStatusLine('Waiting for additional input...');
    const value = await readInteractivePrompt(promptLabel);
    if (value) {
      showStatusLine(`Accepted additional input (${value.length} chars).`);
    }
    return value;
  }

  showStatusLine('Reading additional input from stdin...');
  const value = await readStdinIfPiped();
  if (value) {
    showStatusLine(`Accepted additional input (${value.length} chars).`);
  }
  return value;
}

export function appendAdditionalInput(basePrompt: string, additionalInput: string): string {
  return `${basePrompt.trimEnd()}\n\n---\n\nAdditional input:\n${additionalInput}`;
}

async function captureTrailingPastedInput(idleMs = 120): Promise<string> {
  if (!process.stdin.isTTY) {
    return '';
  }

  return new Promise(resolvePromise => {
    let data = '';
    let timeoutId: NodeJS.Timeout | undefined;

    const finish = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      process.stdin.off('data', onData);
      resolvePromise(data);
    };

    const scheduleFinish = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(finish, idleMs);
    };

    const onData = (chunk: Buffer | string) => {
      data += chunk.toString();
      scheduleFinish();
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
    scheduleFinish();
  });
}

function getPackageVersion(): string {
  try {
    const cliPath = fileURLToPath(import.meta.url);
    const packageJsonPath = resolve(dirname(cliPath), '../package.json');
    const packageJson = realpathSync(packageJsonPath);
    const raw = readFileSync(packageJson, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const PROMPT_TEMPLATE_ALIAS_PREFIX = '@prompt-templates/';
const PROMPT_TEMPLATE_ALIAS_DIR = '@prompt-templates';

function resolvePromptPathAlias(pathValue: string): string {
  const normalized = pathValue.replaceAll('\\', '/');
  if (!normalized.startsWith(PROMPT_TEMPLATE_ALIAS_PREFIX)) {
    return pathValue;
  }

  const templatePath = normalized.slice(PROMPT_TEMPLATE_ALIAS_PREFIX.length).trim();
  if (!templatePath || templatePath.includes('..')) {
    throw new Error('Invalid --file alias: use @prompt-templates/<template-file>.');
  }

  const packageRoot = getPackageRoot();
  return resolve(packageRoot, 'prompt-templates', templatePath);
}

function getPackageRoot(): string {
  const cliPath = fileURLToPath(import.meta.url);
  return resolve(dirname(cliPath), '..');
}

function resolvePromptSearchPathAlias(pathValue: string, cwd: string): string {
  const normalized = pathValue.replaceAll('\\', '/').trim();
  if (!normalized) {
    return cwd;
  }

  if (normalized === PROMPT_TEMPLATE_ALIAS_DIR || normalized === `${PROMPT_TEMPLATE_ALIAS_DIR}/`) {
    return resolve(getPackageRoot(), 'prompt-templates');
  }

  if (normalized.startsWith(PROMPT_TEMPLATE_ALIAS_PREFIX)) {
    const templatePath = normalized.slice(PROMPT_TEMPLATE_ALIAS_PREFIX.length).trim();
    if (templatePath.includes('..')) {
      throw new Error('Invalid prompt-search-paths alias: use @prompt-templates/<path>.');
    }
    return resolve(getPackageRoot(), 'prompt-templates', templatePath);
  }

  return resolve(cwd, pathValue);
}

function renderMarkdownForPromptPreview(markdownText: string): string {
  return markdownText
    .replace(/\r\n/g, '\n')
    .replace(/^```[\s\S]*?```$/gm, block => block.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function toPromptPreview(markdownText: string, maxLines = 8, maxChars = 700): string {
  const rendered = renderMarkdownForPromptPreview(markdownText);
  if (!rendered) {
    return '(No preview available)';
  }

  const sliced = rendered.slice(0, maxChars);
  const lines = sliced.split('\n');
  if (lines.length > maxLines) {
    return `${lines.slice(0, maxLines).join('\n')}\n...`;
  }
  if (rendered.length > maxChars) {
    return `${sliced}...`;
  }
  return sliced;
}

function toPromptTitle(markdownText: string, fallbackLabel: string): string {
  const heading = markdownText.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  const base = fallbackLabel.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  if (!base) {
    return 'Prompt';
  }
  return base
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function collectMarkdownPromptFiles(pathValue: string): Promise<string[]> {
  const entry = await stat(pathValue);
  if (entry.isFile()) {
    if (pathValue.toLowerCase().endsWith('.md')) {
      return [pathValue];
    }
    return [];
  }

  if (!entry.isDirectory()) {
    return [];
  }

  const collected: string[] = [];
  const stack: string[] = [pathValue];

  while (stack.length > 0) {
    const currentDir = stack.pop() as string;
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const item of entries) {
      const itemPath = resolve(currentDir, item.name);
      if (item.isDirectory()) {
        stack.push(itemPath);
        continue;
      }

      if (item.isFile() && item.name.toLowerCase().endsWith('.md')) {
        collected.push(itemPath);
      }
    }
  }

  return collected;
}

async function loadPromptChoices(searchPaths: string[] | undefined, cwd: string): Promise<PromptTemplateChoice[]> {
  if (!searchPaths || searchPaths.length === 0) {
    return [];
  }

  const files = new Set<string>();
  for (const searchPath of searchPaths) {
    const resolvedPath = resolvePromptSearchPathAlias(searchPath, cwd);
    let discovered: string[];
    try {
      discovered = await collectMarkdownPromptFiles(resolvedPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid prompt-search-paths entry "${searchPath}": ${message}. Use an existing markdown file or directory.`,
      );
    }
    for (const filePath of discovered) {
      files.add(filePath);
    }
  }

  const sortedFiles = Array.from(files).sort((a, b) => {
    const aName = basename(a).toLowerCase();
    const bName = basename(b).toLowerCase();
    if (aName !== bName) {
      return aName.localeCompare(bName);
    }
    return a.localeCompare(b);
  });
  const choices: PromptTemplateChoice[] = [];
  for (const filePath of sortedFiles) {
    const markdown = await readFile(filePath, 'utf8');
    const relativeLabel = filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath;
    choices.push({
      path: filePath,
      label: relativeLabel,
      title: toPromptTitle(markdown, basename(filePath)),
      preview: toPromptPreview(markdown),
    });
  }

  return choices;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const { action, options } = parsed;
  const hasInitialPromptSource = Boolean(options.promptText || options.promptFilePath);

    if (action === 'help') {
      process.stdout.write(HELP_TEXT);
      return;
    }

    if (action === 'list-examples') {
      process.stdout.write(`${formatExamples()}\n`);
      return;
    }

    if (action === 'version') {
      process.stdout.write(`${VERSION_TEXT}\n`);
      return;
    }

    if (action === 'completions') {
      if (!parsed.completionShell) {
        throw new Error('Missing completion shell. Use --completions bash|zsh|fish.');
      }
      process.stdout.write(`${getCompletionScript(parsed.completionShell)}\n`);
      return;
    }

    if (action === 'doctor') {
      const exitCode = await runDoctor();
      process.exitCode = exitCode;
      return;
    }

    if (action === 'prompt') {
      await ensureDirectoryPath(options.cwd, '--cwd');
      const promptChoices = await loadPromptChoices(options.promptSearchPaths, options.cwd);
      if (promptChoices.length === 0) {
        process.stderr.write(
          'No prompt templates found. Configure openlap.json with "prompt-search-paths" pointing to markdown files or directories.\n',
        );
        process.exitCode = 1;
        return;
      }
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stderr.write('Prompt selector requires a TTY terminal. Run `openlap --file <path>` in non-interactive environments.\n');
        process.exitCode = 1;
        return;
      }

      const selectedPromptPath = await readPromptSelectionOpenTui(promptChoices);
      if (!selectedPromptPath) {
        process.stderr.write('Prompt selection cancelled.\n');
        process.exitCode = 1;
        return;
      }

      const basePrompt = await readFile(selectedPromptPath, 'utf8');
      const customInput = await readInteractivePrompt('Append input: ', {
        mainInput: basePrompt,
        mainInputLabel: basename(selectedPromptPath),
        systemPrompts: options.instruction ? [options.instruction] : [],
      });

      options.promptText = customInput ? appendAdditionalInput(basePrompt, customInput) : basePrompt;
      options.promptFilePath = undefined;

      if (customInput) {
        showRunInputSummary(basePrompt, customInput);
      }
    }

    await ensureDirectoryPath(options.cwd, '--cwd');

    if (!options.promptText && !options.promptFilePath) {
      const pipedText = await readStdinIfPiped();
      if (pipedText) {
        options.promptText = pipedText;
      } else if (options.useClipboard) {
        const clipboardText = await readClipboard();
        if (clipboardText) {
          options.promptText = clipboardText;
        } else {
          process.stderr.write(
            'Clipboard is empty. Try one of: pass inline prompt text, use --file <path>, or pipe input (for example: echo "review this repo" | openlap).\n',
          );
          process.exitCode = 1;
          return;
        }
      } else {
        const typedPrompt = await readInteractivePrompt('Enter prompt: ', {
          mainInputLabel: 'interactive input',
          systemPrompts: options.instruction ? [options.instruction] : [],
        });
        if (typedPrompt) {
          options.promptText = typedPrompt;
        } else {
          process.stderr.write('No prompt provided. Pass prompt text, use --file, or pipe input.\n');
          process.exitCode = 1;
          return;
        }
      }
    }

    let sessionId: string | null = null;
    const effectiveQuestionPolicy = resolveQuestionPolicy(options);
    const onTerminalState = (state: RunTerminalState) => {
      showStatusLine(formatTerminalState(state));
      if (options.statusJson) {
        emitTerminalStateJson(state, sessionId);
      }
    };

    if (options.promptFilePath) {
      const promptPath = resolve(resolvePromptPathAlias(options.promptFilePath));
      await ensureFilePath(promptPath, '--file');

      if (options.forceInteractiveInput && hasInitialPromptSource) {
        const basePrompt = await readFile(promptPath, 'utf-8');
        const supplementalInput = process.stdin.isTTY && process.stdout.isTTY
          ? await readInteractivePrompt('Append input: ', {
              mainInput: basePrompt,
              mainInputLabel: basename(promptPath),
              systemPrompts: options.instruction ? [options.instruction] : [],
            })
          : await readAdditionalInput('Append input: ');
        if (!supplementalInput) {
          process.stderr.write('No additional input provided for --input. Provide it interactively or pipe it via stdin.\n');
          process.exitCode = 1;
          return;
        }

        const combinedPrompt = composePrompt(appendAdditionalInput(basePrompt, supplementalInput), options.instruction);
        const fullPrompt = applyQuestionPolicyPrompt(combinedPrompt, effectiveQuestionPolicy, options.questionDefaultAnswer);
        showRunInputSummary(basePrompt, supplementalInput);
        if (options.launchTui) {
          await launchTuiWithPrompt(options, fullPrompt);
          return;
        }

        showStatusLine('Starting OpenCode run');
        const output = await runOpencodeProcess({
          promptText: fullPrompt,
          cwd: options.cwd,
          model: options.model,
          format: options.outputFormat,
          formatJson: options.formatJson,
          prettyEvents: options.prettyEvents,
          showToolOutput: options.showToolOutput,
          printLogs: options.printLogs,
          logLevel: options.logLevel,
          streamOutput: options.streamOutput,
          thinkingModels: options.thinkingModels,
          thinkingColor: options.thinkingColor,
          questionPolicy: effectiveQuestionPolicy,
          questionDefaultAnswer: options.questionDefaultAnswer,
          onTerminalState,
          onSessionId: value => {
            sessionId = value;
          },
        });

        if (!options.streamOutput && output.trim()) {
          process.stdout.write(`${output}\n`);
        }

        await maybeLaunchInteractive(options, sessionId);
        return;
      }

      if (options.launchTui) {
        const basePrompt = await readFile(promptPath, 'utf8');
        const combinedPrompt = composePrompt(basePrompt, options.instruction);
        const fullPrompt = applyQuestionPolicyPrompt(combinedPrompt, effectiveQuestionPolicy, options.questionDefaultAnswer);
        await launchTuiWithPrompt(options, fullPrompt);
        return;
      }

      const output = await runOpencode({
        promptFilePath: promptPath,
        instruction:
          effectiveQuestionPolicy === 'default-answer'
            ? [options.instruction, composeQuestionPolicyInstruction(options.questionDefaultAnswer)].filter(Boolean).join('\n\n')
            : options.instruction,
        cwd: options.cwd,
        model: options.model,
        format: options.outputFormat,
        formatJson: options.formatJson,
        prettyEvents: options.prettyEvents,
        showToolOutput: options.showToolOutput,
        printLogs: options.printLogs,
        logLevel: options.logLevel,
        streamOutput: options.streamOutput,
        thinkingModels: options.thinkingModels,
        thinkingColor: options.thinkingColor,
        questionPolicy: effectiveQuestionPolicy,
        questionDefaultAnswer: options.questionDefaultAnswer,
        onTerminalState,
        onSessionId: value => {
          sessionId = value;
        },
      });

      if (!options.streamOutput && output.trim()) {
        process.stdout.write(`${output}\n`);
      }

      await maybeLaunchInteractive(options, sessionId);

      return;
    }

    if (options.promptText) {
      const resolvedPath = resolve(resolvePromptPathAlias(options.promptText));
      const fileContent = await readFileIfExists(resolvedPath);
      if (fileContent) {
        if (options.useClipboard) {
          const clipboardText = await readClipboard();
          if (clipboardText) {
            options.promptText = `${fileContent}\n\n---\n\nAdditional context from clipboard:\n${clipboardText}`;
          } else {
            options.promptText = fileContent;
          }
        } else {
          options.promptText = fileContent;
        }
      }
    }

    if (options.forceInteractiveInput && hasInitialPromptSource) {
      const basePromptText = options.promptText as string;
      const supplementalInput = process.stdin.isTTY && process.stdout.isTTY
        ? await readInteractivePrompt('Append input: ', {
            mainInput: basePromptText,
            mainInputLabel: 'inline prompt',
            systemPrompts: options.instruction ? [options.instruction] : [],
          })
        : await readAdditionalInput('Append input: ');
      if (!supplementalInput) {
        process.stderr.write('No additional input provided for --input. Provide it interactively or pipe it via stdin.\n');
        process.exitCode = 1;
        return;
      }
      options.promptText = appendAdditionalInput(basePromptText, supplementalInput);
      showRunInputSummary(basePromptText, supplementalInput);
      showStatusLine('Starting OpenCode run');
    }

    const promptText = options.promptText as string;
    const combinedPrompt = composePrompt(promptText, options.instruction);
    const fullPrompt = applyQuestionPolicyPrompt(combinedPrompt, effectiveQuestionPolicy, options.questionDefaultAnswer);

    if (options.launchTui) {
      await launchTuiWithPrompt(options, fullPrompt);
      return;
    }

    const output = await runOpencodeProcess({
      promptText: fullPrompt,
      cwd: options.cwd,
      model: options.model,
      format: options.outputFormat,
      formatJson: options.formatJson,
      prettyEvents: options.prettyEvents,
      showToolOutput: options.showToolOutput,
      printLogs: options.printLogs,
      logLevel: options.logLevel,
      streamOutput: options.streamOutput,
      thinkingModels: options.thinkingModels,
      thinkingColor: options.thinkingColor,
      questionPolicy: effectiveQuestionPolicy,
      questionDefaultAnswer: options.questionDefaultAnswer,
      onTerminalState,
      onSessionId: value => {
        sessionId = value;
      },
    });

    if (!options.streamOutput && output.trim()) {
      process.stdout.write(`${output}\n`);
    }

    await maybeLaunchInteractive(options, sessionId);
}

export function parseArgs(argv: string[], cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): ParsedCli {
  let action: CliAction = 'run';
  let inputMode: 'file' | 'example' | 'text' | null = null;
  const envDefaults = loadEnvDefaults(cwd, env);
  const configLookupCwd = envDefaults.cwd ?? cwd;
  const fileConfig = loadConfigFile(configLookupCwd);
  const options: CliOptions = {
    cwd: configLookupCwd,
    outputFormat: 'pretty',
    formatJson: true,
    prettyEvents: true,
    showToolOutput: false,
    printLogs: false,
    logLevel: 'INFO',
    streamOutput: true,
    launchInteractive: true,
    launchTui: false,
    useClipboard: false,
    forceInteractiveInput: false,
    statusJson: false,
    thinkingColor: 'cyan',
  };

  if (envDefaults.model) {
    options.model = envDefaults.model;
  }
  if (envDefaults.thinkingModels) {
    options.thinkingModels = envDefaults.thinkingModels;
  }
  if (envDefaults.noInteractive !== undefined) {
    options.launchInteractive = !envDefaults.noInteractive;
  }
  if (envDefaults.promptSearchPaths) {
    options.promptSearchPaths = envDefaults.promptSearchPaths;
  }

  if (fileConfig.model) {
    options.model = fileConfig.model;
  }
  if (fileConfig.thinkingModels) {
    options.thinkingModels = fileConfig.thinkingModels;
  }
  if (fileConfig.thinkingColor) {
    options.thinkingColor = fileConfig.thinkingColor;
  }
  if (fileConfig.noInteractive !== undefined) {
    options.launchInteractive = !fileConfig.noInteractive;
  }
  if (fileConfig.promptSearchPaths) {
    options.promptSearchPaths = fileConfig.promptSearchPaths;
  }

  const freeArgs: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      return { action: 'help', options };
    }

    if (arg === '--list-examples') {
      return { action: 'list-examples', options };
    }

    if (arg === '-v' || arg === '--version') {
      return { action: 'version', options };
    }

    if (arg === '--completions') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --completions');
      }
      if (!isCompletionShell(value)) {
        throw new Error('Invalid --completions shell. Use bash, zsh, or fish.');
      }
      return { action: 'completions', options, completionShell: value };
    }

    if (arg === '--doctor') {
      return { action: 'doctor', options };
    }

    if (arg === '--example') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --example');
      }
      if (inputMode && inputMode !== 'example') {
        throw new Error('Conflicting input: pass exactly one of --example, --file, or inline prompt text.');
      }
      i += 1;
      inputMode = 'example';
      options.promptText = resolveExampleQuery(value);
      continue;
    }

    if (arg === '-f' || arg === '--file') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --file');
      }
      if (inputMode && inputMode !== 'file') {
        throw new Error('Conflicting input: pass exactly one of --example, --file, or inline prompt text.');
      }
      i += 1;
      inputMode = 'file';
      options.promptFilePath = value;
      continue;
    }

    if (arg === '-i' || arg === '--instruction') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --instruction');
      }
      i += 1;
      options.instruction = value;
      continue;
    }

    if (arg === '-m' || arg === '--model') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --model');
      }
      i += 1;
      options.model = value;
      continue;
    }

    if (arg === '-C' || arg === '--cwd') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --cwd');
      }
      i += 1;
      options.cwd = resolve(value);
      continue;
    }

    if (arg === '--raw') {
      options.outputFormat = 'raw';
      options.formatJson = false;
      options.prettyEvents = false;
      continue;
    }

    if (arg === '--no-pretty') {
      options.prettyEvents = false;
      if (options.formatJson) {
        options.outputFormat = 'json-events';
      }
      continue;
    }

    if (arg === '--output-format') {
      const value = argv[i + 1] as OpencodeOutputFormat | undefined;
      if (!value) {
        throw new Error('Missing value for --output-format');
      }
      i += 1;
      if (!['pretty', 'raw', 'json-events', 'json-final', 'jsonl'].includes(value)) {
        throw new Error('Invalid --output-format. Use pretty, raw, json-events, json-final, or jsonl.');
      }
      options.outputFormat = value;

      if (value === 'raw') {
        options.formatJson = false;
        options.prettyEvents = false;
      } else if (value === 'pretty') {
        options.formatJson = true;
        options.prettyEvents = true;
      } else {
        options.formatJson = true;
        options.prettyEvents = false;
      }

      if (value === 'json-final') {
        options.streamOutput = false;
      }

      continue;
    }

    if (arg === '--show-tool-output') {
      options.showToolOutput = true;
      continue;
    }

    if (arg === '--print-logs') {
      options.printLogs = true;
      continue;
    }

    if (arg === '--no-interactive') {
      options.launchInteractive = false;
      continue;
    }

    if (arg === '--launch-tui') {
      options.launchTui = true;
      continue;
    }

    if (arg === '--copy' || arg === '-c') {
      options.useClipboard = true;
      continue;
    }

    if (arg === '--input') {
      options.forceInteractiveInput = true;
      continue;
    }

    if (arg === '--log-level') {
      const value = argv[i + 1] as LogLevel | undefined;
      if (!value) {
        throw new Error('Missing value for --log-level');
      }
      i += 1;
      if (!['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(value)) {
        throw new Error('Invalid --log-level. Use DEBUG, INFO, WARN, or ERROR.');
      }
      options.logLevel = value;
      continue;
    }

    if (arg === '--no-stream') {
      options.streamOutput = false;
      continue;
    }

    if (arg === '--status-json') {
      options.statusJson = true;
      continue;
    }

    if (arg === '--question-policy') {
      const value = argv[i + 1] as QuestionPolicy | undefined;
      if (!value) {
        throw new Error('Missing value for --question-policy');
      }
      i += 1;
      if (!['fail-fast', 'default-answer', 'abort'].includes(value)) {
        throw new Error('Invalid --question-policy. Use fail-fast, default-answer, or abort.');
      }
      options.questionPolicy = value;
      continue;
    }

    if (arg === '--question-default-answer') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --question-default-answer');
      }
      i += 1;
      options.questionDefaultAnswer = value;
      continue;
    }

    if (arg === '--thinking-models') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --thinking-models');
      }
      i += 1;
      options.thinkingModels = value
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === '--thinking-color') {
      const value = argv[i + 1] as ThinkingColor | undefined;
      if (!value) {
        throw new Error('Missing value for --thinking-color');
      }
      i += 1;
      if (!['yellow', 'cyan', 'magenta', 'blue', 'gray'].includes(value)) {
        throw new Error('Invalid --thinking-color. Use yellow, cyan, magenta, blue, or gray.');
      }
      options.thinkingColor = value;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    freeArgs.push(arg);
  }

  if (freeArgs.length > 0 && inputMode) {
    throw new Error('Conflicting input: pass exactly one of --example, --file, or inline prompt text.');
  }

  if (freeArgs.length === 1 && freeArgs[0] === 'prompt' && !inputMode) {
    action = 'prompt';
    return { action, options };
  }

  if (freeArgs.length > 0 && !options.promptText) {
    inputMode = 'text';
    options.promptText = freeArgs.join(' ');
  }

  return { action, options };
}

type DoctorStatus = 'ok' | 'warn' | 'fail';

interface DoctorCheck {
  label: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
}

function renderDoctorCheck(check: DoctorCheck): string {
  const prefix = check.status === 'ok' ? '[ok]' : check.status === 'warn' ? '[warn]' : '[fail]';
  const lines = [`${prefix} ${check.label}: ${check.detail}`];
  if (check.fix) {
    lines.push(`      fix: ${check.fix}`);
  }
  return lines.join('\n');
}

function hasPathEntry(target: string): boolean {
  const entries = (process.env.PATH || '').split(delimiter).filter(Boolean);
  return entries.includes(target);
}

async function runDoctor(): Promise<number> {
  const checks: DoctorCheck[] = [];

  checks.push({
    label: 'node',
    status: 'ok',
    detail: process.version,
  });

  const npmVersion = await runCommandCapture('npm', ['--version'], 2000);
  if (npmVersion) {
    checks.push({
      label: 'npm',
      status: 'ok',
      detail: npmVersion.trim(),
    });
  } else {
    checks.push({
      label: 'npm',
      status: 'fail',
      detail: 'not found in PATH',
      fix: 'Install Node.js/npm, then reopen your shell.',
    });
  }

  const npmPrefixRaw = await runCommandCapture('npm', ['config', 'get', 'prefix'], 2000);
  if (npmPrefixRaw) {
    const npmPrefix = npmPrefixRaw.trim();
    const npmBin = `${npmPrefix}/bin`;
    checks.push({
      label: 'npm global prefix',
      status: 'ok',
      detail: npmPrefix,
    });
    checks.push({
      label: 'npm global bin in PATH',
      status: hasPathEntry(npmBin) ? 'ok' : 'warn',
      detail: hasPathEntry(npmBin) ? npmBin : `${npmBin} is missing from PATH`,
      fix: hasPathEntry(npmBin) ? undefined : `Add: export PATH="${npmBin}:$PATH"`,
    });
  }

  const openlapVersion = await runCommandCapture('openlap', ['--version'], 2500);
  if (openlapVersion) {
    checks.push({
      label: 'openlap',
      status: 'ok',
      detail: `available (${openlapVersion.trim()})`,
    });
  } else {
    checks.push({
      label: 'openlap',
      status: 'fail',
      detail: 'not found in PATH',
      fix: 'Install with: curl -fsSL https://openlap.dev/install.sh | bash -s -- --fix-path',
    });
  }

  const opencodeVersion = await runCommandCapture('opencode', ['--version'], 2500);
  if (opencodeVersion) {
    checks.push({
      label: 'opencode',
      status: 'ok',
      detail: `available (${opencodeVersion.trim()})`,
    });
  } else {
    checks.push({
      label: 'opencode',
      status: 'fail',
      detail: 'not found in PATH',
      fix: 'Install/link OpenCode CLI so `opencode` is available.',
    });
  }

  process.stdout.write('openlap doctor\n\n');
  for (const check of checks) {
    process.stdout.write(`${renderDoctorCheck(check)}\n`);
  }

  const hasFailure = checks.some(check => check.status === 'fail');
  const hasWarning = checks.some(check => check.status === 'warn');
  if (hasFailure) {
    process.stdout.write('\nDoctor result: failed\n');
    return 1;
  }
  if (hasWarning) {
    process.stdout.write('\nDoctor result: warnings found\n');
    return 0;
  }
  process.stdout.write('\nDoctor result: healthy\n');
  return 0;
}

async function maybeLaunchInteractive(options: CliOptions, sessionId: string | null): Promise<void> {
  const isInsideOpenCodeUi = process.env.OPENCODE === '1';
  if (!options.launchInteractive || !process.stdin.isTTY || !process.stdout.isTTY || isInsideOpenCodeUi) {
    return;
  }

  const args = sessionId ? ['--session', sessionId] : ['--continue'];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('opencode', args, {
      cwd: options.cwd,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('close', code => {
      if (code === 0 || code === null) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`opencode interactive exited with code ${code}`));
    });
  });
}

async function launchTuiWithPrompt(options: CliOptions, fullPrompt: string): Promise<void> {
  const isInsideOpenCodeUi = process.env.OPENCODE === '1';
  if (!process.stdin.isTTY || !process.stdout.isTTY || isInsideOpenCodeUi) {
    throw new Error('`--launch-tui` requires a local TTY terminal outside OpenCode UI.');
  }

  const args: string[] = ['--prompt', fullPrompt];
  if (options.model) {
    args.push('-m', options.model);
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('opencode', args, {
      cwd: options.cwd,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('close', code => {
      if (code === 0 || code === null) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`opencode TUI exited with code ${code}`));
    });
  });
}

async function ensureDirectoryPath(pathValue: string, label: string): Promise<void> {
  try {
    const entry = await stat(pathValue);
    if (!entry.isDirectory()) {
      throw new Error(`Invalid ${label}: "${pathValue}" is not a directory. Use --cwd with a directory path you can access.`);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (error instanceof Error && error.message.startsWith(`Invalid ${label}:`)) {
      throw error;
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw new Error(
        `Invalid ${label}: permission denied for "${pathValue}". Use a directory you can access (for example: --cwd "${process.cwd()}").`,
      );
    }
    throw new Error(`Invalid ${label}: "${pathValue}" does not exist or is not accessible.`);
  }
}

async function ensureFilePath(pathValue: string, label: string): Promise<void> {
  try {
    const entry = await stat(pathValue);
    if (!entry.isFile()) {
      throw new Error(
        `Invalid ${label}: resolved path "${pathValue}" is not a file. Check that the --file path points to an existing readable file.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`Invalid ${label}:`)) {
      throw error;
    }
    throw new Error(
      `Invalid ${label}: resolved path "${pathValue}" was not found. Check that the --file path is correct and the file exists.`,
    );
  }
}

const entryPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : '';
const modulePath = realpathSync(fileURLToPath(import.meta.url));
if (entryPath === modulePath) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
