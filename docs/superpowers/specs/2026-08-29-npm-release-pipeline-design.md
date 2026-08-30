# Brickflow npm Release Pipeline Design

## Status

**Decision:** publish the current core implementation as the single public npm package `brickflow`, starting at version `0.0.1`, through a Changesets-managed GitHub Actions release flow authenticated with npm Trusted Publishing (OIDC).

This design replaces the historical package-layout proposal where `brickflow` was a facade over a separately published `@brickflow/core`. The repository directory remains `packages/core`, but that directory produces the public `brickflow` package directly.

## Goals

- Make the current core API installable as `brickflow`.
- Publish only compiled ESM JavaScript and TypeScript declarations.
- Keep core runtime-neutral for Node.js, Bun, and modern bundlers.
- Use Changesets to collect release intent in feature pull requests.
- Create or update a version pull request after merges to `main`.
- Publish only when the Changesets version pull request is merged.
- Authenticate npm publication without a long-lived npm token.
- Reserve the `@brickflow/*` scope for future packages.

## Non-goals

- Publishing `@brickflow/core`.
- Publishing the placeholder OpenWorkflow or testing packages.
- Automatically publishing after every ordinary merge to `main`.
- Supporting CommonJS in the first release.
- Implementing a durable Worker or changing runtime behavior.
- Establishing API stability; version `0.0.1` remains experimental.

## Package identity and workspace structure

`packages/core` keeps its directory name because it remains Brickflow's engine-neutral architectural core. Its npm manifest changes from private `@brickflow/core` to public `brickflow`.

The public import becomes:

```ts
import { type Brick, brick, Layer } from 'brickflow'
```

Existing workspace consumers, examples, README snippets, and current architecture documentation must use `brickflow` instead of `@brickflow/core` when referring to the installable package.

The other packages remain private placeholders. Internal dependencies on the core package use `brickflow: workspace:*`. Future independently published packages may use names under `@brickflow/*`, but no additional package is made public by this work.

## Initial version

The first npm publication must be `brickflow@0.0.1`.

To preserve the normal Changesets flow, the implementation may keep the unreleased manifest at `0.0.0` and include an initial patch changeset. The first Changesets version pull request then changes the manifest and changelog to `0.0.1`; merging that pull request publishes `0.0.1`. The pipeline must not publish `0.0.0` or skip directly to `0.0.2`.

## Build and package artifact

The public package uses `tsup` rather than the current Bun-targeted bundle command. The build has one entry point, `src/index.ts`, and produces:

- ESM JavaScript targeting ES2022;
- a corresponding bundled TypeScript declaration entry point;
- source maps;
- a clean `dist` directory on every build.

The build is platform-neutral and must not target Bun. `ts-pattern` remains a normal runtime dependency and is external to the bundle so npm consumers receive it through standard dependency installation.

The published manifest exposes only generated files:

```json
{
  "name": "brickflow",
  "type": "module",
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts",
  "sideEffects": false
}
```

The exact declaration filename may follow `tsup`'s verified output, but the manifest and generated artifact must agree. Source files, tests, type-tests, and repository configuration must not be included in the tarball.

## Changesets workflow

Changesets is configured at the repository root. Pull requests that introduce a releasable public change add a changeset selecting `brickflow` and a semantic increment. Documentation-only or internal-only changes may omit one.

A GitHub Actions release workflow runs on pushes to `main` and follows the standard Changesets model:

1. Install dependencies from the lockfile.
2. Run the complete validation suite.
3. Invoke the official Changesets action.
4. If unreleased changesets exist, create or update one version pull request.
5. If the commit is the merge of that version pull request, build and publish `brickflow`.
6. Create the corresponding git tag and GitHub Release through the Changesets action.

Ordinary merges do not publish immediately. They contribute changesets to the version pull request. Publication occurs only after that version pull request is reviewed and merged.

The release command delegates version calculation to Changesets and npm publication to the npm CLI. Private workspace packages are excluded from publication.

## npm Trusted Publishing

The workflow uses npm Trusted Publishing with GitHub Actions OIDC. No `NPM_TOKEN`, automation token, or classic npm token is stored in GitHub.

The release job grants only the permissions needed by the flow:

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write
```

The job runs on a GitHub-hosted runner and installs a Node.js/npm version that supports npm Trusted Publishing. Bun remains the workspace package manager and test runner; npm is used for `npm pack` and `npm publish` because npm Trusted Publishing is an npm CLI capability.

The npm package settings must register the repository owner, repository name, and exact release workflow filename as a trusted publisher before the first publication. Publication includes npm provenance. If trusted-publisher configuration is absent or mismatched, publication must fail rather than fall back to a token.

## Validation and failure behavior

Both continuous integration and the release path validate the repository before publication:

```bash
bun run typecheck
bun test
bun run lint
bun run build
npm pack --dry-run
```

Packaging validation runs from `packages/core` so it inspects the actual `brickflow` package. A smoke test installs or imports the packed tarball from an isolated temporary consumer and verifies:

- ESM runtime import from `brickflow`;
- representative public exports such as `brick` and `Layer`;
- TypeScript resolution through the published declaration entry point;
- absence of a runtime or declaration dependency on the private name `@brickflow/core`.

Any install, validation, build, packing, OIDC, or npm publication failure stops the workflow. A failed release may be rerun after correcting the external configuration or repository state; the workflow must not synthesize a new version to work around a failed publication.

## Continuous integration

A separate CI workflow runs on pull requests and pushes to `main`. It installs dependencies with the frozen lockfile and executes typecheck, tests, lint, build, and package smoke validation. The release workflow repeats or depends on equivalent validation so npm publication can never proceed based solely on an earlier, mutable workflow result.

No requirement is introduced that every pull request must contain a changeset, because private refactors, tests, and documentation do not always require a release. Review is responsible for requiring a changeset when a public package change should be released.

## Documentation updates

The implementation updates current documentation without rewriting historical design records:

- root README installation and examples use `brickflow`;
- `examples/basic` imports and depends on `brickflow`;
- current architecture context identifies `packages/core` as the source directory for the public `brickflow` package;
- contributor-facing release documentation explains when to add a changeset and how the version pull request publishes;
- npm Trusted Publishing setup lists the exact workflow identity that must be configured on npm.

Older specifications remain historical and are not silently rewritten.

## Compatibility implications

This is a package-name migration before the first public release. Repository-local imports change from `@brickflow/core` to `brickflow`; no compatibility alias is published. Runtime Brick, Layer, Signal, Worker, and typed-failure behavior is unchanged.

The package remains ESM-only. Consumers require an ESM-capable runtime or bundler and a TypeScript/module resolver that understands package `exports`.

## Acceptance criteria

- The sole public workspace package is named `brickflow`.
- Its first successful npm publication is exactly `0.0.1`.
- `import { brick, Layer } from 'brickflow'` works from the packed artifact.
- Public declarations resolve without source files or `@brickflow/core`.
- The tarball contains only intended package metadata and `dist` artifacts.
- Pull request CI exercises typecheck, tests, lint, build, and packed-package validation.
- Merges containing changesets update one Changesets version pull request.
- Merging that version pull request publishes through npm Trusted Publishing with provenance.
- No npm token is required or configured by the workflow.
- Placeholder packages remain private and unpublished.
