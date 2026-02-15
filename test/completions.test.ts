import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompletionScript } from '../src/completions.js';
import { getExampleNames } from '../src/example.js';

const expectedFlags = [
  '--file',
  '--instruction',
  '--model',
  '--cwd',
  '--copy',
  '--example',
  '--list-examples',
  '--completions',
  '--output-format',
  '--raw',
  '--no-pretty',
  '--show-tool-output',
  '--no-interactive',
  '--print-logs',
  '--log-level',
  '--no-stream',
  '--thinking-models',
  '--thinking-color',
  '--version',
  '--help',
];

for (const shell of ['bash', 'zsh', 'fish'] as const) {
  test(`completion script for ${shell} contains all flags and examples`, () => {
    const script = getCompletionScript(shell);
    for (const flag of expectedFlags) {
      if (shell === 'fish') {
        const longName = flag.startsWith('--') ? flag.slice(2) : flag;
        const escapedLongName = longName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (flag.startsWith('--')) {
          assert.match(script, new RegExp(`-l ${escapedLongName}`));
        } else {
          assert.match(script, new RegExp(`-s ${flag.slice(1)}`));
        }
      } else {
        assert.match(script, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
    for (const exampleName of getExampleNames()) {
      assert.match(script, new RegExp(exampleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
}
