import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendAdditionalInput, parseArgs } from '../src/cli.js';

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'openlap-cli-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('parseArgs returns help action', () => {
  const parsed = parseArgs(['--help']);
  assert.equal(parsed.action, 'help');
});

test('parseArgs help short-circuits later unknown flags', () => {
  const parsed = parseArgs(['--help', '--unknown-flag']);
  assert.equal(parsed.action, 'help');
});

test('parseArgs returns list-examples action', () => {
  const parsed = parseArgs(['--list-examples']);
  assert.equal(parsed.action, 'list-examples');
});

test('parseArgs list-examples short-circuits later unknown flags', () => {
  const parsed = parseArgs(['--list-examples', '--unknown-flag']);
  assert.equal(parsed.action, 'list-examples');
});

test('parseArgs returns version action', () => {
  const parsed = parseArgs(['--version']);
  assert.equal(parsed.action, 'version');
});

test('parseArgs returns completions action for supported shells', () => {
  const parsed = parseArgs(['--completions', 'fish']);
  assert.equal(parsed.action, 'completions');
  assert.equal(parsed.completionShell, 'fish');
});

test('parseArgs returns doctor action', () => {
  const parsed = parseArgs(['--doctor']);
  assert.equal(parsed.action, 'doctor');
});

test('parseArgs doctor short-circuits later unknown flags', () => {
  const parsed = parseArgs(['--doctor', '--unknown-flag']);
  assert.equal(parsed.action, 'doctor');
});

test('parseArgs requires a shell for --completions', () => {
  assert.throws(() => parseArgs(['--completions']), /Missing value for --completions/i);
});

test('parseArgs validates --completions shell value', () => {
  assert.throws(() => parseArgs(['--completions', 'powershell']), /Invalid --completions shell/i);
});

test('parseArgs supports inline prompt text', () => {
  const parsed = parseArgs(['review', 'this', 'repo']);
  assert.equal(parsed.action, 'run');
  assert.equal(parsed.options.promptText, 'review this repo');
  assert.equal(parsed.options.launchInteractive, true);
});

test('parseArgs allows disabling interactive handoff', () => {
  const parsed = parseArgs(['--no-interactive', 'review this repo']);
  assert.equal(parsed.options.launchInteractive, false);
});

test('parseArgs supports --input to append interactive input', () => {
  const parsed = parseArgs(['--file', './prompt.md', '--input']);
  assert.equal(parsed.options.forceInteractiveInput, true);
});

test('appendAdditionalInput combines base prompt and appended input', () => {
  const combined = appendAdditionalInput('Summarize the codebase.', 'Focus on src/cli.ts changes.');
  assert.equal(combined, 'Summarize the codebase.\n\n---\n\nAdditional input:\nFocus on src/cli.ts changes.');
});

test('appendAdditionalInput trims trailing whitespace from base prompt', () => {
  const combined = appendAdditionalInput('Prompt body.\n\n', 'Follow-up notes');
  assert.equal(combined, 'Prompt body.\n\n---\n\nAdditional input:\nFollow-up notes');
});

test('parseArgs supports example prompt', () => {
  const parsed = parseArgs(['--example', 'explain']);
  assert.match(parsed.options.promptText || '', /Explain this repository architecture/i);
});

test('parseArgs includes valid names for unknown example', () => {
  assert.throws(() => parseArgs(['--example', 'unknown']), /Use one of: explain, tests, refactor, docs, review\./i);
});

test('parseArgs rejects conflicting prompt text and file mode', () => {
  assert.throws(() => parseArgs(['--file', './prompt.md', 'inline text']), /pass exactly one of/i);
});

test('parseArgs rejects --example with --file', () => {
  assert.throws(() => parseArgs(['--example', 'explain', '--file', './prompt.md']), /pass exactly one of/i);
});

test('parseArgs rejects --example with inline prompt text', () => {
  assert.throws(() => parseArgs(['--example', 'explain', 'extra words']), /pass exactly one of/i);
});

test('parseArgs rejects invalid log level', () => {
  assert.throws(() => parseArgs(['--log-level', 'TRACE']), /Invalid --log-level/i);
});

test('parseArgs supports thinking highlight flags', () => {
  const parsed = parseArgs(['--thinking-models', 'openai/gpt-5.3-codex,opencode/big-pickle', '--thinking-color', 'magenta', 'hello']);
  assert.deepEqual(parsed.options.thinkingModels, ['openai/gpt-5.3-codex', 'opencode/big-pickle']);
  assert.equal(parsed.options.thinkingColor, 'magenta');
});

test('parseArgs supports --output-format json-final and disables streaming', () => {
  const parsed = parseArgs(['--output-format', 'json-final', 'hello']);
  assert.equal(parsed.options.outputFormat, 'json-final');
  assert.equal(parsed.options.streamOutput, false);
  assert.equal(parsed.options.formatJson, true);
  assert.equal(parsed.options.prettyEvents, false);
});

test('parseArgs supports --output-format jsonl', () => {
  const parsed = parseArgs(['--output-format', 'jsonl', 'hello']);
  assert.equal(parsed.options.outputFormat, 'jsonl');
  assert.equal(parsed.options.streamOutput, true);
  assert.equal(parsed.options.formatJson, true);
  assert.equal(parsed.options.prettyEvents, false);
});

test('parseArgs validates --output-format value', () => {
  assert.throws(() => parseArgs(['--output-format', 'xml']), /Invalid --output-format/i);
});

test('parseArgs rejects invalid thinking color', () => {
  assert.throws(() => parseArgs(['--thinking-color', 'orange']), /Invalid --thinking-color/i);
});

test('parseArgs loads defaults from .openlap.json', async () => {
  await withTempDir(async dir => {
    await writeFile(
      join(dir, '.openlap.json'),
      JSON.stringify({
        model: 'openai/gpt-5.3-codex',
        'thinking-models': ['opencode/big-pickle', 'openai/gpt-5.3-codex'],
        'thinking-color': 'magenta',
        'no-interactive': true,
      }),
      'utf8',
    );

    const parsed = parseArgs(['review this repo'], dir);
    assert.equal(parsed.options.model, 'openai/gpt-5.3-codex');
    assert.deepEqual(parsed.options.thinkingModels, ['opencode/big-pickle', 'openai/gpt-5.3-codex']);
    assert.equal(parsed.options.thinkingColor, 'magenta');
    assert.equal(parsed.options.launchInteractive, false);
  });
});

test('parseArgs loads defaults from package.json openlap config', async () => {
  await withTempDir(async dir => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        openlap: {
          model: 'opencode/small-model',
          thinkingModels: 'opencode/small-model,openai/gpt-5.3-codex',
          thinkingColor: 'blue',
          noInteractive: true,
        },
      }),
      'utf8',
    );

    const parsed = parseArgs(['review this repo'], dir);
    assert.equal(parsed.options.model, 'opencode/small-model');
    assert.deepEqual(parsed.options.thinkingModels, ['opencode/small-model', 'openai/gpt-5.3-codex']);
    assert.equal(parsed.options.thinkingColor, 'blue');
    assert.equal(parsed.options.launchInteractive, false);
  });
});

test('parseArgs prefers .openlap.json over package.json openlap config', async () => {
  await withTempDir(async dir => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        openlap: {
          model: 'opencode/from-package',
        },
      }),
      'utf8',
    );
    await writeFile(
      join(dir, '.openlap.json'),
      JSON.stringify({
        model: 'opencode/from-dotfile',
      }),
      'utf8',
    );

    const parsed = parseArgs(['review this repo'], dir);
    assert.equal(parsed.options.model, 'opencode/from-dotfile');
  });
});

test('parseArgs lets CLI flags override config defaults', async () => {
  await withTempDir(async dir => {
    await writeFile(
      join(dir, '.openlap.json'),
      JSON.stringify({
        model: 'opencode/default-model',
        'thinking-models': ['opencode/default-model'],
        'thinking-color': 'yellow',
        'no-interactive': true,
      }),
      'utf8',
    );

    const parsed = parseArgs(
      [
        '--model',
        'openai/gpt-5.3-codex',
        '--thinking-models',
        'openai/gpt-5.3-codex,opencode/big-pickle',
        '--thinking-color',
        'gray',
        'review this repo',
      ],
      dir,
    );

    assert.equal(parsed.options.model, 'openai/gpt-5.3-codex');
    assert.deepEqual(parsed.options.thinkingModels, ['openai/gpt-5.3-codex', 'opencode/big-pickle']);
    assert.equal(parsed.options.thinkingColor, 'gray');
    assert.equal(parsed.options.launchInteractive, false);
  });
});

test('parseArgs throws clear error for invalid config', async () => {
  await withTempDir(async dir => {
    await writeFile(join(dir, '.openlap.json'), '{', 'utf8');

    assert.throws(() => parseArgs(['review this repo'], dir), /Invalid Openlap config in \.openlap\.json: invalid JSON\./i);
  });
});

test('parseArgs loads defaults from OPENLAP_* environment variables', () => {
  const parsed = parseArgs(['review this repo'], process.cwd(), {
    OPENLAP_MODEL: 'openai/gpt-5.3-codex',
    OPENLAP_THINKING_MODELS: 'openai/gpt-5.3-codex,opencode/big-pickle',
    OPENLAP_NO_INTERACTIVE: 'true',
  });

  assert.equal(parsed.options.model, 'openai/gpt-5.3-codex');
  assert.deepEqual(parsed.options.thinkingModels, ['openai/gpt-5.3-codex', 'opencode/big-pickle']);
  assert.equal(parsed.options.launchInteractive, false);
});

test('parseArgs lets config override environment defaults', async () => {
  await withTempDir(async dir => {
    await writeFile(
      join(dir, '.openlap.json'),
      JSON.stringify({
        model: 'opencode/from-config',
        'thinking-models': ['opencode/from-config'],
        'no-interactive': false,
      }),
      'utf8',
    );

    const parsed = parseArgs(['review this repo'], dir, {
      OPENLAP_MODEL: 'opencode/from-env',
      OPENLAP_THINKING_MODELS: 'opencode/from-env,openai/gpt-5.3-codex',
      OPENLAP_NO_INTERACTIVE: 'true',
    });

    assert.equal(parsed.options.model, 'opencode/from-config');
    assert.deepEqual(parsed.options.thinkingModels, ['opencode/from-config']);
    assert.equal(parsed.options.launchInteractive, true);
  });
});

test('parseArgs lets CLI flags override config and environment defaults', async () => {
  await withTempDir(async dir => {
    await writeFile(
      join(dir, '.openlap.json'),
      JSON.stringify({
        model: 'opencode/from-config',
        'thinking-models': ['opencode/from-config'],
      }),
      'utf8',
    );

    const parsed = parseArgs(
      ['--model', 'opencode/from-cli', '--thinking-models', 'opencode/from-cli,openai/gpt-5.3-codex', 'review this repo'],
      dir,
      {
        OPENLAP_MODEL: 'opencode/from-env',
        OPENLAP_THINKING_MODELS: 'opencode/from-env,openai/gpt-5.3-codex',
      },
    );

    assert.equal(parsed.options.model, 'opencode/from-cli');
    assert.deepEqual(parsed.options.thinkingModels, ['opencode/from-cli', 'openai/gpt-5.3-codex']);
  });
});

test('parseArgs uses OPENLAP_CWD as default working directory', async () => {
  await withTempDir(async dir => {
    const projectDir = join(dir, 'project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(dir, '.openlap.json'),
      JSON.stringify({
        model: 'opencode/from-parent',
      }),
      'utf8',
    );
    await writeFile(
      join(dir, 'project', '.openlap.json'),
      JSON.stringify({
        model: 'opencode/from-env-cwd',
      }),
      'utf8',
    );

    const parsed = parseArgs(['review this repo'], dir, {
      OPENLAP_CWD: projectDir,
    });

    assert.equal(parsed.options.cwd, projectDir);
    assert.equal(parsed.options.model, 'opencode/from-env-cwd');
  });
});
