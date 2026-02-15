export const EXAMPLE_QUERIES: Record<string, string> = {
  explain: 'Explain this repository architecture and list the critical entry points.',
  tests: 'Find the failing tests, fix the root cause, and explain the patch.',
  refactor: 'Refactor duplicated logic into a shared utility while preserving behavior.',
  docs: 'Generate concise usage docs for the CLI and include 3 practical examples.',
  review: 'Review the latest diff and call out risk areas and follow-up improvements.',
};

export function formatExamples(): string {
  const rows = Object.entries(EXAMPLE_QUERIES)
    .map(([name, prompt]) => `  - ${name}: ${prompt}`)
    .join('\n');

  return `Example queries:\n${rows}`;
}
