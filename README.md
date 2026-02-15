<p align="center">
  <img src="./web/public/openlap-logo.svg" alt="openlap logo" width="260" />
</p>

<p align="center"><strong>Lap the request. Ship the result.</strong></p>

<p align="center">
  A lightweight CLI wrapper for OpenCode. Run prompts inline, from files, or from built-in examples,
  then continue in interactive OpenCode when you want to iterate.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openlap"><img src="https://img.shields.io/npm/v/openlap?style=flat-square" alt="npm version" /></a>
</p>

<p align="center">
  <a href="https://openlap.dev">Website</a>
  ·
  <a href="https://opencode.ai/docs/cli/">OpenCode Docs</a>
</p>

> Note: `openlap` is an independent community project related to OpenCode. It is **not** built by the OpenCode team and is **not** officially affiliated with OpenCode.

---

## Installation

Recommended (release artifact + PATH fix):

```bash
curl -fsSL https://openlap.dev/install.sh | bash -s -- --channel release --fix-path
```

Install from npm:

```bash
npm install -g openlap
```

Install from source:

```bash
npm install
npm run build
npm link
```

## Quick Start

```bash
# inline prompt
openlap "Review this repository for launch readiness"

# prompt from file
openlap --file ./prompt.md

# prompt from file with extra instruction
openlap --file ./prompt.md --instruction "Prioritize docs and tests"

# built-in examples
openlap --list-examples
openlap --example explain

# stdin / clipboard modes
echo "Audit security config" | openlap
openlap --copy

# CI-safe one-shot JSON output
openlap --no-interactive --output-format json-final --file ./prompt.md
```

## How It Works

- Choose one input source: inline text, `--file`, or `--example`
- Run once from terminal/scripts/CI
- In TTY terminals, `openlap` automatically hands off to interactive OpenCode for the same session

One-shot mode (no handoff):

```bash
openlap --no-interactive "Audit this repository and suggest refactors"
```

## JavaScript API

```ts
import lap from 'openlap';

await lap({
  promptFilePath: './prompt.md',
  cwd: process.cwd(),
  showToolOutput: true,
});
```

## Common Flags

- `--model <name>` set model id
- `--output-format <pretty|raw|json-events|json-final|jsonl>` set output shape
- `--show-tool-output` print tool output lines
- `--print-logs --log-level <DEBUG|INFO|WARN|ERROR>` include OpenCode logs
- `--thinking-models <csv>` and `--thinking-color <yellow|cyan|magenta|blue|gray>` style thinking output
- `--completions <bash|zsh|fish>` print shell completion script
- `--doctor` run environment diagnostics

Use `openlap --help` for the full option list.

## Configuration

Set defaults in either:

- `.openlap.json`
- `package.json` under `openlap`

Supported keys:

- `model`
- `thinking-models`
- `thinking-color`
- `no-interactive`

Environment variable overrides:

- `OPENLAP_MODEL`
- `OPENLAP_CWD`
- `OPENLAP_THINKING_MODELS`
- `OPENLAP_NO_INTERACTIVE`

## Development

```bash
npm install
npm run lint
npm run build
npm test
```

Useful scripts:

- `npm run dev` run CLI from source (`tsx src/cli.ts`)
- `npm run typecheck` run TypeScript checks only
- `npm run web` start website dev server
- `npm run release:patch|minor|major` bump version, tag, and push

Git hooks:

- `pre-commit`: runs `npm run check:precommit` (`lint`)
- `pre-push`: runs `npm run check:prepush` (`test` + `build`)

Release process:

- See `RELEASING.md` for version/tag/publish workflow.

## Website (`web/`)

This repo includes the Astro site used for `openlap.dev`.

```bash
npm run web:install
npm run web:dev
npm run web:build
npm run web:preview
```

Deploy to Cloudflare Pages:

```bash
npm run web:deploy
```

## Troubleshooting

- `openlap` not found: run `openlap --doctor` and verify your npm global bin is in `PATH`
- `opencode` not found: install/link OpenCode CLI so `opencode` is available
- Invalid `--file` or `--cwd`: verify paths exist and are accessible
