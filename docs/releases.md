# Releases

## Public changes

For every user-facing change to `brickflow`, run:

```sh
bun run changeset
```

Select `brickflow`, choose the appropriate semantic version increment, and describe the change. Documentation, tests, and private-only refactors may omit a changeset when they do not affect the published package.

## Automated releases from `main`

After changes reach `main`, `release.yml` creates or updates a version pull request. Merge that pull request to publish the generated future version. Do not manually edit package versions.

## One-time 0.0.1 bootstrap

npm Trusted Publishing requires the npm package to exist before it can be configured. After the repository change is merged and CI passes, an authorized maintainer must run:

```sh
npm login
npm whoami
bun install --frozen-lockfile
bun run validate
cd packages/core
npm publish
```

Before publishing, verify all of the following:

- The active npm account is the intended account.
- `npm view brickflow version` still returns 404.
- The package manifest is exactly `brickflow@0.0.1`.
- Do not publish `0.0.0`, use `--force`, or store any npm credential in the repository or GitHub.

## Configure npm Trusted Publishing

Immediately after publishing `0.0.1`, configure the npm trusted publisher with these exact settings:

- Provider: GitHub Actions
- Owner: `yanncabral`
- Repository: `flow`
- Workflow: `release.yml`
- Environment: unset
- Allowed action: `npm publish`

## Publishing after bootstrap

Subsequent releases use GitHub Actions OIDC and npm provenance. Do not configure an `NPM_TOKEN`. Trusted-publisher identity or workflow mismatches fail safely instead of falling back to a stored credential.
