# Recursive Flow Graph Configuration — Design Specification

- **Status:** Written design pending final review
- **Date:** 2026-08-24
- **Design variant:** `recursive-flow-graph-configuration`
- **Supersedes:** flattened direct dependency and direct boundary-signal configuration from `2026-08-21-direct-flow-execution-design.md`

## Purpose

Represent direct Flow dependency configuration and boundary signals using the actual recursive dependency graph. Dependency aliases are namespaces. Transitive branches do not flatten into a shared object, so equal aliases or signal names in separate branches remain independent.

Layers continue to provide reusable graph composition and scoped resolution. This design changes only the configuration still supplied at a `.run(...)` boundary.

## Dependency configuration

Every supplied dependency is an explicit node:

```ts
await parent.run(params, {
  dependencies: {
    primary: {
      flow: primary
    },
    secondary: {
      flow: secondary
    }
  }
})
```

Bare Flow implementations are not accepted:

```ts
await parent.run(params, {
  dependencies: {
    primary // type error
  }
})
```

A node with unresolved children contains a nested `dependencies` object:

```ts
await parent.run(params, {
  dependencies: {
    primary: {
      flow: primary,
      dependencies: {
        repository: {
          flow: primaryRepository
        }
      }
    },
    secondary: {
      flow: secondary,
      dependencies: {
        repository: {
          flow: secondaryRepository
        }
      }
    }
  }
})
```

The `dependencies` property is required only when that node still has unresolved direct dependencies. It is omitted when all children are already resolved or the Flow declares no dependencies. The node wrapper itself is always required.

## Layer-bound execution

A bound Flow requires only unresolved branches. Resolved Layer entries do not appear in the run configuration.

```ts
const app = new Layer('app', {
  parent,
  grandchild
})

await app.parent.run(params, {
  dependencies: {
    child: {
      flow: child
      // child.grandchild resolves from app, so no nested dependencies object is required
    }
  }
})
```

A supplied node inherits the requesting caller's Layer scope. Its children resolve local-first, then unique-global. Only children still missing or ambiguous are required under the node's nested `dependencies`.

```ts
await app.parent.run(params, {
  dependencies: {
    child: {
      flow: child,
      dependencies: {
        ambiguousRepository: {
          flow: selectedRepository
        }
      }
    }
  }
})
```

Layer-resolved entries retain precedence. A supplied node is used only for an unresolved or ambiguous alias selected by the typed configuration.

## Boundary signal configuration

Boundary signals mirror the selected execution graph.

Signals declared by the root Flow remain at the root of `signals`:

```ts
await root.run(params, {
  signals: {
    approve: handleRootApproval
  }
})
```

Signals declared by dependencies are nested under dependency aliases:

```ts
await parent.run(params, {
  dependencies: {
    primary: { flow: primary },
    secondary: { flow: secondary }
  },
  signals: {
    primary: {
      approve: () => true
    },
    secondary: {
      approve: () => false
    }
  }
})
```

Transitive signals follow the same recursive alias path:

```ts
signals: {
  primary: {
    approve: handlePrimary,
    repository: {
      refresh: handlePrimaryRepositoryRefresh
    }
  },
  secondary: {
    approve: handleSecondary,
    repository: {
      refresh: handleSecondaryRepositoryRefresh
    }
  }
}
```

Direct signal resolution uses complete alias paths such as `primary.approve`. It does not fall back to the final signal name. Consequently two branches may safely declare the same signal name with different request/response types and handlers.

For Layer-bound execution:

- Layer-resolved Flows retain their durable Layer-path signal namespace;
- supplied dependency nodes use their recursive dependency-alias namespace;
- only selected Layer branches contribute required handlers;
- ambiguous Layer candidates that are replaced by a supplied node do not contribute handlers;
- empty Layer namespaces are omitted.

## Conflict rules

Different branches are independent namespaces. These are valid:

```text
primary.repository
secondary.repository

primary.approve
secondary.approve
```

A conflict exists only within the same caller scope and alias path:

1. a Layer entry resolves a direct dependency alias to a Flow contract incompatible with the declaring Flow;
2. an explicitly supplied node's `flow` is incompatible with the dependency contract at that path;
3. two requirements at the same effective structural key are mutually incompatible;
4. one signal path is required with incompatible request/response contracts.

Such conflicts are reported where the Flows or Layers are composed, not deferred to runtime.

## Type model

The type calculation walks scoped graph nodes:

```ts
type GraphNode = {
  flow: Flow
  scope: LayerEntries | DirectScope
}
```

For each direct dependency alias:

1. resolve it in the current Layer scope when bound;
2. if resolved, recurse with the matched implementation and containing Layer scope;
3. if unresolved or ambiguous, require an explicit dependency node;
4. validate `node.flow` against the declared dependency contract;
5. recurse into the supplied Flow, inheriting the caller scope for Layer-backed child resolution;
6. construct the signal-handler tree from the same selected graph;
7. stop at depth 16 using a conservative fallback that never omits required configuration.

The dependency graph and signal graph must be derived from the same resolution result. Independent structural scans are prohibited because they can require handlers for branches that will not execute.

## Runtime model

Direct execution constructs `ExecutionEntry` nodes with recursive alias paths. Supplied child entries carry parent/caller scope metadata when running from a Layer.

Signal handlers are flattened only at the runtime boundary from their nested public representation:

```text
primary.approve -> handler
secondary.approve -> handler
```

The current final-segment fallback in direct signal resolution is removed.

## Compatibility

This is a breaking change for direct and partially configured dependency calls.

Before:

```ts
flow.run(params, {
  dependencies: {
    child,
    grandchild
  }
})
```

After:

```ts
flow.run(params, {
  dependencies: {
    child: {
      flow: child,
      dependencies: {
        grandchild: {
          flow: grandchild
        }
      }
    }
  }
})
```

Simple dependency nodes also require the explicit wrapper:

```ts
dependencies: {
  child: { flow: child }
}
```

Fully configured Layer-bound calls remain unchanged:

```ts
await app.parent.run(params)
```

## Testing

Required runtime and compile-time coverage:

1. direct dependencies require explicit `{ flow }` nodes;
2. bare Flow values are rejected;
3. recursive dependencies execute through their nested configuration;
4. two branches may use the same transitive alias with different implementations;
5. root signals remain at the signal root;
6. dependency signals use recursive alias namespaces;
7. equal signal names in sibling branches receive different handlers and types;
8. final-segment signal fallback is absent;
9. Layer-bound supplied nodes inherit caller scope;
10. only unresolved Layer branches require dependency nodes;
11. ambiguous Layer branches supplied explicitly do not require unused Layer signal handlers;
12. mixed Layer-resolved and supplied signal graphs require only selected paths;
13. incompatible Flow and signal contracts fail at composition;
14. depth exhaustion remains conservative;
15. all existing failure, provider, cancellation, metadata, and durable Layer identity behavior remains unchanged.

## Non-goals

This design does not change structural providers, typed failures, Flow handler dependency-call syntax, local Worker scheduling, or durable adapter serialization. It does not add implicit dependency tokens or allow bare implementations as configuration sugar.
