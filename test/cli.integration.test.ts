import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { delimiter } from 'path';
import { spawn } from 'child_process';

const cliPath = resolve(process.cwd(), 'dist/cli.js');

async function hasBuiltCli(): Promise<boolean> {
  try {
    const entry = await stat(cliPath);
    return entry.isFile();
  } catch {
    return false;
  }
}

async function runCli(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string; cwd?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: options.env,
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('close', code => {
      resolvePromise({ code, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

async function createMockOpencodeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openlap-opencode-'));
  const scriptPath = join(dir, 'opencode');
  const script = `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
});
process.stdin.on('end', () => {
  const text = input.trim();
  process.stdout.write(JSON.stringify({ type: 'text', part: { text: text ? 'ECHO:' + text : 'ECHO:EMPTY' } }) + '\\n');
});
`;
  await writeFile(scriptPath, script, 'utf8');
  await chmod(scriptPath, 0o755);
  return dir;
}

test('cli prints final output for --file --no-stream', async t => {
  if (!(await hasBuiltCli())) {
    t.skip('dist/cli.js not built');
    return;
  }

  const tmp = await mkdtemp(join(tmpdir(), 'openlap-cli-file-'));
  const mockDir = await createMockOpencodeDir();

  try {
    const promptPath = join(tmp, 'prompt.txt');
    await writeFile(promptPath, 'from file', 'utf8');

    const env = {
      ...process.env,
      PATH: `${mockDir}${delimiter}${process.env.PATH || ''}`,
    };

    const result = await runCli(['--no-stream', '--file', promptPath], { env });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /ECHO:from file/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await rm(mockDir, { recursive: true, force: true });
  }
});

test('cli uses piped stdin when prompt args are missing', async t => {
  if (!(await hasBuiltCli())) {
    t.skip('dist/cli.js not built');
    return;
  }

  const mockDir = await createMockOpencodeDir();

  try {
    const env = {
      ...process.env,
      PATH: `${mockDir}${delimiter}${process.env.PATH || ''}`,
    };

    const result = await runCli(['--no-stream'], { env, input: 'from stdin' });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /ECHO:from stdin/);
  } finally {
    await rm(mockDir, { recursive: true, force: true });
  }
});

test('cli fails fast for invalid --cwd path type', async t => {
  if (!(await hasBuiltCli())) {
    t.skip('dist/cli.js not built');
    return;
  }

  const tmp = await mkdtemp(join(tmpdir(), 'openlap-cli-cwd-'));

  try {
    const notDirectory = join(tmp, 'not-a-dir.txt');
    await writeFile(notDirectory, 'x', 'utf8');

    const result = await runCli(['--cwd', notDirectory, 'hello']);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid --cwd:/);
    assert.match(result.stderr, /not a directory/i);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('cli suggests fixes when --file path does not exist', async t => {
  if (!(await hasBuiltCli())) {
    t.skip('dist/cli.js not built');
    return;
  }

  const missingPath = resolve('definitely-missing-openlap-prompt.md');
  const result = await runCli(['--file', missingPath]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Invalid --file:/);
  assert.match(result.stderr, new RegExp(missingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stderr, /Check that the --file path is correct/i);
});

test('cli suggests alternatives when clipboard input is empty', async t => {
  if (!(await hasBuiltCli())) {
    t.skip('dist/cli.js not built');
    return;
  }

  const env = {
    ...process.env,
    PATH: '',
  };

  const result = await runCli(['--copy'], { env });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Clipboard is empty/i);
  assert.match(result.stderr, /use --file/i);
  assert.match(result.stderr, /pipe input/i);
});

test('cli suggests an accessible directory for permission-denied --cwd', async t => {
  if (!(await hasBuiltCli())) {
    t.skip('dist/cli.js not built');
    return;
  }

  const tmp = await mkdtemp(join(tmpdir(), 'openlap-cli-perms-'));
  const lockedParent = join(tmp, 'locked');
  const inaccessiblePath = join(lockedParent, 'nested');

  await mkdir(lockedParent);
  await chmod(lockedParent, 0o000);

  try {
    const result = await runCli(['--cwd', inaccessiblePath, 'hello']);

    if (!/permission denied/i.test(result.stderr)) {
      t.skip('Platform did not report EACCES for inaccessible cwd path');
      return;
    }

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid --cwd:/);
    assert.match(result.stderr, /Use a directory you can access/i);
  } finally {
    await chmod(lockedParent, 0o755);
    await rm(tmp, { recursive: true, force: true });
  }
});
