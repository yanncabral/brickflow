import {
  Flow,
  Layer,
  type LayerEntriesOf,
  type LayerProvidersOf,
  type LayerRequirementsOf,
  type LayerUnprovidedRequirementsOf,
  type RequirementConflict
} from '../src/index'

type Empty = Record<never, never>

type Database = { find(id: string): string }
type Logger = { log(message: string): void }

class GetUserFlow extends Flow<{
  params: { id: string }
  result: { id: string }
  errors: never
  requires: { database: Database; logger: Logger }
  depends: Empty
  signals: Empty
}> {}

class AuditFlow extends Flow<{
  params: undefined
  result: undefined
  errors: never
  requires: { logger: Logger }
  depends: Empty
  signals: Empty
}> {}

const getUser = new GetUserFlow({ depends: {}, requires: ['database', 'logger'] }, ({ id }) => ({
  id
}))
const audit = new AuditFlow({ depends: {}, requires: ['logger'] }, () => undefined)
const users = new Layer('users', { getUser })
const application = new Layer('application', { users, audit })

users.getUser satisfies typeof getUser
application.users satisfies typeof users
application.audit satisfies typeof audit

type _Entries = LayerEntriesOf<typeof application>
type _Providers = LayerProvidersOf<typeof application>
type _Requirements = LayerRequirementsOf<typeof application>
type _Unprovided = LayerUnprovidedRequirementsOf<typeof application>

const database: Database = { find: (id) => id }
const logger: Logger = { log: () => undefined }
const withDatabase = application.provide({ database })
const complete = withDatabase.provide({ logger })
const overridden = complete.override({ database })

withDatabase.providers.database satisfies Database
complete.providers.logger satisfies Logger
overridden.providers.database satisfies Database

// @ts-expect-error duplicate inline provider key is rejected
withDatabase.provide({ database })
// @ts-expect-error only already-provided keys can be overridden
withDatabase.override({ logger })
// @ts-expect-error provider values must satisfy the effective requirement
application.provide({ database: { find: (_id: number) => 'invalid' } })
// @ts-expect-error Layer entries must be Flow implementations or Layers
new Layer('invalid', { invalid: {} })
// @ts-expect-error reserved names cannot be used as entries
new Layer('invalid', { provide: getUser })

type PrimaryService = { kind: 'primary'; run(): string }
type SecondaryService = { kind: 'secondary'; run(): string }
type UnionService = PrimaryService | SecondaryService

class UnionServiceFlow extends Flow<{
  params: undefined
  result: undefined
  errors: never
  requires: { service: UnionService }
  depends: Empty
  signals: Empty
}> {}

class CompatibleUnionServiceFlow extends Flow<{
  params: undefined
  result: undefined
  errors: never
  requires: { service: UnionService }
  depends: Empty
  signals: Empty
}> {}

const unionService = new UnionServiceFlow({ depends: {}, requires: ['service'] }, () => undefined)
const compatibleUnionService = new CompatibleUnionServiceFlow(
  { depends: {}, requires: ['service'] },
  () => undefined
)
const singleUnionLayer = new Layer('single-union', { unionService })
const duplicateUnionLayer = new Layer('duplicate-union', {
  unionService,
  compatibleUnionService
})

declare const singleUnionRequirement: LayerRequirementsOf<typeof singleUnionLayer>['service']
declare const duplicateUnionRequirement: LayerRequirementsOf<typeof duplicateUnionLayer>['service']
singleUnionRequirement satisfies UnionService
duplicateUnionRequirement satisfies UnionService
singleUnionLayer.provide({ service: { kind: 'primary', run: () => 'ok' } })
duplicateUnionLayer.provide({ service: { kind: 'secondary', run: () => 'ok' } })

class ConflictingLoggerFlow extends Flow<{
  params: undefined
  result: undefined
  errors: never
  requires: { logger: { write(value: number): void } }
  depends: Empty
  signals: Empty
}> {}

const conflictLayer = new Layer('conflict', {
  audit,
  conflicting: new ConflictingLoggerFlow({ depends: {}, requires: ['logger'] }, () => undefined)
})

type ConflictRequirements = LayerRequirementsOf<typeof conflictLayer>
declare const conflict: ConflictRequirements['logger']
conflict satisfies RequirementConflict<'logger'>

void application
void complete
