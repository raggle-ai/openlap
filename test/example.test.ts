import test from 'node:test';
import assert from 'node:assert/strict';
import { getExampleNames, resolveExampleQuery } from '../src/example.js';

test('getExampleNames returns built-in names', () => {
  assert.deepEqual(getExampleNames(), ['explain', 'tests', 'refactor', 'docs', 'review']);
});

test('resolveExampleQuery returns prompt for known name', () => {
  assert.match(resolveExampleQuery('review'), /Review the latest diff/i);
});

test('resolveExampleQuery throws with valid options for unknown name', () => {
  assert.throws(
    () => resolveExampleQuery('unknown'),
    /Unknown example "unknown"\. Use one of: explain, tests, refactor, docs, review\./i,
  );
});
