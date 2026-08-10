import type { BoundarySignalHandlers, InternalSignalHandlers, SignalFunctions } from '../src/index'

type Definitions = {
  approve: { request: { id: string }; response: { approved: boolean } }
  refresh: { request: undefined; response: 'refreshed' }
}

declare const signals: SignalFunctions<Definitions>
const approved: Promise<{ approved: boolean }> = signals.approve({ id: '1' })
const refreshed: Promise<'refreshed'> = signals.refresh(undefined)
void approved
void refreshed
// @ts-expect-error request must match its structural signal definition
signals.approve({ missing: true })

type UndefinedResponseDefinitions = {
  invalid: { request: undefined; response: string | undefined }
}

const invalidSignals: SignalFunctions<UndefinedResponseDefinitions> = {
  // @ts-expect-error signal responses cannot include undefined because undefined means propagate
  invalid: async () => 'invalid'
}
void invalidSignals

const internal: InternalSignalHandlers<Definitions> = {
  approve: async (request) => (request.id === '1' ? { approved: true } : undefined)
}
void internal

const boundary: BoundarySignalHandlers<Definitions> = {
  approve: (request) => ({ approved: request.id === '1' }),
  refresh: () => 'refreshed'
}
void boundary

// @ts-expect-error boundary handlers must be total and include every signal
const missingBoundary: BoundarySignalHandlers<Definitions> = { approve: () => ({ approved: true }) }
void missingBoundary
