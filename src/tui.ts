import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

export interface InteractivePromptContext {
  mainInput?: string;
  mainInputLabel?: string;
  systemPrompts?: string[];
}

export async function readInteractivePromptOpenTui(promptLabel: string, context?: InteractivePromptContext): Promise<string | null> {
  const tempDir = await mkdtemp(join(tmpdir(), 'openlap-opentui-'));
  const contextPath = join(tempDir, 'context.json');
  const outputPath = join(tempDir, 'result.json');
  const payload = {
    promptLabel,
    mainInput: context?.mainInput || '',
    mainInputLabel: context?.mainInputLabel || '',
    systemPrompts: context?.systemPrompts || [],
  };

  const cliPath = fileURLToPath(import.meta.url);
  const helperPath = resolve(dirname(cliPath), './opentui-input.js');
  await writeFile(contextPath, JSON.stringify(payload), 'utf8');

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn('bun', [helperPath, contextPath, outputPath], {
        stdio: 'inherit',
      });

      child.on('error', rejectPromise);
      child.on('close', code => {
        if (code === 0) {
          resolvePromise();
          return;
        }
        rejectPromise(new Error(`OpenTUI helper exited with code ${code ?? 'unknown'}.`));
      });
    });

    const raw = await readFile(outputPath, 'utf8');
    const parsed = JSON.parse(raw) as { value?: string | null };
    const value = typeof parsed.value === 'string' ? parsed.value.trim() : '';
    return value || null;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
