import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

interface HelperPayload {
  promptLabel?: string;
  mainInput?: string;
  mainInputLabel?: string;
  systemPrompts?: string[];
}

async function loadPackageVersion(): Promise<string> {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const pkgPath = resolve(dirname(currentFile), '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || 'dev';
  } catch {
    return 'dev';
  }
}

function buildPromptPreview(text: string, maxLines = 10, maxChars = 1800): string {
  const normalized = text.trim();
  if (!normalized) {
    return '(none)';
  }

  const sliced = normalized.slice(0, maxChars);
  const lines = sliced.split(/\r?\n/);
  if (lines.length > maxLines) {
    return `${lines.slice(0, maxLines).join('\n')}\n...`;
  }

  if (normalized.length > maxChars) {
    return `${sliced}...`;
  }

  return sliced;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

function renderMarkdownForPreview(markdownText: string): string {
  return markdownText
    .replace(/\r\n/g, '\n')
    .replace(/^```[\s\S]*?```$/gm, block => block.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '- ')
    .replace(/^\d+\.\s+/gm, match => match)
    .split('\n')
    .map(line => stripInlineMarkdown(line))
    .join('\n');
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function sourceNameFromLabel(sourceLabel: string): string {
  const fileName = basename(sourceLabel.trim());
  const withoutExt = fileName.replace(/\.[^.]+$/, '');
  const normalized = withoutExt.replace(/[-_]+/g, ' ').trim();
  if (!normalized) {
    return 'Prompt';
  }
  return toTitleCase(normalized);
}

function extractPromptTitle(_markdownText: string, sourceLabel: string): string {
  return sourceNameFromLabel(sourceLabel);
}

async function main(): Promise<void> {
  const contextPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!contextPath || !outputPath) {
    throw new Error('Missing helper arguments.');
  }

  const raw = await readFile(contextPath, 'utf8');
  const payload = JSON.parse(raw) as HelperPayload;
  const version = await loadPackageVersion();

  const opentui = (await import('@opentui/core')) as any;
  const createCliRenderer = opentui.createCliRenderer as (config?: Record<string, unknown>) => Promise<any>;
  const BoxRenderable = opentui.BoxRenderable as new (ctx: unknown, options: Record<string, unknown>) => any;
  const TextRenderable = opentui.TextRenderable as new (ctx: unknown, options: Record<string, unknown>) => any;
  const TextareaRenderable = opentui.TextareaRenderable as new (ctx: unknown, options: Record<string, unknown>) => any;

  const renderer = await createCliRenderer({
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: false,
    useConsole: false,
    useMouse: false,
    useAlternateScreen: true,
    backgroundColor: '#0a0d10',
  });

  renderer.root.flexDirection = 'column';
  renderer.root.padding = 1;

  const bodyRow = new BoxRenderable(renderer, {
    flexDirection: 'row',
    flexGrow: 1,
  });

  const contentColumn = new BoxRenderable(renderer, {
    flexDirection: 'column',
    flexGrow: 1,
  });

  const systemPromptText = (payload.systemPrompts || []).map(item => item.trim()).filter(Boolean).join('\n\n');
  const sourceLabel = payload.mainInputLabel?.trim() || 'none';
  const promptMarkdown = payload.mainInput || '';
  const hasPromptContext = Boolean(promptMarkdown.trim());
  const promptTitle = extractPromptTitle(promptMarkdown, sourceLabel);
  const renderedPromptText = renderMarkdownForPreview(promptMarkdown);

  const mainPanel = new BoxRenderable(renderer, {
    border: true,
    borderColor: '#3a4650',
    focusedBorderColor: '#5a7184',
    backgroundColor: '#0f1318',
    padding: 1,
    flexGrow: 1,
    title: 'Input',
    titleAlignment: 'left',
  });

  const textarea = new TextareaRenderable(renderer, {
    width: '100%',
    height: '100%',
    placeholder: 'Paste or type multiline input here...',
    wrapMode: 'word',
    backgroundColor: '#0b0f14',
    focusedBackgroundColor: '#0b0f14',
    textColor: '#e8dcc7',
    focusedTextColor: '#e8dcc7',
    placeholderColor: '#7f8c99',
  });
  mainPanel.add(textarea);

  const footerBox = new BoxRenderable(renderer, {
    backgroundColor: '#10263a',
    padding: 1,
    marginTop: 1,
    flexDirection: 'row',
  });

  const footerLeft = new BoxRenderable(renderer, {
    width: '17%',
    minWidth: 12,
  });
  const footerCenter = new BoxRenderable(renderer, {
    flexGrow: 1,
  });

  const footerInputLabel = new TextRenderable(renderer, {
    content: `openlap v${version}  input`,
    fg: '#d6e8f8',
  });

  const shortcutsLine = new TextRenderable(renderer, {
    content: 'keys: enter send  shft+enter nl  esc clr  ctrl+d send  cmd/ctrl+enter send  ctrl+c quit',
    fg: '#bcd0e3',
  });

  footerLeft.add(footerInputLabel);
  footerCenter.add(shortcutsLine);

  footerBox.add(footerLeft);
  footerBox.add(footerCenter);

  if (hasPromptContext) {
    const promptPreviewBox = new BoxRenderable(renderer, {
      border: true,
      borderColor: '#d8c3a5',
      backgroundColor: '#111418',
      padding: 1,
      marginBottom: 1,
      title: `Prompt: ${promptTitle}`,
      titleAlignment: 'left',
    });

    const promptPreview = buildPromptPreview(renderedPromptText, 2, 320);
    const previewContent = new TextRenderable(renderer, {
      content: promptPreview,
      fg: '#e8dcc7',
    });
    promptPreviewBox.add(previewContent);
    contentColumn.add(promptPreviewBox);
  }

  contentColumn.add(mainPanel);
  bodyRow.add(contentColumn);
  renderer.root.add(bodyRow);
  renderer.root.add(footerBox);

  textarea.focus();

  await new Promise<void>(resolvePromise => {
    let settled = false;

    const finish = async (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      renderer.keyInput.off('keypress', onKeyPress);
      renderer.destroy();
      await writeFile(outputPath, JSON.stringify({ value }), 'utf8');
      resolvePromise();
    };

    const onKeyPress = (key: { name: string; ctrl: boolean; meta: boolean; shift?: boolean; sequence?: string }) => {
      if (key.ctrl && key.name === 'c') {
        void finish(null);
        return;
      }

      if (key.name === 'escape') {
        const area = textarea as {
          plainText?: string;
          setValue?: (value: string) => void;
          setText?: (value: string) => void;
          setContent?: (value: string) => void;
          focus?: () => void;
        };
        if (typeof area.setValue === 'function') {
          area.setValue('');
        } else if (typeof area.setText === 'function') {
          area.setText('');
        } else if (typeof area.setContent === 'function') {
          area.setContent('');
        } else {
          area.plainText = '';
        }
        if (typeof area.focus === 'function') {
          area.focus();
        }
        return;
      }

      const isEnterKey = key.name === 'enter' || key.name === 'return';
      const isShiftEnter = isEnterKey && (Boolean(key.shift) || key.sequence === '\u001b[13;2u');
      const isSubmit = (key.ctrl && key.name === 'd') || ((key.ctrl || key.meta) && isEnterKey) || (isEnterKey && !isShiftEnter);
      if (isSubmit) {
        const value = textarea.plainText.trim();
        void finish(value || null);
      }
    };

    renderer.keyInput.on('keypress', onKeyPress);
    renderer.start();
  });
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[openlap] OpenTUI input failed: ${message}\n`);
  process.exitCode = 1;
});
