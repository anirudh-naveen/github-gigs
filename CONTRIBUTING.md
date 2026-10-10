# Contributing to github-gigs

Bug reports, fixes, and features are welcome. For anything bigger than a small fix,
please open an issue first so we can agree on the approach.

## Ground rules

- **Keep it general.** Anything specific to one community belongs in config (see
  [src/settings.js](src/settings.js)), not in code. AniLounge's own files live in
  `config/anilounge.json` and `docs/anilounge/`.
- **Keep the safety rules:**
  - every webhook is signature-checked,
  - text from issues is always posted with `allowed_mentions: { parse: [] }`,
  - private areas are never posted,
  - secrets are never logged.
- **GitHub stays the source of truth.** Changes on the Discord side, such as claims, are
  written back to GitHub. The bot never edits a post it didn't create.

## Before you open a pull request

```bash
npm test
```

If you change the server, the database, or the claim flows, also run the end-to-end
test against a throwaway Postgres (see the README's Development section).

Add or update tests for behaviour you change:
- [test/](test) has a file per module.
- `test/e2e.local.js` drives the real server.

In the PR, say what changed, why, and how you tested it.

## Security

Please don't open a public issue for a security problem. Use GitHub's private
vulnerability reporting on this repo instead.

## License

By contributing, you agree that your contribution is licensed under AGPL-3.0, like the
rest of the project.
