# Vertical-sliced modules

Brick modules are vertical slices. A module owns its use cases, structural
provider contracts, adapters, and Layer composition. The application composes
module Layers; it does not reach into their implementation folders.

## Shape

```text
sessions/
├── sessions-module.ts
├── usecases/
│   ├── create-session-usecase.ts
│   ├── refresh-session-usecase.ts
│   ├── revoke-session-usecase.ts
│   └── revoke-all-sessions-usecase.ts
├── repositories/
│   └── sessions/
│       ├── session-repository.ts
│       └── drizzle-session-repository.ts
└── services/
    ├── session-token-service.ts
    └── opaque-session-token-service.ts
```

The same shape applies to `users/`. A failure type is declared by the use case
that produces it; there is no module-wide `failures.ts` registry.

## Module Layer

`sessions-module.ts` exports a Layer of use cases. Its public type is derived
from that Layer, rather than being restated as a TypeScript interface:

```ts
import { Layer } from 'brickflow'

import { createSession } from './usecases/create-session-usecase'
import { refreshSession } from './usecases/refresh-session-usecase'
import { revokeSession } from './usecases/revoke-session-usecase'
import { revokeAllSessions } from './usecases/revoke-all-sessions-usecase'

export const sessionsLayer = new Layer('sessions', {
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions
})

export type SessionsModule = typeof sessionsLayer
```

The Layer is the module interface: its entries, contracts, unresolved
requirements, dependency graph, and execution options are inferred together.
Adding or removing a use case updates the public module type automatically.

## Provider contract and adapters

The repository contract is a structural requirement consumed by use cases. It
is not itself a Brick:

```ts
export interface SessionRepository {
  findById(id: string): Promise<Session | undefined>
  findByTokenHash(tokenHash: string): Promise<Session | undefined>
  insert(session: Session): Promise<void>
  update(session: Session): Promise<void>
  revoke(id: string, revokedAt: Date): Promise<void>
  revokeAllByUserId(userId: string, revokedAt: Date): Promise<void>
}
```

The use case declares the requirement and the adapter supplies it through a
Layer. This keeps the seam small and allows memory, Drizzle, or another adapter
to satisfy the same contract.

```ts
export const sessionsDrizzleLayer = sessionsLayer.provide({
  sessionRepository: drizzleSessionRepository,
  sessionTokenService: opaqueSessionTokenService,
  clock: systemClock
})
```

The base `sessionsLayer` can remain unresolved and be composed by an
application Layer. Environment-specific Layers are derived values; they do not
mutate the module or its providers.

## Composition

```ts
export const appLayer = new Layer('app', {
  users: usersDrizzleLayer,
  sessions: sessionsDrizzleLayer,
  authorization: authorizationLayer
})
```

Cross-module use cases depend on another module's Brick contract through
`depends`; they do not import a concrete adapter. For example,
`authenticateUser` may depend on `users.getUserByEmail` while requiring only
session-specific providers itself.

## Boundary

```text
transport validates input
        ↓
module Layer exposes use cases
        ↓
use cases call Bricks and structural providers
        ↓
adapters implement repositories and technical services
```

The module's external seam is its Layer. Folders below `sessions/` are
implementation details and may evolve without changing application assembly.
