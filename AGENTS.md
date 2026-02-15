# AGENTS.md

## Mission
- Keep this repository easy for any LLM agent to operate by storing durable, high-signal instructions in this file.
- Treat `README.md` as human-facing product docs and `AGENTS.md` as agent-facing system memory.
- Optimize for reliable execution, low-risk changes, and quick orientation across sessions.

## Repository Map
- `src/`: TypeScript source for the CLI and runtime helpers (`cli.ts` entrypoint, `opencode.ts` process bridge, `tui.ts`/`opentui-input.ts` interactive input UI).
- `test/`: `tsx --test` suite for CLI parsing, opencode integration behavior, completions, and examples.
- `prompt-templates/`: reusable prompt templates plus usage guidance in `prompt-templates/README.md`.
- `example-prompts/`: concrete prompt examples used for local workflows.
- `web/`: Astro marketing/docs site for `openlap.dev` with independent lint/test/build scripts.
- `.github/workflows/`: CI (`ci.yml`) and release/publish (`publish.yml`) automation.
- `RELEASING.md`: canonical release process and preconditions.

## Execution Rules
- Use Node 18+ (`package.json` engines), npm scripts, and TypeScript-first edits; do not hand-edit build artifacts in `dist/`.
- For CLI behavior changes, verify both parser paths and runtime execution paths (inline prompt, file prompt, stdin/clipboard, optional interactive handoff).
- Respect config precedence for behavior-affecting changes: env vars (`OPENLAP_*`), then `.openlap.json`, then `package.json#openlap`, then CLI flags.
- Keep docs aligned with CLI surface whenever flags, defaults, or run modes change (`README.md`, templates, and relevant tests).

## Standard Workflows
- Local dev loop: `npm install`, `npm run lint`, `npm test`, `npm run build`.
- Run CLI from source: `npm run dev`.
- Validate generated binary flow: `npm run build` then `node dist/cli.js ...` (or `npm link` for global testing).
- Template-driven runs: `npm run team:review`, `npm run team:explain`, `npm run team:fix` and CI-safe `*:ci` variants.
- Web workflow (when touching `web/`): `npm --prefix ./web ci`, `npm --prefix ./web run lint`, `npm --prefix ./web run test`, `npm --prefix ./web run build`.
- Install-script workflow: validate `install.sh` behavior across `--channel release|stable|edge` and PATH-fix logic.

## Prompt and Memory Sources
- Read first: `README.md` for product behavior and user-facing command examples.
- Release details: `RELEASING.md` and `.github/workflows/publish.yml`.
- Prompt usage patterns: `prompt-templates/README.md` and files in `prompt-templates/*.md`.
- Automation quality gates: `.github/workflows/ci.yml`, `.husky/pre-commit`, `.husky/pre-push`.
- Persist only durable memory in `AGENTS.md`; avoid temporary task notes.

## Quality Gates
- Mandatory after every code change: run `npm run lint`, `npm test`, and `npm run build` before reporting completion.
- Preserve hook parity: pre-commit enforces lint; pre-push enforces test + build.
- For web-only changes, also run web checks (`lint`, `test`, `build`) in `web/`.
- Keep tests/docs in sync with behavior changes; do not ship flag or workflow changes without corresponding validation.

## Safety and Privacy Rules
- Never store or commit secrets; keep `.env`, key material, tokens, and local credential files out of tracked changes.
- Avoid destructive git/file operations unless explicitly requested.
- Prefer minimal, targeted edits that preserve existing conventions and compatibility.
- When documenting memory, redact sensitive identifiers and store only long-lived operational facts.

## Update Protocol
- When asked to create/update/audit `AGENTS.md`, scan repository sources (`README*`, workflows, scripts, configs, prompts) and then update with minimal churn.
- Remove stale or contradictory guidance; merge duplicates into single authoritative bullets.
- Keep language imperative and tool-agnostic so guidance works across LLM vendors and agent runtimes.
- Record only durable intelligence (workflows, conventions, architecture signals, constraints, critical paths).
- Exclude ephemeral branch state, debug output, temporary TODOs, and session-specific notes.
- Last updated: 2026-02-15.
