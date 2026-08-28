# Brick Definition Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace interface-based Brick contracts with `Brick<{ ... }>` so editors autocomplete configuration fields while preserving all existing type inference and runtime behavior.

**Architecture:** Make `Brick` a generic identity type constrained by a private configuration interface, preserving the exact supplied object rather than normalizing optional fields. Keep `brick()` and execution runtime unchanged, migrate active contracts mechanically, and document schema-library branded/refined types as boundary-validated domain values with no core schema dependency or repeated validation.

**Tech Stack:** TypeScript 5.9, Bun workspaces and tests, Biome, existing compile-time type-tests.

---

## File Structure

- `packages/core/src/brick/contract.ts`: define the constrained generic `Brick<Config>` identity type; keep runtime factory unchanged.
- `packages/core/type-tests/brick.ts`: establish the new public syntax, omitted-section defaults, projections, invalid configurations, and handler inference.
- `packages/core/type-tests/direct-run.ts`: migrate direct-run graph contracts and preserve compile-time run configuration coverage.
- `packages/core/type-tests/layer.ts`: migrate Layer contracts and preserve composition/bound-run coverage.
- `packages/core/test/brick.test.ts`: migrate Brick runtime test declarations without changing behavior.
- `packages/core/test/direct-run.test.ts`: migrate direct-run runtime declarations without changing assertions.
- `packages/core/test/layer.test.ts`: migrate Layer runtime declarations without changing assertions.
- `examples/basic/src/index.ts`: make the executable example use canonical `Brick<{ ... }>` contracts.
- `README.md`: teach autocomplete-first contracts and boundary-validated branded/refined domain types.
- `docs/architecture/agent-context.md`: record the active generic contract model and schema-neutral boundary rule.
- `examples/basic/README.md`: replace obsolete Flow/interface wording with current Brick API.
- `AGENTS.md`: update contributor guidance from “Brick interface” to “Brick contract”.
- `docs/superpowers/specs/2026-08-28-brick-definition-autocomplete-design.md`: retain the approved design plus the approved validated/branded-domain-type guidance.

Historical specs and plans other than the current documents remain unchanged.

### Task 1: Establish the new contract syntax with failing type-tests

**Files:**
- Modify: `packages/core/type-tests/brick.ts:5-89`
- Test: `packages/core/type-tests/brick.ts`

- [ ] **Step 1: Extend imports for public projection assertions**

Replace the public API import with:

```ts
import {
  type Brick,
  type BrickHandler,
  type BrickImplementation,
  type DependenciesOf,
  type ErrorsOf,
  type ParamsOf,
  type RequirementsOf,
  type ResultOf,
  type SignalsOf,
  brick
} from '../src/index'
```

- [ ] **Step 2: Convert the representative contracts to the new syntax**

Convert `GetUserBrick`, `GetProfileBrick`, and `QuietBrick` first. Use this exact shape for the complete and required-only cases:

```ts
type GetUserBrick = Brick<{
  params: { id: string }
  result: { id: string }
  errors: 'user-not-found' | { type: 'unavailable'; retryAfter: number }
  requires: { users: { find(id: string): Promise<{ id: string } | undefined> } }
  signals: { refresh: { request: { force: boolean }; response: 'refreshed' } }
}>

type GetProfileBrick = Brick<{
  params: { userId: string }
  result: { userId: string }
  errors: 'profile-not-found'
  requires: { profiles: { has(userId: string): boolean } }
  depends: { getUser: GetUserBrick }
}>

type QuietBrick = Brick<{
  params: undefined
  result: number
}>
```

Leave the invalid-key contracts temporarily in their old form so this step isolates the generic API failure.

- [ ] **Step 3: Add projection and omitted-default assertions**

Place these assertions after `QuietBrick`:

```ts
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
    ? 1
    : 2
    ? true
    : false

type Expect<Value extends true> = Value

type _GetUserParams = Expect<Equal<ParamsOf<GetUserBrick>, { id: string }>>
type _GetUserResult = Expect<Equal<ResultOf<GetUserBrick>, { id: string }>>
type _GetUserErrors = Expect<
  Equal<ErrorsOf<GetUserBrick>, 'user-not-found' | { type: 'unavailable'; retryAfter: number }>
>
type _GetUserRequirements = Expect<
  Equal<
    RequirementsOf<GetUserBrick>,
    { users: { find(id: string): Promise<{ id: string } | undefined> } }
  >
>
type _GetProfileDependencies = Expect<
  Equal<DependenciesOf<GetProfileBrick>, { getUser: GetUserBrick }>
>
type _GetUserSignals = Expect<
  Equal<
    SignalsOf<GetUserBrick>,
    { refresh: { request: { force: boolean }; response: 'refreshed' } }
  >
>
type _QuietErrors = Expect<Equal<ErrorsOf<QuietBrick>, never>>
type _QuietRequirements = Expect<Equal<keyof RequirementsOf<QuietBrick>, never>>
type _QuietDependencies = Expect<Equal<keyof DependenciesOf<QuietBrick>, never>>
type _QuietSignals = Expect<Equal<keyof SignalsOf<QuietBrick>, never>>
```

- [ ] **Step 4: Run the core typecheck and verify the intended failure**

Run:

```bash
bun run --cwd packages/core typecheck
```

Expected: FAIL with TypeScript errors equivalent to `Type 'Brick' is not generic` on the new declarations. Existing old declarations should not be the reason for failure.

Do not commit this intentionally failing state. Keep the red test local until Task 2 makes it pass, because repository commits must pass required validation.

### Task 2: Implement the generic Brick identity type

**Files:**
- Modify: `packages/core/src/brick/contract.ts:1-16`
- Test: `packages/core/type-tests/brick.ts`

- [ ] **Step 1: Import the shared signal definition constraint**

Add this type-only import at the top of `packages/core/src/brick/contract.ts`:

```ts
import type { SignalDefinitions } from '../signal/types'
```

- [ ] **Step 2: Replace the public `Brick` interface with a constrained identity type**

Replace the current interface with:

```ts
interface BrickConfig {
  params: unknown
  result: unknown
  errors?: unknown
  requires?: object
  depends?: Readonly<Record<string, Brick>>
  signals?: SignalDefinitions
}

export type Brick<Config extends BrickConfig = BrickConfig> = Config
```

Do not intersect `Config` with `BrickConfig`, make optional fields required, or fill omitted fields. Exact preservation of `Config` is what keeps aliases, defaults, run options, and signal trees precise.

- [ ] **Step 3: Keep the factory signature and runtime body unchanged**

Confirm the factory remains structurally identical:

```ts
export function brick<F extends Brick>(
  handler: F extends ValidBrick<F> ? BrickHandler<F> : never
): BrickImplementation<F> {
```

No schema, token, metadata, parser, or validation argument is added.

- [ ] **Step 4: Run the core typecheck and verify the representative tests pass**

Run:

```bash
bun run --cwd packages/core typecheck
```

Expected: PASS. If it fails, fix only generic constraint compatibility; do not normalize `Config` or alter runtime execution.

- [ ] **Step 5: Run the focused Brick runtime test**

Run:

```bash
bun test packages/core/test/brick.test.ts
```

Expected: all tests PASS, demonstrating runtime construction remains unchanged.

- [ ] **Step 6: Commit the passing contract slice**

```bash
git add packages/core/src/brick/contract.ts packages/core/type-tests/brick.ts
git commit -m "feat: add autocomplete-first Brick contracts"
```

### Task 3: Complete Brick type-test migration and validation coverage

**Files:**
- Modify: `packages/core/type-tests/brick.ts:19-175`
- Test: `packages/core/type-tests/brick.ts`

- [ ] **Step 1: Convert every remaining contract in `brick.ts`**

For each remaining declaration, change:

```ts
interface ExampleBrick extends Brick {
  params: undefined
  result: undefined
}
```

into:

```ts
type ExampleBrick = Brick<{
  params: undefined
  result: undefined
}>
```

Apply this to all invalid alias and signal-name contracts too. Preserve their keys exactly so existing `@ts-expect-error` checks continue testing empty, dotted, symbol, and numeric names.

- [ ] **Step 2: Add invalid dependency and signal shape assertions at declaration boundaries**

Add near the invalid contract declarations:

```ts
// @ts-expect-error dependency values must be Brick contracts
type InvalidDependencyBrick = Brick<{
  params: undefined
  result: undefined
  depends: { invalid: string }
}>

// @ts-expect-error signal definitions require request and response
type InvalidSignalBrick = Brick<{
  params: undefined
  result: undefined
  signals: { invalid: { request: string } }
}>
```

Then mark both aliases as used without creating implementations:

```ts
void (undefined as unknown as InvalidDependencyBrick)
void (undefined as unknown as InvalidSignalBrick)
```

- [ ] **Step 3: Update obsolete assertion wording**

Change comments saying “Brick interface” to “Brick contract”, including handler parameter and result mismatch comments.

- [ ] **Step 4: Run the core typecheck**

Run:

```bash
bun run --cwd packages/core typecheck
```

Expected: PASS with every `@ts-expect-error` consumed. An unused directive means the generic constraint is too broad and must be corrected.

- [ ] **Step 5: Commit the complete focused type coverage**

```bash
git add packages/core/type-tests/brick.ts
git commit -m "test: cover generic Brick contract validation"
```

### Task 4: Migrate direct-run and Layer type-tests

**Files:**
- Modify: `packages/core/type-tests/direct-run.ts`
- Modify: `packages/core/type-tests/layer.ts`
- Test: `packages/core/type-tests/direct-run.ts`
- Test: `packages/core/type-tests/layer.ts`

- [ ] **Step 1: Run the deterministic declaration migration script**

Run this script once from repository root. It converts only multiline named interfaces that directly extend `Brick`, tracks nested type-literal braces, and leaves ordinary interfaces untouched:

```bash
python3 - <<'PY'
from pathlib import Path
import re

paths = [
    Path('packages/core/type-tests/direct-run.ts'),
    Path('packages/core/type-tests/layer.ts'),
]
pattern = re.compile(r'^(?P<indent>\s*)(?P<export>export\s+)?interface\s+(?P<name>\w+)\s+extends\s+Brick\s*\{\s*$')

for path in paths:
    lines = path.read_text().splitlines(keepends=True)
    output: list[str] = []
    index = 0
    converted = 0
    while index < len(lines):
        match = pattern.match(lines[index].rstrip('\n'))
        if not match:
            output.append(lines[index])
            index += 1
            continue

        indent = match.group('indent')
        export = match.group('export') or ''
        output.append(f"{indent}{export}type {match.group('name')} = Brick<{{\n")
        depth = 1
        index += 1
        while index < len(lines):
            line = lines[index]
            depth += line.count('{') - line.count('}')
            if depth == 0:
                output.append(f'{indent}}}>\n')
                index += 1
                converted += 1
                break
            output.append(line)
            index += 1
        else:
            raise RuntimeError(f'Unclosed Brick interface in {path}')

    path.write_text(''.join(output))
    print(f'{path}: converted {converted}')
PY
```

Expected output:

```text
packages/core/type-tests/direct-run.ts: converted 53
packages/core/type-tests/layer.ts: converted 12
```

- [ ] **Step 2: Verify no old declarations remain in type-tests**

Run:

```bash
if grep -R "interface .* extends Brick" -n packages/core/type-tests; then exit 1; fi
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run all core compile-time coverage**

Run:

```bash
bun run --cwd packages/core typecheck
```

Expected: PASS. Fix only declaration syntax or generic compatibility regressions; do not weaken existing expected errors or required run options.

- [ ] **Step 4: Commit the graph type-test migration**

```bash
git add packages/core/type-tests/direct-run.ts packages/core/type-tests/layer.ts
git commit -m "test: migrate Brick graph contracts"
```

### Task 5: Migrate runtime tests without changing behavior

**Files:**
- Modify: `packages/core/test/brick.test.ts`
- Modify: `packages/core/test/direct-run.test.ts`
- Modify: `packages/core/test/layer.test.ts`
- Test: same files

- [ ] **Step 1: Run the same deterministic migration for runtime tests**

Use the Task 4 Python script with only its `paths` list replaced by:

```python
paths = [
    Path('packages/core/test/brick.test.ts'),
    Path('packages/core/test/direct-run.test.ts'),
    Path('packages/core/test/layer.test.ts'),
]
```

Expected output:

```text
packages/core/test/brick.test.ts: converted 2
packages/core/test/direct-run.test.ts: converted 61
packages/core/test/layer.test.ts: converted 5
```

- [ ] **Step 2: Verify no old declarations remain in runtime tests**

Run:

```bash
if grep -R "interface .* extends Brick" -n packages/core/test; then exit 1; fi
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run focused runtime tests**

Run:

```bash
bun test packages/core/test/brick.test.ts
bun test packages/core/test/direct-run.test.ts
bun test packages/core/test/layer.test.ts
```

Expected: all three commands PASS with unchanged test counts and assertions.

- [ ] **Step 4: Re-run core typechecking**

Run:

```bash
bun run --cwd packages/core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit runtime declaration migration**

```bash
git add packages/core/test/brick.test.ts packages/core/test/direct-run.test.ts packages/core/test/layer.test.ts
git commit -m "test: migrate runtime Brick contracts"
```

### Task 6: Migrate the executable basic example

**Files:**
- Modify: `examples/basic/src/index.ts:12-47`
- Test: `examples/basic/test/basic.test.ts`

- [ ] **Step 1: Convert the three exported contracts**

Use these declarations:

```ts
export type GetUserBrick = Brick<{
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
}>

export type GetGreetingBrick = Brick<{
  params: { id: string }
  result: { message: string }
  depends: { getUser: GetUserBrick }
}>

export type ApproveGreetingBrick = Brick<{
  params: { id: string }
  result: { message: string; approved: boolean }
  depends: { getGreeting: GetGreetingBrick }
  signals: {
    approve: {
      request: { message: string }
      response: { approved: boolean }
    }
  }
}>
```

Leave all `brick<Contract>(handler)`, Layer construction, signal handling, and runtime code unchanged.

- [ ] **Step 2: Run example typechecking and runtime test**

Run:

```bash
bun run --cwd examples/basic typecheck
bun test examples/basic/test/basic.test.ts
```

Expected: both commands PASS.

- [ ] **Step 3: Commit the example migration**

```bash
git add examples/basic/src/index.ts
git commit -m "docs: migrate basic example Brick contracts"
```

### Task 7: Document canonical contracts and validated domain types

**Files:**
- Modify: `README.md:5-38`
- Modify: `docs/architecture/agent-context.md:21-45`
- Modify: `examples/basic/README.md:1-15`
- Modify: `AGENTS.md:39-50`

- [ ] **Step 1: Rewrite the root README contract introduction**

Rename `## Interface-first Bricks` to `## Autocomplete-first Bricks`. Replace its declaration example with:

```ts
type GetUserBrick = Brick<{
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
}>
```

State directly below the example:

```md
`Brick<{ ... }>` gives editors autocomplete for `params`, `result`, `errors`, `requires`, `depends`, and `signals`. `params` and `result` are required; the other sections may be omitted when empty. Contracts remain named, reusable TypeScript types, and multiple `brick<GetUserBrick>(...)` values can implement the same contract.
```

- [ ] **Step 2: Add boundary-validation guidance to the root README**

Add a `### Validated domain types` subsection before `## Commands`:

````md
### Validated domain types

Brick is schema-library-neutral. Validate unknown input once at an application or transport boundary, then use the schema library's inferred branded, refined, or transformed output type directly in a Brick contract. The validated value can pass through the trusted Brick graph without repeated parsing.

```ts
const EmailSchema = z.string().email().brand<'Email'>()
type Email = z.infer<typeof EmailSchema>

type SendEmailBrick = Brick<{
  params: { email: Email }
  result: void
}>

const email = EmailSchema.parse(untrustedEmail)
await sendEmail.run({ email })
```

A plain `string` does not satisfy `Email`. Zod, TypeBox, ArkType, and other Standard Schema-compatible libraries can use their own inferred output types; Brick imports none of them and performs no automatic schema validation. Validate again only after crossing an untrusted or serialization boundary.
````

- [ ] **Step 3: Update architecture context**

Replace the canonical Brick interface example with `type UseCase = Brick<{ ... }>` and close it with `}>`. Replace “Interface is type-only” with:

```md
- `Brick<{ ... }>` is a type-only contract and provides editor completion for supported sections.
- `params` and `result` are required. Omitted `errors`, `requires`, `depends`, and `signals` retain their existing empty defaults.
```

Add these rules after the Brick rules:

```md
- Core has no schema-library integration and does not automatically validate Brick inputs or outputs.
- Validate unknown values at trust boundaries, then use the schema library's inferred branded/refined output types in Brick contracts without repeated validation inside the trusted graph.
- Serialized or otherwise untrusted data must be validated again because TypeScript-only brands do not survive runtime boundaries.
```

- [ ] **Step 4: Update the basic example README**

Change title to `# Basic Brick example`, package name to `@brickflow/core`, and bullets to describe:

```md
- `type X = Brick<{ ... }>` contracts with editor-completable fields and omitted empty defaults;
- immutable implementations created by `brick<X>(handler)` without classes, `new`, or runtime requirement tuples;
- `GetGreetingBrick` calling its `getUser` dependency through the matching public Layer entry key;
```

Replace remaining “Flow” terminology with “Brick” and “interface-only variant” with “type-only contract model”.

- [ ] **Step 5: Update contributor guidance**

Replace the `AGENTS.md` pattern:

```md
- A Brick interface is type-only; `brick<F>(handler)` creates a frozen executable implementation without tokens or requirement metadata.
```

with:

```md
- A Brick contract uses `type X = Brick<{ ... }>` for configuration-field autocomplete; `brick<X>(handler)` creates a frozen executable implementation without tokens, schemas, or requirement metadata.
- Core does not validate schema-library values. Validate at trust boundaries and pass inferred branded/refined domain types through the Brick graph without repeated parsing.
```

- [ ] **Step 6: Verify active documentation no longer teaches interface extension**

Run:

```bash
if grep -n "Interface-first\|interface .* extends Brick\|interface X extends Flow\|@flow/core\|flow<X>" README.md docs/architecture/agent-context.md examples/basic/README.md AGENTS.md; then exit 1; fi
```

Expected: no output and exit code 0.

- [ ] **Step 7: Format and lint documentation/source edits**

Run:

```bash
bun run format
bun run lint
```

Expected: both commands PASS.

- [ ] **Step 8: Commit documentation**

```bash
git add README.md docs/architecture/agent-context.md examples/basic/README.md AGENTS.md
git commit -m "docs: explain autocomplete and validated Brick types"
```

### Task 8: Verify the complete migration

**Files:**
- Verify: entire repository excluding historical design records

- [ ] **Step 1: Confirm no active old Brick declarations remain**

Run:

```bash
if grep -R "interface .* extends Brick" -n \
  packages/core/src packages/core/test packages/core/type-tests examples/basic/src \
  README.md docs/architecture/agent-context.md examples/basic/README.md AGENTS.md; then
  exit 1
fi
```

Expected: no output and exit code 0. Do not scan or rewrite historical files under `docs/superpowers/specs/` or `docs/superpowers/plans/`.

- [ ] **Step 2: Run full typechecking**

Run:

```bash
bun run typecheck
```

Expected: every workspace typecheck PASS.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
bun test
```

Expected: all tests PASS.

- [ ] **Step 4: Run repository linting**

Run:

```bash
bun run lint
```

Expected: Biome reports no errors.

- [ ] **Step 5: Build publishable packages**

Run:

```bash
bun run build
```

Expected: all package builds PASS.

- [ ] **Step 6: Check patch whitespace and repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` has no output. `git status --short` shows only intentional uncommitted plan/spec bookkeeping, if any.

- [ ] **Step 7: Commit any final formatting-only corrections**

If verification changed files through formatting, commit only those verified corrections:

```bash
git add -A
git commit -m "chore: finalize Brick contract migration"
```

Skip this commit when the working tree is already clean.
