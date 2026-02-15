## Openlap Prompt Templates

Use these templates as a starting point for repo-specific prompts.

- `review.template.md`: code and architecture review requests
- `explain.template.md`: onboarding and architecture walkthrough requests
- `fix.template.md`: bug investigation and fix requests

### Placeholder guide

Replace placeholders with values from your repository context:

- `{{REPO_NAME}}`
- `{{TECH_STACK}}`
- `{{TARGET_PATHS}}`
- `{{CONSTRAINTS}}`
- `{{ENTRY_POINTS}}`
- `{{REPRO_STEPS}}`

### Recommended usage

1. Copy templates into a local `prompts/` directory.
2. Fill placeholders for your repo and current task.
3. Run local interactive commands (`team:review`, `team:explain`, `team:fix`) during development.
4. Run CI-friendly commands (`team:review:ci`, `team:explain:ci`, `team:fix:ci`) in automation.
