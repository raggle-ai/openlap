import { spawn } from 'child_process';
import { readFile } from 'fs/promises';

export interface RunOpencodeOptions {
  promptFilePath: string;
  instruction?: string;
  cwd?: string;
  model?: string;
  format?: OpencodeOutputFormat;
  formatJson?: boolean;
  prettyEvents?: boolean;
  showToolOutput?: boolean;
  printLogs?: boolean;
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  streamOutput?: boolean;
  onSessionId?: (sessionId: string) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  thinkingModels?: string[];
  thinkingColor?: ThinkingColor;
}

export type ThinkingColor = 'yellow' | 'cyan' | 'magenta' | 'blue' | 'gray';
export type OpencodeOutputFormat = 'pretty' | 'raw' | 'json-events' | 'json-final' | 'jsonl';

export async function runOpencode(options: RunOpencodeOptions): Promise<string> {
  const promptContent = await readFile(options.promptFilePath, 'utf-8');
  const cwd = options.cwd || process.cwd();
  const formatJson = options.formatJson ?? true;
  const prettyEvents = options.prettyEvents ?? true;
  const showToolOutput = options.showToolOutput ?? false;
  const printLogs = options.printLogs ?? false;
  const logLevel = options.logLevel ?? 'INFO';
  const streamOutput = options.streamOutput ?? true;

  const combinedPrompt = composePrompt(promptContent, options.instruction);

  return runOpencodeProcess({
    promptText: combinedPrompt,
    cwd,
    model: options.model,
    format: options.format,
    formatJson,
    prettyEvents,
    showToolOutput,
    printLogs,
    logLevel,
    streamOutput,
    onSessionId: options.onSessionId,
    onStdout: options.onStdout,
    onStderr: options.onStderr,
    thinkingModels: options.thinkingModels,
    thinkingColor: options.thinkingColor,
  });
}

export interface RunOpencodeProcessOptions {
  promptText: string;
  cwd: string;
  command?: string;
  spawnImpl?: typeof spawn;
  model?: string;
  format?: OpencodeOutputFormat;
  formatJson?: boolean;
  prettyEvents?: boolean;
  showToolOutput?: boolean;
  printLogs?: boolean;
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  streamOutput?: boolean;
  onSessionId?: (sessionId: string) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signalSource?: SignalSource;
  thinkingModels?: string[];
  thinkingColor?: ThinkingColor;
}

export interface SignalSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: (signal: NodeJS.Signals) => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', listener: (signal: NodeJS.Signals) => void): unknown;
}

const ANSI_GREEN = '\u001b[32m';
const ANSI_GRAY = '\u001b[90m';
const ANSI_RESET = '\u001b[0m';
const ENABLE_COLOR = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const TOOL_LINE_MAX_LENGTH = 140;
const THINKING_COLOR_ANSI: Record<ThinkingColor, string> = {
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  magenta: '\u001b[35m',
  blue: '\u001b[34m',
  gray: '\u001b[90m',
};

export function composePrompt(prompt: string, instruction?: string): string {
  return instruction ? `${prompt.trimEnd()}\n\n${instruction.trim()}\n` : prompt;
}

export function runOpencodeProcess(options: RunOpencodeProcessOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputFormat = resolveOutputFormat(options.format, options.formatJson, options.prettyEvents);
    const formatJson = outputFormat !== 'raw';
    const prettyEvents = outputFormat === 'pretty';
    const streamOutput = options.streamOutput ?? true;
    const signalSource = options.signalSource || process;
    const shouldCaptureRawStdout = !streamOutput || outputFormat !== 'pretty';
    const thinkingColor = THINKING_COLOR_ANSI[options.thinkingColor || 'yellow'];
    const highlightThinking = shouldHighlightThinking(options.model, options.thinkingModels);

    const args: string[] = [];

    if (options.printLogs) {
      args.push('--print-logs');
      args.push('--log-level', options.logLevel || 'DEBUG');
    }

    args.push('run');

    if (options.model) {
      args.push('-m', options.model);
    }

    if (formatJson) {
      args.push('--format', 'json');
    }

    const command = options.command || 'opencode';
    const spawnImpl = options.spawnImpl || spawn;
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutText = '';
    let stderrText = '';
    let stdoutBuffer = '';
    let sessionProbeBuffer = '';
    let sessionId: string | null = null;
    let sessionErrorMessage: string | null = null;
    const renderedOutputLines: string[] = [];

    const maybeEmitSessionId = (line: string) => {
      if (!formatJson || sessionId) {
        return;
      }

      try {
        const event = JSON.parse(line) as { sessionID?: string };
        if (event.sessionID && event.sessionID.trim()) {
          sessionId = event.sessionID;
          options.onSessionId?.(sessionId);
        }
      } catch {
        // Ignore malformed JSON lines while probing for session id.
      }
    };

    const consumeSessionProbeBuffer = (final = false) => {
      if (!formatJson || sessionId) {
        return;
      }

      let buffer = sessionProbeBuffer;
      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        maybeEmitSessionId(line);
        if (sessionId) {
          break;
        }
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
      }

      if (final && !sessionId && buffer.length > 0) {
        maybeEmitSessionId(buffer.replace(/\r$/, ''));
        buffer = '';
      }

      sessionProbeBuffer = sessionId ? '' : buffer;
    };

    const appendRenderedLine = (line: string) => {
      if (streamOutput && formatJson && prettyEvents) {
        renderedOutputLines.push(line);
      }
    };

    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    const cleanupSignalHandlers = () => {
      signalSource.off('SIGINT', forwardSignal);
      signalSource.off('SIGTERM', forwardSignal);
    };

    signalSource.on('SIGINT', forwardSignal);
    signalSource.on('SIGTERM', forwardSignal);

    const writePrettyEventLine = (line: string) => {
      if (!line.trim()) {
        return;
      }

      try {
        const event = JSON.parse(line) as {
          type?: string;
          part?: {
            text?: string;
            tool?: string;
            state?: { title?: string; input?: unknown; output?: unknown };
          };
          error?: { message?: string };
        };

        if (event.type === 'tool_use') {
          const lines = renderToolUseLines(event.part, options.showToolOutput ?? false);
          for (const renderedToolLine of lines) {
            appendRenderedLine(renderedToolLine);
            const renderedLine = ENABLE_COLOR ? `${ANSI_GRAY}${renderedToolLine}${ANSI_RESET}` : renderedToolLine;
            process.stdout.write(`${renderedLine}\n`);
          }

          return;
        }

        if (event.type === 'text') {
          const text = event.part?.text || '';
          if (!text.trim()) {
            return;
          }
          const lines = text.split(/\r?\n/);
          let inThinkingBlock = false;
          let sawThinkingContent = false;

          for (const textLine of lines) {
            const trimmed = textLine.trim();

            if (highlightThinking && isThinkingHeader(trimmed)) {
              inThinkingBlock = true;
              sawThinkingContent = false;
            }

            let useThinkingStyle = false;
            if (highlightThinking && inThinkingBlock) {
              if (trimmed) {
                useThinkingStyle = true;
                if (!isThinkingHeader(trimmed)) {
                  sawThinkingContent = true;
                }
              } else if (sawThinkingContent) {
                inThinkingBlock = false;
                sawThinkingContent = false;
              }
            }

            if (!textLine.trim()) {
              appendRenderedLine('');
              process.stdout.write('\n');
              continue;
            }
            appendRenderedLine(textLine);
            const renderedLine = ENABLE_COLOR
              ? useThinkingStyle
                ? `${thinkingColor}${textLine}${ANSI_RESET}`
                : `${ANSI_GREEN}${textLine}${ANSI_RESET}`
              : textLine;
            process.stdout.write(`${renderedLine}\n`);
          }
          return;
        }

        if (event.type === 'error') {
          const message = event.error?.message || 'opencode reported an error';
          sessionErrorMessage = message;
          process.stderr.write(`${message}\n`);
        }
      } catch {
        appendRenderedLine(line);
        process.stdout.write(`${line}\n`);
      }
    };

    const flushStdoutBuffer = (final = false) => {
      let buffer = stdoutBuffer;
      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        maybeEmitSessionId(line);
        if (prettyEvents && formatJson) {
          writePrettyEventLine(line);
        } else {
          process.stdout.write(`${line}\n`);
        }
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
      }

      if (final && buffer.length > 0) {
        maybeEmitSessionId(buffer.replace(/\r$/, ''));
        if (prettyEvents && formatJson) {
          writePrettyEventLine(buffer.replace(/\r$/, ''));
        } else {
          process.stdout.write(buffer);
        }
        buffer = '';
      }

      stdoutBuffer = buffer;
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      sessionProbeBuffer += text;
      consumeSessionProbeBuffer();
      if (shouldCaptureRawStdout) {
        stdoutText += text;
      }
      if (streamOutput) {
        stdoutBuffer += text;
        flushStdoutBuffer();
      }
      options.onStdout?.(text);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrText += text;
      if (streamOutput) {
        process.stderr.write(text);
      }
      options.onStderr?.(text);
    });

    child.on('error', error => {
      cleanupSignalHandlers();
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `Could not find "${command}" in PATH. Install OpenCode CLI from https://opencode.ai, then verify the binary is available (try: opencode --version, which opencode, or npm link).`,
          ),
        );
        return;
      }
      reject(error);
    });

    child.stdin.write(options.promptText);
    child.stdin.end();

    child.on('close', (code: number | null) => {
      cleanupSignalHandlers();
      if (streamOutput) {
        flushStdoutBuffer(true);
      }
      consumeSessionProbeBuffer(true);

      if (sessionErrorMessage) {
        reject(new Error(sessionErrorMessage));
        return;
      }

      if (!streamOutput && formatJson && prettyEvents) {
        const parsedErrorMessage = extractEventError(stdoutText);
        if (parsedErrorMessage) {
          reject(new Error(parsedErrorMessage));
          return;
        }
      }

      if (code === 0) {
        if (formatJson && prettyEvents) {
          if (streamOutput) {
            resolve(renderedOutputLines.join('\n').trim());
            return;
          }
          resolve(renderPrettyEventsToText(stdoutText, options.showToolOutput ?? false));
          return;
        }
        if (outputFormat === 'json-final') {
          resolve(renderJsonFinalOutput(stdoutText));
          return;
        }
        resolve(stdoutText.trim());
        return;
      }

      const detail = stderrText.trim();
      reject(new Error(detail ? `opencode exited with code ${code}: ${detail}` : `opencode exited with code ${code}`));
    });
  });
}

function resolveOutputFormat(
  explicitFormat: OpencodeOutputFormat | undefined,
  formatJson: boolean | undefined,
  prettyEvents: boolean | undefined,
): OpencodeOutputFormat {
  if (explicitFormat) {
    return explicitFormat;
  }
  const useJson = formatJson ?? true;
  if (!useJson) {
    return 'raw';
  }
  const usePrettyEvents = prettyEvents ?? true;
  return usePrettyEvents ? 'pretty' : 'json-events';
}

function renderPrettyEventsToText(rawOutput: string, showToolOutput: boolean): string {
  const renderedLines: string[] = [];
  const eventLines = rawOutput.split(/\r?\n/);

  for (const line of eventLines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as {
        type?: string;
        part?: {
          text?: string;
          tool?: string;
          state?: { title?: string; input?: unknown; output?: unknown };
        };
      };

      if (event.type === 'tool_use') {
        renderedLines.push(...renderToolUseLines(event.part, showToolOutput));

        continue;
      }

      if (event.type === 'text') {
        const text = event.part?.text || '';
        if (text.trim()) {
          renderedLines.push(text.trimEnd());
        }
      }
    } catch {
      renderedLines.push(line);
    }
  }

  return renderedLines.join('\n').trim();
}

function renderJsonFinalOutput(rawOutput: string): string {
  const events: unknown[] = [];
  const textParts: string[] = [];
  const toolResults: Array<{ tool: string; title?: string; input?: unknown; output?: unknown }> = [];

  for (const line of rawOutput.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as {
        type?: string;
        part?: {
          text?: string;
          tool?: string;
          state?: { title?: string; input?: unknown; output?: unknown };
        };
      };
      events.push(event);

      if (event.type === 'text' && event.part?.text?.trim()) {
        textParts.push(event.part.text.trimEnd());
      }

      if (event.type === 'tool_use') {
        toolResults.push({
          tool: event.part?.tool || 'tool',
          title: event.part?.state?.title,
          input: event.part?.state?.input,
          output: event.part?.state?.output,
        });
      }
    } catch {
      // Ignore malformed lines for json-final output.
    }
  }

  return JSON.stringify({
    text: textParts.join('\n').trim(),
    toolResults,
    events,
  });
}

function extractEventError(rawOutput: string): string | null {
  const eventLines = rawOutput.split(/\r?\n/);

  for (const line of eventLines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as {
        type?: string;
        error?: { message?: string };
      };

      if (event.type === 'error') {
        return event.error?.message || 'opencode reported an error';
      }
    } catch {
      // Ignore malformed lines while scanning for explicit error events.
    }
  }

  return null;
}

function renderToolUseLines(
  part: { tool?: string; state?: { title?: string; input?: unknown; output?: unknown } } | undefined,
  showToolOutput: boolean,
): string[] {
  const toolName = (part?.tool || 'tool').toLowerCase();
  const title = part?.state?.title || stringifyUnknown(part?.state?.input) || '';
  const prefix = `tool · ${toolName}${title ? ` ${title}` : ''}`;

  if (!showToolOutput) {
    return [collapseToMax(prefix, TOOL_LINE_MAX_LENGTH)];
  }

  const summary = summarizeToolOutputForInline(part?.tool, part?.state?.output);
  const singleLine = summary ? `${prefix} — ${summary}` : prefix;
  return [collapseToMax(singleLine, TOOL_LINE_MAX_LENGTH)];
}

function summarizeToolOutputForInline(tool: string | undefined, output: unknown): string {
  const normalizedTool = (tool || '').toLowerCase();
  const outputText = stringifyUnknown(output).trim();
  if (!outputText) {
    return '';
  }

  if (normalizedTool === 'glob') {
    const count = outputText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean).length;
    return `${count} path${count === 1 ? '' : 's'}`;
  }

  if (normalizedTool === 'read') {
    const parsed = parseTaggedToolOutput(outputText);
    const pathHint = parsed.path ? parsed.path.split('/').filter(Boolean).pop() : '';
    const contentCount = parsed.content
      ? parsed.content
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean).length
      : 0;
    if (pathHint && contentCount > 0) {
      return `${pathHint} (${contentCount} lines)`;
    }
    if (pathHint) {
      return pathHint;
    }
    if (contentCount > 0) {
      return `${contentCount} lines`;
    }
    const lineCount = outputText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean).length;
    if (lineCount > 0) {
      return `${lineCount} line${lineCount === 1 ? '' : 's'}`;
    }
    return 'loaded';
  }

  if (normalizedTool === 'bash') {
    const lines = outputText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const summaryLine = lines.find(line => /\bfiles changed\b|\binsertions?\(|\bdeletions?\(/i.test(line));
    if (summaryLine) {
      return summaryLine;
    }
    if (lines.length === 0) {
      return 'no output';
    }
    const first = lines[0] || '';
    return lines.length === 1 ? first : `${first} (+${lines.length - 1} more lines)`;
  }

  const normalizedText = outputText.replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return '';
  }

  const lineCount = outputText.split(/\r?\n/).filter(line => line.trim()).length;
  return lineCount > 1 ? `${collapseToMax(normalizedText, 90)} (${lineCount} lines)` : collapseToMax(normalizedText, 90);
}

function parseTaggedToolOutput(text: string): { path?: string; type?: string; content?: string } {
  const readTag = (name: string): string | undefined => {
    const pattern = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`);
    const match = text.match(pattern);
    return match?.[1]?.trim();
  };

  return {
    path: readTag('path'),
    type: readTag('type'),
    content: readTag('content'),
  };
}

function collapseToMax(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 3)}...`;
}

function shouldHighlightThinking(model: string | undefined, thinkingModels: string[] | undefined): boolean {
  if (!thinkingModels || thinkingModels.length === 0) {
    return false;
  }
  if (thinkingModels.includes('*')) {
    return true;
  }
  if (!model) {
    return false;
  }
  return thinkingModels.some(pattern => model === pattern || model.includes(pattern));
}

function isThinkingHeader(value: string): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.replace(/[*_]/g, '').trim().toLowerCase();
  return normalized === 'thinking:' || normalized === 'thinking';
}

function stringifyUnknown(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toTitleCaseWord(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
