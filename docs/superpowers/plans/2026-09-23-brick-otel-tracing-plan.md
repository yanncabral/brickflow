# Brick OTel Tracing Plan

Date: 2026-09-23. Owner: subagent C (integration/validation).
Scope: tracing-only integration design. Does not change `packages/core/src/*`
or `packages/plugin-otel/src/*` (owned by subagents A/B). This plan proposes the
minimum decoupling contract, the span mapping validated by
`examples/tracing-basic/`, and the durable risks for OpenWorkflow / Temporal /
Inngest adapters.

Related: `docs/superpowers/specs/2026-08-25-brickflow-naming-redesign.md`
(Plugins section), `docs/architecture/agent-context.md`,
`packages/core/src/worker/execution.ts` (read-only reference).

## 1. Proposed `BrickPlugin` contract (minimum to decouple)

Copied minimum from the naming-redesign spec, narrowed to what tracing needs.
Core defines the interface; the OTel adapter only implements it. Core never
imports the adapter.

```ts
// packages/core — proposed, owned by subagent A
import type { ExecutionContext } from '../engine/execution-context'

export type BrickExit =
  | { readonly kind: 'success' }
  | { readonly kind: 'failure'; readonly error: unknown }
  | { readonly kind: 'defect'; readonly defect: unknown }
  | { readonly kind: 'cancelled'; readonly reason?: string }

export interface BrickPluginContext {
  readonly brickId: string | undefined // full durable path when Layer-bound, undefined when direct
  readonly callId: string // root run id, shared by the whole graph
  readonly layerPath: readonly string[]
  readonly brickPath: readonly string[]
  readonly paramsShape: readonly string[] // top-level param keys only, never values
  readonly execution: ExecutionContext
  readonly isReplay: boolean // durable replay marker; always false on LocalWorker
}

export interface BrickPlugin {
  readonly name: string
  readonly replayEvents?: boolean // default false: skip event emission on replay
  onStart?(context: BrickPluginContext): void | Promise<void>
  onSuccess?(context: BrickPluginContext, value: unknown): void | Promise<void>
  onFailure?(context: BrickPluginContext, error: unknown): void | Promise<void>
  onDefect?(context: BrickPluginContext, defect: unknown): void | Promise<void>
  onCancel?(context: BrickPluginContext): void | Promise<void>
  onFinally?(context: BrickPluginContext, exit: BrickExit): void | Promise<void>
  onSignal?(
    context: BrickPluginContext,
    signal: { readonly name: string; readonly path: string }
  ): void | Promise<void>
}
```

Notes:

- `onFailure` (typed domain failure) and `onDefect` (unexpected throw) are
  separate hooks. This preserves the core invariant that typed failures never
  collapse into generic `Error` values.
- `onSignal` covers signal request/response; signal payloads are never
  recorded (see PII rule).
- Hook execution order follows the spec merge order: Worker plugins, root
  Brick plugins, call-site plugins, child Brick plugins. Hooks are
  fire-and-observe: a throwing hook must not change Brick outcome (adapter
  catches and records internally).
- `paramsShape` carries key names only. Values stay out of spans by
  construction, so PII cannot leak through params.

## 2. Span-per-brick mapping

One span per executed Brick node in the selected dependency graph (root +
each resolved dependency call). Span name: `brick.<brickId ?? key>`.

| Attribute | Source | Example |
|---|---|---|
| `brick.id` | `BrickPluginContext.brickId` (Layer-bound full path) or entry key when direct | `app.users.getGreeting` |
| `brick.call_id` | `callId` — same for the whole run graph | `01J...` |
| `brick.layer_path` | `layerPath.join('.')`, empty string for direct root | `app.users` |
| `brick.path` | `brickPath.join('.')` | `getGreeting` |
| `brick.params_shape` | `paramsShape.join(',')` — keys only | `id` |
| `brick.replay` | `isReplay` | `false` |
| `brick.status` | exit kind on end | `ok \| failure \| defect \| cancelled` |

Rules:

- Parent/child nesting mirrors the dependency graph: the child span's parent
  is the span of the Brick whose dependency proxy invoked it
  (`execution.ts`: `executeResolvedBrick` dependency proxy). Siblings under
  `Promise.all` share the same parent.
- Direct-run root spans are top-level (no `brick.id`); `brick.path` is the
  entry key (`direct` today — adapter should prefer the supplied alias path
  once available).
- Layer-bound spans use the full durable Brick path for `brick.id`, matching
  signal-path conventions (`layerPath + brickPath`).
- No params values, no provider values, no signal payloads in attributes or
  events. Shape-only by default; an explicit opt-in allowlist of non-PII keys
  may be added later per Brick, never globally.

## 3. Events: signals / failures / defects

Recorded as span events (timestamps from the tracer clock):

| Event | When | Fields |
|---|---|---|
| `brick.signal.request` | `onSignal` request dispatch | `signal.name`, `signal.path` |
| `brick.signal.response` | signal handler resolves | `signal.name`, `signal.path` |
| `brick.failure` | `onFailure` (typed domain failure) | `failure.shape` (see below), span status `error` NOT set — failures are data, not errors |
| `brick.defect` | `onDefect` (unexpected throw) | `exception.type`, `exception.message`, span status `error` |
| `brick.cancelled` | `onCancel` | `reason` if present |
| `brick.retry.attempt` | durable engine retry (adapter-owned) | `attempt`, `policy` |

`failure.shape`: for string failures, the literal value (`user-not-found`); for
object failures, the `type` discriminator or sorted top-level keys —
never nested values. This keeps structured failures queryable without
serializing domain data into traces.

Defects follow OTel exception conventions (`exception.type/message`), with
stacktrace only when the engine provides one (local: yes; durable replay:
no — replay must not re-capture stacks).

## 4. Context propagation

- In-process (`LocalWorker`): standard OTel context propagation. The plugin
  starts each Brick span as a child of the currently active span; the
  dependency proxy in `executeResolvedBrick` runs inside the parent span
  context, so nesting is automatic.
- `callId` is propagated as baggage (`brick.call_id`) so cross-process log
  correlation works even where trace context is lost.
- W3C `traceparent`/`tracestate` injection at durable boundaries is the
  adapter's job: the durable Worker serializes the span context into the
  checkpoint envelope and rehydrates it on resume. Core only forwards opaque
  `metadata`; it never parses trace headers.
- Signals: the signal round-trip (`EngineExecutionRequest.signal`) stays
  inside the requesting Brick's span; the boundary handler executes as an
  event, not a child span, unless the adapter explicitly opts in.

## 5. Replay-safety

- `isReplay=false` on `LocalWorker`; durable Workers set `isReplay=true`
  when re-executing history.
- Default `replayEvents=false`: on replay the plugin re-links the existing
  span context but emits no new spans or events. This prevents duplicate
  spans per replay, per the spec rule ("durable engines must prevent
  duplicate plugin events during replay unless plugin explicitly opts in").
- Opt-in `replayEvents=true` exists for audit-style tracers; the OTel
  adapter leaves it `false`.
- Spans are never used as a source of truth for execution state — tracing
  observes; checkpoints decide.

## 6. Durable risks and checkpoint strategy

| Risk | Engines affected | Strategy |
|---|---|---|
| Duplicate spans on replay | OpenWorkflow, Temporal | `isReplay` gate (section 5); span identity derived from `(callId, brickPath)` so resume re-attaches instead of re-creating |
| Non-deterministic timing in traces | all durable | duration/retry-count attributes are observation-only; never feed them back into retry or timeout policy |
| Trace context loss across checkpoint | OpenWorkflow (SQLite/PG), Temporal, Inngest | serialize W3C context in the checkpoint envelope; rehydrate on resume; fall back to `brick.call_id` baggage correlation |
| Signal spans outliving workflow history | Temporal, Inngest | signals are events, not spans; no separate signal span lifecycle to reconcile |
| Typed failure misclassified as error | all durable | `brick.failure` event without span error status; adapters must preserve structured failure data through serialization (core invariant) |
| Hook throwing breaks resume | all durable | hooks are best-effort; adapter wraps in try/catch and counts `tracer.dropped_events` |
| Clock skew across workers | distributed backends | use engine-provided timestamps for span events when available; tracer clock otherwise |

Checkpoint rule: checkpoints persist execution state (params shapes, failure
data, signal outcomes). Trace linkage (`traceId/spanId` per brick path) rides
along as opaque metadata. On resume, the adapter restores linkage; if linkage
is absent (old checkpoint), it starts a fresh trace with a
`brick.resume_without_link` event and the same `callId`.

## 7. Compatibility (core imports no adapter)

- Core owns `BrickPlugin`, `BrickPluginContext`, `BrickExit` types and the
  hook call sites in `executeResolvedBrick`. Core has zero OTel imports.
- The OTel adapter (`@brickflow/plugin-otel` or equivalent, owned by
  subagent B) depends on core types + the OTel SDK only.
- `LocalWorker` always passes `isReplay=false` and works with zero plugins
  registered — tracing is purely additive.
- No change to `Brick`, `Layer`, `Worker`, signal paths, or failure
  semantics. Plugin hooks observe; they cannot alter params, results, or
  failure values.
- `examples/tracing-basic/` validates the mapping with an in-memory tracer
  and no OTel SDK dependency, so the contract is testable before the real
  adapter lands.

## 8. Integration sequence (A + B)

1. Subagent A (core): add `BrickPlugin` types + hook call sites in
   `executeResolvedBrick` (start/success/failure/defect/cancel/finally/signal),
   thread `brickId`/`layerPath`/`brickPath`/`paramsShape`/`isReplay=false`
   through `ExecutionContext`.
2. Subagent B (adapter): implement `createTracingPlugin(tracer)` against the
   real OTel SDK using this plan's attribute/event table.
3. Subagent C (this plan + example): swap the example's in-memory tracer for
   the real adapter once A + B land; keep `InMemoryTracer` as the contract
   test double. Add a durable replay test (fake `isReplay=true` worker) when
   a durable Worker exists.
