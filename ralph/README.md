<!-- LLM INSTRUCTION: This is a generic project description placeholder. Replace this entire section with specific details about the project you discover during analysis. Include: project purpose, tech stack, key directories, and any conventions you identify. -->

# Project Overview

**Replace this section** with a description of the actual project.

## Tech Stack

- Language: [Identify from package.json, go.mod, requirements.txt, etc.]
- Framework: [Identify from dependencies]
- Build Tool: [Identify build commands]

## Key Directories

| Directory | Purpose |
|-----------|---------|
| src/ | Source code |
| tests/ | Test files |

---

# Installation

## Local Development (Global CLI)

To use the `ralph` command globally:

```bash
# From the project root
bun link

# Now you can run ralph from anywhere
ralph
```

## Alternative: Direct Execution

```bash
# Run directly with bun
bun run ralph.ts

# Or
bun ralph.ts
```

---

# Ralph Configuration

## Files

| File | Purpose |
|------|---------|
| `prd.json` | Product requirements with user stories and references |
| `progress.txt` | Learning log, patterns, and discoveries |

## Quick Start

```bash
ralph 25        # Run 25 iterations
ralph           # Run default iterations
ralph suggest   # Get suggestions for next story
ralph init      # Initialize Ralph in current directory
ralph kb        # Manage knowledge base
```

**Prerequisites:** Bun >= 1.0.0

## PRD Structure

The `prd.json` file contains:

- **references**: Project-wide documentation links and file paths
- **userStories**: Tasks with acceptance criteria and contextual notes

### Reference Types

| Type | Use For |
|------|---------|
| `documentation` | README, guides, specs |
| `architecture` | System design docs, diagrams |
| `implementation` | Source code files |
| `dependency` | Package manifests, libs |
| `external` | URLs to external resources |

### User Story Notes

Each story can have typed notes linking to relevant files:

```json
"notes": [
  {"type": "implementation", "link": "src/feature.ts", "description": "..."},
  {"type": "reference", "link": "https://docs.example.com", "description": "..."}
]
```

## Workflow

1. Ralph reads `prd.json` for incomplete stories (`passes: false`)
2. Implements changes based on acceptance criteria
3. Updates `progress.txt` with patterns and discoveries
4. Commits locally (never pushes automatically)
