# Releasing openlap

## Preconditions

- `main` is green in GitHub Actions.
- npm Trusted Publisher is configured for `raggle-ai/openlap` and `.github/workflows/publish.yml`.

## Release steps

Quick path (recommended):

```bash
npm run release:patch
# or: npm run release:minor
# or: npm run release:major
```

Manual path:

1. Verify locally:

```bash
npm run lint
npm test
npm run build
```

2. Bump version (choose one):

```bash
npm version patch
# or: npm version minor
# or: npm version major
```

3. Push commit and tag:

```bash
git push origin main --follow-tags
```

4. Confirm workflow success:

- GitHub Actions `Publish` workflow completes.
- npm shows new version: `npm view openlap version`.

## Notes

- This repo currently publishes without npm provenance because the source repo is private.
- If the repository becomes public, switch publish command back to:

```bash
npm publish --provenance --access public
```
