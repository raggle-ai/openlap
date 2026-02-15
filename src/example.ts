import { EXAMPLE_QUERIES } from './examples.js';

export function getExampleNames(): string[] {
  return Object.keys(EXAMPLE_QUERIES);
}

export function resolveExampleQuery(name: string): string {
  const prompt = EXAMPLE_QUERIES[name];
  if (!prompt) {
    throw new Error(`Unknown example "${name}". Use one of: ${getExampleNames().join(', ')}.`);
  }
  return prompt;
}
