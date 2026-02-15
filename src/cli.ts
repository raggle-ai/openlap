#!/usr/bin/env node

import { stat, readFile } from 'fs/promises';
import { readFileSync, realpathSync } from 'fs';
import { dirname, resolve, delimiter } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { EXAMPLE_QUERIES, formatExamples } from './examples.js';
import { resolveExampleQuery } from './example.js';
import { getCompletionScript, isCompletionShell, type CompletionShell } from './completions.js';
import { composePrompt, runOpencode, runOpencodeProcess, type OpencodeOutputFormat } from './opencode.js';

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
  useClipboard: boolean;
  thinkingModels?: string[];
  thinkingColor: ThinkingColor;
}

interface CliConfig {
  model?: string;
  thinkingModels?: string[];
  thinkingColor?: ThinkingColor;
  noInteractive?: boolean;
}

interface CliEnvDefaults {
  model?: string;
  cwd?: string;
  thinkingModels?: string[];
  noInteractive?: boolean;
}

type CliAction = 'run' | 'help' | 'list-examples' | 'version' | 'completions' | 'doctor';

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

  return {
    model,
    thinkingModels,
    thinkingColor,
    noInteractive,
  };
}

function loadConfigFile(cwd: string): CliConfig {
  const openlapConfigPath = resolve(cwd, '.openlap.json');
  try {
    const raw = readFileSync(openlapConfigPath, 'utf8');
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

  return {
    model,
    cwd,
    thinkingModels,
    noInteractive,
  };
}

const HELP_TEXT = `openlap - request lapper for OpenCode CLI

Usage:
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

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const { action, options } = parsed;

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
      process.stderr.write('No prompt provided. Use --help for usage.\n');
      process.exitCode = 1;
      return;
    }
  }

  let sessionId: string | null = null;

  if (options.promptFilePath) {
    const promptPath = resolve(options.promptFilePath);
    await ensureFilePath(promptPath, '--file');
    const output = await runOpencode({
      promptFilePath: promptPath,
      instruction: options.instruction,
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
    const resolvedPath = resolve(options.promptText);
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

  const promptText = options.promptText as string;
  const fullPrompt = composePrompt(promptText, options.instruction);

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
    useClipboard: false,
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

    if (arg === '--copy' || arg === '-c') {
      options.useClipboard = true;
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
