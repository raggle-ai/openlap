import { readFile, writeFile } from 'fs/promises';
import { basename } from 'path';

interface PromptChoice {
  path: string;
  label: string;
  title: string;
  preview: string;
}

interface HelperPayload {
  choices?: PromptChoice[];
}

function compactLabel(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function buildGridCell(label: string, isActive: boolean, width: number): string {
  const prefix = isActive ? '> ' : '  ';
  const padded = compactLabel(label, Math.max(1, width - prefix.length)).padEnd(Math.max(1, width - prefix.length), ' ');
  return `${prefix}${padded}`;
}

function clampIndex(value: number, maxExclusive: number): number {
  if (maxExclusive <= 0) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value >= maxExclusive) {
    return maxExclusive - 1;
  }
  return value;
}

async function main(): Promise<void> {
  const contextPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!contextPath || !outputPath) {
    throw new Error('Missing helper arguments.');
  }

  const raw = await readFile(contextPath, 'utf8');
  const payload = JSON.parse(raw) as HelperPayload;
  const choices = (payload.choices || []).filter(item => item && item.path && item.title);

  if (choices.length === 0) {
    await writeFile(outputPath, JSON.stringify({ value: null }), 'utf8');
    return;
  }

  const opentui = (await import('@opentui/core')) as any;
  const createCliRenderer = opentui.createCliRenderer as (config?: Record<string, unknown>) => Promise<any>;
  const BoxRenderable = opentui.BoxRenderable as new (ctx: unknown, options: Record<string, unknown>) => any;
  const TextRenderable = opentui.TextRenderable as new (ctx: unknown, options: Record<string, unknown>) => any;

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

  const titleBox = new BoxRenderable(renderer, {
    marginBottom: 1,
  });
  const titleText = new TextRenderable(renderer, {
    content: 'Choose Prompt',
    fg: '#e8dcc7',
  });
  const subtitleText = new TextRenderable(renderer, {
    content: 'Use arrows or h/j/k/l. Enter selects. Esc cancels.',
    fg: '#9db0c3',
  });
  titleBox.add(titleText);
  titleBox.add(subtitleText);

  const listPanel = new BoxRenderable(renderer, {
    border: true,
    borderColor: '#3a4650',
    backgroundColor: '#0f1318',
    padding: 1,
    width: '100%',
    marginBottom: 1,
    title: 'Templates (Grid)',
    titleAlignment: 'left',
  });

  const previewPanel = new BoxRenderable(renderer, {
    border: true,
    borderColor: '#d8c3a5',
    backgroundColor: '#111418',
    padding: 1,
    flexGrow: 1,
    title: 'Prompt Preview',
    titleAlignment: 'left',
  });

  const gridColumns = 2;
  const gridRows = Math.ceil(choices.length / gridColumns);
  const gridRowTexts: any[] = [];
  for (let rowIndex = 0; rowIndex < gridRows; rowIndex += 1) {
    const row = new TextRenderable(renderer, {
      content: '',
      fg: '#b5c6d6',
    });
    gridRowTexts.push(row);
    listPanel.add(row);
  }

  const previewText = new TextRenderable(renderer, {
    content: '',
    fg: '#d8c9b6',
  });

  previewPanel.add(previewText);

  renderer.root.add(titleBox);
  renderer.root.add(listPanel);
  renderer.root.add(previewPanel);

  let selectedIndex = 0;
  const fileNames = choices.map(choice => basename(choice.path));
  const widestFileName = fileNames.reduce((max, item) => Math.max(max, item.length), 0);
  const gridCellWidth = Math.max(18, Math.min(32, widestFileName + 2));

  const rerender = () => {
    for (let rowIndex = 0; rowIndex < gridRows; rowIndex += 1) {
      const row = gridRowTexts[rowIndex];
      const rowCells: string[] = [];
      for (let colIndex = 0; colIndex < gridColumns; colIndex += 1) {
        const itemIndex = rowIndex * gridColumns + colIndex;
        const choice = choices[itemIndex];
        if (!choice) {
          rowCells.push(' '.repeat(gridCellWidth + 2));
          continue;
        }
        const isActive = itemIndex === selectedIndex;
        const fileName = basename(choice.path);
        rowCells.push(buildGridCell(fileName, isActive, gridCellWidth + 2));
      }
      row.content = rowCells.join('  ');
      row.fg = '#b5c6d6';
      row.backgroundColor = undefined;
    }

    const selected = choices[selectedIndex];
    previewText.content = selected.preview || '(No preview available)';
  };

  rerender();

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

    const onKeyPress = (key: { name: string; ctrl: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        void finish(null);
        return;
      }

      if (key.name === 'escape') {
        void finish(null);
        return;
      }

      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = clampIndex(selectedIndex - gridColumns, choices.length);
        rerender();
        return;
      }

      if (key.name === 'down' || key.name === 'j') {
        selectedIndex = clampIndex(selectedIndex + gridColumns, choices.length);
        rerender();
        return;
      }

      if (key.name === 'left' || key.name === 'h') {
        selectedIndex = clampIndex(selectedIndex - 1, choices.length);
        rerender();
        return;
      }

      if (key.name === 'right' || key.name === 'l') {
        selectedIndex = clampIndex(selectedIndex + 1, choices.length);
        rerender();
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        void finish(choices[selectedIndex]?.path || null);
      }
    };

    renderer.keyInput.on('keypress', onKeyPress);
    renderer.start();
  });
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[openlap] OpenTUI prompt selector failed: ${message}\n`);
  process.exitCode = 1;
});
