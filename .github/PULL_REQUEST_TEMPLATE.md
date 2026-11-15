<!--
Keep this PR focused: one logical change. If it mixes a refactor with a fix,
split it. See CONTRIBUTING.md for the checks CI runs.
-->

## Summary

<!-- What changes, and why. Link the issue this closes. -->

Closes #

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal cleanup (no behaviour change)
- [ ] Documentation
- [ ] Desktop shell / packaging
- [ ] Browser extension
- [ ] CI, tooling or dependencies

## How this was verified

<!--
List what you actually ran or exercised. A green build alone is not enough for
behaviour changes — name the page, API route, or workflow you used.
-->

- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd extension && npm ci && npm run build && npm test` (extension changes)
- [ ] `npm run desktop:check && npm run desktop:test` (desktop changes)
- Manual check:

## Data and security impact

<!--
Reviewers look at these first. Tick "no impact" when that is genuinely true.
-->

- [ ] New or changed queries are scoped to the authenticated user; ids from the request are not
      trusted on their own
- [ ] No secrets, tokens, `.env` values or personal data added to code, logs, fixtures or
      screenshots
- [ ] Schema change includes a committed migration (never edits a shipped one)
- [ ] Untrusted job/page text stays data, never instructions or evidence about the user
- [ ] No impact on data handling, auth or storage

## UI changes

<!-- Required for user-visible changes: before/after screenshots, light and dark, narrow viewport. -->

## Release notes

<!-- One line for the changelog if users would notice this. "None" is fine. -->
