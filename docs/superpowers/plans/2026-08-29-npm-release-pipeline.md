# Brickflow npm Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the engine-neutral core as the ESM-only `brickflow` package, with a verified tsup artifact and a Changesets release pull request that publishes through npm Trusted Publishing.

**Architecture:** `packages/core` remains the source directory but becomes the only public workspace package. A focused package-check script packs that workspace and validates runtime exports, declaration resolution, and tarball boundaries. GitHub Actions separates pull-request CI from the main-branch Changesets release workflow, while both execute the same repository validation command.

**Tech Stack:** TypeScript 5.9, Bun workspaces and Bun test, tsup, Changesets, npm CLI, GitHub Actions, npm Trusted Publishing (OIDC)

---

## File map

- `package.json`: root Changesets commands, shared validation command, and release tooling dependencies.
- `bun.lock`: generated workspace package names and dependency versions.
- `packages/core/package.json`: public `brickflow` manifest and generated-file exports.
- `packages/core/tsup.config.ts`: platform-neutral ESM and declaration build configuration.
- `scripts/check-package.sh`: isolated tarball, runtime-import, type-resolution, and content validation.
- `.changeset/config.json`: Changesets behavior for the monorepo.
- `.github/workflows/ci.yml`: pull-request and main-branch validation.
- `.github/workflows/release.yml`: validated Changesets version-PR and OIDC publication flow.
- `docs/releases.md`: contributor and npm trusted-publisher setup instructions.
- `README.md`, `examples/basic/README.md`, `docs/architecture/agent-context.md`: current public package documentation.
- `examples/basic/package.json`, `examples/basic/src/index.ts`, `examples/code-agent/package.json`, `packages/engine-openworkflow/package.json`, `packages/testing/package.json`: workspace dependency migration from `@brickflow/core` to `brickflow`.

Historical specifications are not rewritten during implementation; the approved release design has already been amended separately to record the manual bootstrap decision.

### Task 1: Install release and build tooling

**Files:**
- Modify: `package.json`
- Modify: `bun.lock` (generated)

- [ ] **Step 1: Add the tooling dependencies and root commands**

Run:

```bash
bun add --dev @changesets/cli tsup
```

Then edit the root scripts in `package.json` to include these commands while retaining the existing commands:

```json
{
  "scripts": {
    "build": "bun run --filter './packages/*' build",
    "changeset": "changeset",
    "clean": "rm -rf packages/*/dist examples/*/dist coverage",
    "format": "biome format --write .",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "package:check": "bash scripts/check-package.sh",
    "prepare": "husky",
    "release": "bun run build && changeset publish",
    "test": "bun test",
    "typecheck": "bun run --filter '*' typecheck",
    "validate": "bun run typecheck && bun test && bun run lint && bun run build && bun run package:check",
    "version-packages": "changeset version && bun install"
  }
}
```

Do not hand-edit `bun.lock`; `bun add` generates it.

- [ ] **Step 2: Verify the CLIs are installed**

Run:

```bash
bunx changeset --version
bunx tsup --version
```

Expected: both commands print versions and exit with status 0.

- [ ] **Step 3: Commit the tooling setup**

```bash
git add package.json bun.lock
git commit -m "build: add release tooling"
```

### Task 2: Add a failing packed-package contract check

**Files:**
- Create: `scripts/check-package.sh`

- [ ] **Step 1: Create the package-check script**

Create `scripts/check-package.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

pack_dir="$work_dir/pack"
consumer_dir="$work_dir/consumer"
mkdir -p "$pack_dir" "$consumer_dir"

pack_json="$(npm pack "$repo_root/packages/core" --pack-destination "$pack_dir" --json)"
tarball_name="$(node -e "const value = JSON.parse(process.argv[1]); process.stdout.write(value[0].filename)" "$pack_json")"
tarball="$pack_dir/$tarball_name"

node - "$pack_json" <<'NODE'
const pack = JSON.parse(process.argv[2])[0]
const files = pack.files.map(({ path }) => path).sort()
const allowed = files.every(
  (path) => path === 'package.json' || path === 'README.md' || path.startsWith('dist/'),
)
if (!allowed) {
  throw new Error(`Unexpected files in tarball:\n${files.join('\n')}`)
}
for (const required of ['dist/index.js', 'dist/index.d.ts', 'package.json']) {
  if (!files.includes(required)) {
    throw new Error(`Missing ${required} in tarball`)
  }
}
NODE

cat > "$consumer_dir/package.json" <<EOF
{
  "name": "brickflow-package-smoke-test",
  "private": true,
  "type": "module",
  "dependencies": {
    "brickflow": "file:$tarball"
  }
}
EOF

npm install --prefix "$consumer_dir" --ignore-scripts --no-audit --no-fund

cat > "$consumer_dir/runtime.mjs" <<'EOF'
import { Layer, brick } from 'brickflow'

if (typeof brick !== 'function' || typeof Layer !== 'function') {
  throw new Error('brickflow runtime exports are unavailable')
}
EOF

node "$consumer_dir/runtime.mjs"

cat > "$consumer_dir/typecheck.ts" <<'EOF'
import { type Brick, brick, Layer } from 'brickflow'

type Greeting = Brick<{
  params: { name: string }
  result: string
}>

const greeting = brick<Greeting>(async ({ name }) => `Hello, ${name}!`)
new Layer('greetings', { greeting })
EOF

cat > "$consumer_dir/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "skipLibCheck": false,
    "noEmit": true
  },
  "include": ["typecheck.ts"]
}
EOF

"$repo_root/node_modules/.bin/tsc" -p "$consumer_dir/tsconfig.json"

mkdir -p "$work_dir/extracted"
tar -xzf "$tarball" -C "$work_dir/extracted"
if grep -R --fixed-strings '@brickflow/core' "$work_dir/extracted/package" >/dev/null; then
  echo 'Packed artifact references private package name @brickflow/core' >&2
  exit 1
fi
```

Make it executable:

```bash
chmod +x scripts/check-package.sh
```

- [ ] **Step 2: Run the contract check and observe the current package failure**

Run:

```bash
bun run package:check
```

Expected: FAIL because the current private package exports source files and has no generated `dist/index.js` plus `dist/index.d.ts` artifact matching the contract.

- [ ] **Step 3: Commit the failing package contract**

```bash
git add scripts/check-package.sh
git commit -m "test: define published package contract"
```

### Task 3: Build and expose the public `brickflow` package

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/tsup.config.ts`
- Modify: `bun.lock` (generated)

- [ ] **Step 1: Replace the core manifest with the public package manifest**

Update `packages/core/package.json` to:

```json
{
  "name": "brickflow",
  "version": "0.0.1",
  "description": "Typed domain failures, structural dependency injection, composable Layers, Signals, and engine-neutral execution for TypeScript.",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yanncabral/flow.git"
  },
  "homepage": "https://github.com/yanncabral/flow#readme",
  "bugs": {
    "url": "https://github.com/yanncabral/flow/issues"
  },
  "type": "module",
  "files": [
    "dist"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts",
  "sideEffects": false,
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "tsup",
    "test": "bun test",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "ts-pattern": "^5.8.0"
  }
}
```

The manifest starts at `0.0.1` because this exact version is packed, validated, and manually bootstrapped once before OIDC automation can be configured.

- [ ] **Step 2: Add the tsup configuration**

Create `packages/core/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts'],
  external: ['ts-pattern'],
  format: ['esm'],
  platform: 'neutral',
  sourcemap: true,
  splitting: false,
  target: 'es2022'
})
```

- [ ] **Step 3: Regenerate workspace metadata**

Run:

```bash
bun install
```

Expected: `bun.lock` records `packages/core` as `brickflow@workspace:packages/core`.

- [ ] **Step 4: Build the package and inspect generated entry points**

Run:

```bash
bun run --filter brickflow build
find packages/core/dist -maxdepth 1 -type f -print | sort
```

Expected output includes:

```text
packages/core/dist/index.d.ts
packages/core/dist/index.js
packages/core/dist/index.js.map
```

- [ ] **Step 5: Run the packed-package contract check**

Run:

```bash
bun run package:check
```

Expected: PASS. The installed tarball imports under Node.js, typechecks in isolation, contains only package metadata and `dist`, and contains no `@brickflow/core` reference.

- [ ] **Step 6: Run focused core checks**

Run:

```bash
bun run --filter brickflow typecheck
bun run --filter brickflow test
```

Expected: both commands pass.

- [ ] **Step 7: Commit the public package build**

```bash
git add packages/core/package.json packages/core/tsup.config.ts bun.lock
git commit -m "build: package core as brickflow"
```

### Task 4: Migrate workspace consumers to `brickflow`

**Files:**
- Modify: `examples/basic/package.json`
- Modify: `examples/basic/src/index.ts`
- Modify: `examples/code-agent/package.json`
- Modify: `packages/engine-openworkflow/package.json`
- Modify: `packages/testing/package.json`
- Modify: `bun.lock` (generated)

- [ ] **Step 1: Change workspace dependency names**

In all four dependent manifests, replace:

```json
"@brickflow/core": "workspace:*"
```

with:

```json
"brickflow": "workspace:*"
```

The files are:

```text
examples/basic/package.json
examples/code-agent/package.json
packages/engine-openworkflow/package.json
packages/testing/package.json
```

- [ ] **Step 2: Change the executable example import**

In `examples/basic/src/index.ts`, replace the import source only:

```ts
from '@brickflow/core'
```

with:

```ts
from 'brickflow'
```

Do not change the example behavior.

- [ ] **Step 3: Regenerate and verify workspace resolution**

Run:

```bash
bun install
bun run typecheck
bun test examples/basic/test/basic.test.ts
```

Expected: install succeeds, all workspaces typecheck, and the three basic example tests pass.

- [ ] **Step 4: Verify current code and manifests no longer use the private name**

Run:

```bash
grep -R --fixed-strings '@brickflow/core' \
  packages examples \
  --include='*.ts' --include='package.json'
```

Expected: no output and exit status 1. Historical specifications and plans are deliberately excluded.

- [ ] **Step 5: Commit the workspace migration**

```bash
git add examples/basic/package.json examples/basic/src/index.ts examples/code-agent/package.json packages/engine-openworkflow/package.json packages/testing/package.json bun.lock
git commit -m "refactor: consume core as brickflow"
```

### Task 5: Update current public documentation

**Files:**
- Modify: `README.md`
- Modify: `examples/basic/README.md`
- Modify: `docs/architecture/agent-context.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update root README installation and package identity**

Change the root README import to:

```ts
import { type Brick, brick, Layer } from 'brickflow'
```

Add an installation section before `## Autocomplete-first Bricks`:

````markdown
## Installation

```bash
npm install brickflow
```

Brickflow is ESM-only and ships TypeScript declarations.
````

Replace the current core workspace bullet with:

```markdown
- `brickflow` (`packages/core`): public engine-neutral contracts, direct execution, Layers, and the default in-process Worker.
```

Keep placeholder package bullets unchanged except where they describe their dependency on the old package name.

- [ ] **Step 2: Update the basic example README**

Replace references to public exports from `@brickflow/core` with public exports from `brickflow`. Do not rewrite the example explanation.

- [ ] **Step 3: Update current architecture and contributor context**

In `docs/architecture/agent-context.md`, replace the implementation-status statement with:

```markdown
- `packages/core` is published as `brickflow` and implements direct and Layer-bound execution with the default local Worker.
```

In `AGENTS.md`, change the `packages/core` reference to state that it is the source directory for the public `brickflow` package. Do not alter the rule that core must not import a durable adapter.

- [ ] **Step 4: Validate documentation references**

Run:

```bash
grep -R --fixed-strings '@brickflow/core' \
  README.md examples/basic/README.md docs/architecture/agent-context.md AGENTS.md
```

Expected: no output and exit status 1.

- [ ] **Step 5: Run formatting and commit**

Run:

```bash
bun run format
bun run lint
git diff --check
```

Expected: lint and whitespace checks pass.

Commit:

```bash
git add README.md examples/basic/README.md docs/architecture/agent-context.md AGENTS.md
git commit -m "docs: document brickflow package"
```

### Task 6: Configure Changesets and document the release bootstrap

**Files:**
- Create: `.changeset/config.json`
- Create: `docs/releases.md`

- [ ] **Step 1: Add the Changesets configuration**

Create `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.2/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [
    "@brickflow/engine-openworkflow",
    "@brickflow/testing",
    "@brickflow-example/basic",
    "@brickflow-example/code-agent"
  ]
}
```

`access` remains the repository default; the unscoped public package's `publishConfig.access` is authoritative for npm publication. The ignored packages are all private.

- [ ] **Step 2: Verify Changesets starts with no pending release**

Run:

```bash
bunx changeset status --output /tmp/brickflow-changeset-status.json
node -e "const s=require('/tmp/brickflow-changeset-status.json'); if(s.releases.length!==0) throw new Error(JSON.stringify(s))"
rm /tmp/brickflow-changeset-status.json
```

Expected: Changesets is configured successfully and reports no release until a future consumer-visible pull request adds a changeset.

- [ ] **Step 3: Document the contributor, bootstrap, and npm setup flow**

Create `docs/releases.md`:

````markdown
# Releases

Brickflow uses Changesets. Public changes should add a changeset with:

```bash
bun run changeset
```

Select `brickflow`, choose the semantic increment, and describe the consumer-visible change. Documentation, tests, and private-only refactors may omit a changeset.

After changes reach `main`, `.github/workflows/release.yml` creates or updates the Changesets version pull request. Merging that pull request publishes the generated version. Do not manually edit package versions.

## One-time `0.0.1` bootstrap

Trusted Publishing can be configured only after the npm package exists. After this repository change is merged and CI passes, an authorized maintainer performs exactly one local publication:

```bash
npm login
npm whoami
bun install --frozen-lockfile
bun run validate
cd packages/core
npm publish
```

Before publishing, confirm `npm whoami` is the intended npm account and `npm view brickflow version` still returns 404. The manifest must be exactly `brickflow@0.0.1`. Do not publish `0.0.0`, use `--force`, or store the local npm credential in the repository or GitHub.

## npm Trusted Publishing

Immediately after `0.0.1` exists, open the `brickflow` package settings on npm and add this trusted publisher:

- Provider: GitHub Actions
- Repository owner: `yanncabral`
- Repository: `flow`
- Workflow filename: `release.yml`
- Environment: leave unset
- Allowed action: `npm publish`

The workflow uses OIDC and npm provenance for every later version. Do not add an `NPM_TOKEN` secret. A mismatched trusted-publisher configuration causes publication to fail safely.
````

- [ ] **Step 4: Validate the bootstrap documentation and package version**

Run:

```bash
node -e "const p=require('./packages/core/package.json'); if(p.name!=='brickflow'||p.version!=='0.0.1') throw new Error(JSON.stringify(p))"
grep -F 'Workflow filename: `release.yml`' docs/releases.md
grep -F 'Allowed action: `npm publish`' docs/releases.md
```

Expected: the manifest assertion passes and both trusted-publisher settings are printed.

- [ ] **Step 5: Commit Changesets configuration**

```bash
git add .changeset/config.json docs/releases.md
git commit -m "ci: configure brickflow releases"
```

### Task 7: Add continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Validate
        run: bun run validate
```

Node.js is installed because the package smoke test executes the built ESM artifact with Node and uses `npm pack`/`npm install`.

- [ ] **Step 2: Parse the workflow and verify trigger/permission invariants**

Run:

```bash
bun -e "import { parse } from 'yaml'; const y=parse(await Bun.file('.github/workflows/ci.yml').text()); if(!y.jobs?.validate) throw new Error('missing validate job'); if(y.permissions?.contents!=='read') throw new Error('CI permissions must be read-only')"
```

If Bun cannot import a YAML parser, add `yaml` as a root dev dependency with `bun add -d yaml`, retain it in `package.json`/`bun.lock`, and rerun the command.

Expected: exit status 0.

- [ ] **Step 3: Execute the same validation command locally**

Run:

```bash
bun run validate
git diff --check
```

Expected: typecheck, tests, lint, builds, packed-package checks, and whitespace validation pass.

- [ ] **Step 4: Commit CI**

```bash
git add .github/workflows/ci.yml package.json bun.lock
git commit -m "ci: validate brickflow package"
```

### Task 8: Add OIDC Changesets publication workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches:
      - main

concurrency:
  group: release-main
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Upgrade npm for trusted publishing
        run: npm install --global npm@latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Validate
        run: bun run validate

      - name: Create release pull request or publish
        uses: changesets/action@v1
        with:
          version: bun run version-packages
          publish: bun run release
          title: "chore: release brickflow"
          commit: "chore: release brickflow"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Do not add `NODE_AUTH_TOKEN` or `NPM_TOKEN`. `id-token: write`, a current npm CLI, and the npm trusted-publisher registration provide publication authentication. Current npm automatically generates provenance for Trusted Publishing; do not set `publishConfig.provenance`, because the one-time local bootstrap does not run in a supported CI provenance environment.

- [ ] **Step 2: Parse and assert the release security invariants**

Run:

```bash
bun -e "import { parse } from 'yaml'; const y=parse(await Bun.file('.github/workflows/release.yml').text()); if(y.permissions?.['id-token']!=='write') throw new Error('missing OIDC permission'); const text=await Bun.file('.github/workflows/release.yml').text(); if(text.includes('NPM_TOKEN')||text.includes('NODE_AUTH_TOKEN')) throw new Error('token secret is forbidden'); if(y.concurrency?.['cancel-in-progress']!==false) throw new Error('releases must not cancel in progress')"
```

Expected: exit status 0.

- [ ] **Step 3: Verify the release command uses the package artifact**

Run:

```bash
bun run build
npm pack packages/core --dry-run
bunx changeset status
```

Expected: build and dry-run packing pass; Changesets reports no pending release until a future consumer-visible change adds a changeset.

Do not run `bun run release` locally because that command performs a real npm publication when a version is eligible.

- [ ] **Step 4: Commit the release workflow**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish brickflow with oidc"
```

### Task 9: Final repository verification

**Files:**
- Verify all files changed in Tasks 1–8

- [ ] **Step 1: Install exactly from the committed lockfile**

Run:

```bash
rm -rf node_modules
bun install --frozen-lockfile
```

Expected: clean installation succeeds.

- [ ] **Step 2: Run the complete validation suite**

Run:

```bash
bun run typecheck
bun test
bun run lint
bun run build
bun run package:check
git diff --check
```

Expected: every command passes.

- [ ] **Step 3: Verify publication boundaries and initial version intent**

Run:

```bash
node -e "const p=require('./packages/core/package.json'); if(p.name!=='brickflow'||p.private===true||p.version!=='0.0.1') throw new Error(JSON.stringify(p))"
bunx changeset status --output /tmp/brickflow-final-status.json
node -e "const s=require('/tmp/brickflow-final-status.json'); if(s.releases.length!==0) throw new Error(JSON.stringify(s))"
rm /tmp/brickflow-final-status.json
grep -R --fixed-strings '"private": false' packages examples || true
grep -R --fixed-strings '"private": true' packages/engine-openworkflow/package.json packages/testing/package.json
```

Expected:

- `packages/core/package.json` is public `brickflow` at bootstrap version `0.0.1`;
- Changesets has no pending release until a future public change adds a changeset;
- placeholder packages still contain `"private": true`;
- no other package was made public.

- [ ] **Step 4: Review the complete diff against the design**

Run:

```bash
git status --short
git diff origin/main...HEAD --stat
git log --oneline origin/main..HEAD
```

Confirm that changes are limited to packaging, workspace naming, release automation, package validation, and current documentation. Confirm no historical spec was rewritten and no runtime Brick behavior changed.

- [ ] **Step 5: Record the external activation requirement in the handoff**

The completion report must explicitly state that `brickflow@0.0.1` still requires the one-time local bootstrap documented in `docs/releases.md`. After that publication, the npm account must configure this trusted publisher:

```text
owner: yanncabral
repository: flow
workflow: release.yml
environment: unset
allowed action: npm publish
```

Also state that only future pull requests containing changesets update the Changesets version PR; merging such a version PR publishes the next version through OIDC.
