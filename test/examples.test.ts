import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_QUERIES, formatExamples } from '../src/examples.js';

test('EXAMPLE_QUERIES contains expected entries', () => {
  assert.deepEqual(Object.keys(EXAMPLE_QUERIES), ['explain', 'tests', 'refactor', 'docs', 'review']);
  assert.equal(EXAMPLE_QUERIES.explain, 'Explain this repository architecture and list the critical entry points.');
  assert.equal(EXAMPLE_QUERIES.tests, 'Find the failing tests, fix the root cause, and explain the patch.');
  assert.equal(EXAMPLE_QUERIES.refactor, 'Refactor duplicated logic into a shared utility while preserving behavior.');
  assert.equal(EXAMPLE_QUERIES.docs, 'Generate concise usage docs for the CLI and include 3 practical examples.');
  assert.equal(EXAMPLE_QUERIES.review, 'Review the latest diff and call out risk areas and follow-up improvements.');
});

test('formatExamples returns formatted string with all examples', () => {
  const output = formatExamples();
  assert.match(output, /^Example queries:\n/);
  assert.match(output, /- explain:/);
  assert.match(output, /- tests:/);
  assert.match(output, /- refactor:/);
  assert.match(output, /- docs:/);
  assert.match(output, /- review:/);
});

test('formatExamples formats each entry correctly', () => {
  const output = formatExamples();
  const lines = output.split('\n');
  assert.equal(lines[0], 'Example queries:');
  assert.equal(lines[1], '  - explain: Explain this repository architecture and list the critical entry points.');
  assert.equal(lines[2], '  - tests: Find the failing tests, fix the root cause, and explain the patch.');
});
