import {
  type Brick,
  brick,
  Layer,
  type LayerEntriesOf,
  type LayerProvidersOf,
  type LayerRequirementsOf,
  type LayerUnprovidedRequirementsOf,
  type RequirementConflict
} from '../src/index'

type Database = { find(id: string): string }
type Logger = { log(message: string): void }

interface GetUserBrick extends Brick {
  params: { id: string }
  result: { id: string }
  requires: { database: Database; logger: Logger }
}

interface AuditBrick extends Brick {
  params: undefined
  result: undefined
  requires: { logger: Logger }
}

const getUser = brick<GetUserBrick>(({ id }) => ({ id }))
const audit = brick<AuditBrick>(() => undefined)
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

const nestedComplete = users.provide({ database, logger })
const applicationWithNestedProviders = new Layer('application-with-nested-providers', {
  users: nestedComplete,
  audit
})

// @ts-expect-error nested-only providers are not exposed on the outer Layer
applicationWithNestedProviders.providers.database
// Nested providers still satisfy bound Brick requirements across the complete Layer tree.
applicationWithNestedProviders.audit.run(undefined)

declare const applicationWithNestedProviderMap: LayerProvidersOf<
  typeof applicationWithNestedProviders
>
// @ts-expect-error LayerProvidersOf only includes providers directly attached to the Layer
applicationWithNestedProviderMap.logger

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Expect<Value extends true> = Value

type _NestedDatabaseIsProvided = Expect<
  Equal<keyof LayerUnprovidedRequirementsOf<typeof applicationWithNestedProviders>, never>
>
type _NestedProviderIsNotDirect = Expect<
  Equal<keyof LayerProvidersOf<typeof applicationWithNestedProviders>, never>
>

// @ts-expect-error duplicate inline provider key is rejected
withDatabase.provide({ database })
// @ts-expect-error only already-provided keys can be overridden
withDatabase.override({ logger })
// @ts-expect-error provider values must satisfy the effective requirement
application.provide({ database: { find: (_id: number) => 'invalid' } })
// @ts-expect-error Layer entries must be Brick implementations or Layers
new Layer('invalid', { invalid: {} })
// @ts-expect-error reserved names cannot be used as entries
new Layer('invalid', { provide: getUser })

declare const symbolLayerEntry: unique symbol
// @ts-expect-error Layer entry keys must be string keys
new Layer('invalid', { [symbolLayerEntry]: getUser })
// @ts-expect-error numeric Layer entry keys must be rejected instead of stringified
new Layer('invalid', { 0: getUser })

// @ts-expect-error Layer IDs must not be empty
new Layer('', { getUser })
// @ts-expect-error Layer entry keys must not be empty
new Layer('valid', { '': getUser })
// @ts-expect-error dot is reserved in Layer IDs
new Layer('invalid.id', { getUser })
// @ts-expect-error dot is reserved in Layer entry keys
new Layer('valid', { 'get.user': getUser })

type Repository = { get(id: string): string }

interface RepositoryBrick extends Brick {
  params: undefined
  result: undefined
  requires: { repository: Repository }
}

interface TransitiveRequirementBrick extends Brick {
  params: undefined
  result: undefined
  depends: { repositoryWorker: RepositoryBrick }
}

const repository: Repository = { get: (id) => id }
const repositoryWorker = brick<RepositoryBrick>(() => undefined)
const transitiveRequirement = brick<TransitiveRequirementBrick>(
  async (_params, _requirements, { repositoryWorker: runRepositoryWorker }) =>
    runRepositoryWorker(undefined)
)

const directTransitiveLayer = new Layer('direct-transitive', { transitiveRequirement })
const oneLevelTransitiveLayer = new Layer('one-level-transitive', {
  nested: directTransitiveLayer
})
const twoLevelTransitiveLayer = new Layer('two-level-transitive', {
  nested: oneLevelTransitiveLayer
})

type _TransitiveRepositoryRemainsUnprovided = Expect<
  Equal<
    LayerUnprovidedRequirementsOf<typeof twoLevelTransitiveLayer>,
    Readonly<{ repository: Repository }>
  >
>

// Direct Brick effective requirements validate transitive provider values.
// @ts-expect-error transitive provider must satisfy Repository
directTransitiveLayer.provide({ repository: 1 })
// Nested Layers preserve effective requirement validation at every level.
// @ts-expect-error one nested Layer level must preserve the transitive requirement type
oneLevelTransitiveLayer.provide({ repository: 1 })
// @ts-expect-error two nested Layer levels must preserve the transitive requirement type
twoLevelTransitiveLayer.provide({ repository: 1 })

const directTransitiveProvided = directTransitiveLayer.provide({ repository })
const oneLevelTransitiveProvided = oneLevelTransitiveLayer.provide({ repository })
const twoLevelTransitiveProvided = twoLevelTransitiveLayer.provide({ repository })

// Valid providers remove the transitive requirement from bound run options.
directTransitiveProvided.transitiveRequirement.run(undefined, {
  dependencies: { repositoryWorker: { brick: repositoryWorker } }
})
oneLevelTransitiveProvided.nested.transitiveRequirement.run(undefined, {
  dependencies: { repositoryWorker: { brick: repositoryWorker } }
})
twoLevelTransitiveProvided.nested.nested.transitiveRequirement.run(undefined, {
  dependencies: { repositoryWorker: { brick: repositoryWorker } }
})

const oneLevelTransitiveOverridden = oneLevelTransitiveProvided.override({ repository })
oneLevelTransitiveOverridden.nested.transitiveRequirement.run(undefined, {
  dependencies: { repositoryWorker: { brick: repositoryWorker } }
})

// @ts-expect-error overrides validate nested transitive requirement values
oneLevelTransitiveProvided.override({ repository: 1 })

const postgresRepository: Repository = { get: (id) => `postgres-${id}` }
const memoryRepository: Repository = { get: (id) => `memory-${id}` }
const nestedRepositoryProvided = new Layer('nested-repository-provided', {
  repositoryWorker
}).provide({
  repository: postgresRepository
})
const outerRepositoryProvided = new Layer('outer-repository-provided', {
  nested: nestedRepositoryProvided
})

// @ts-expect-error nested effective provider keys cannot be provided again with a correct value
outerRepositoryProvided.provide({ repository: memoryRepository })
// @ts-expect-error nested effective provider keys cannot be provided again with an incorrect value
outerRepositoryProvided.provide({ repository: 1 })
// @ts-expect-error exact empty provider maps reject arbitrary extra keys
outerRepositoryProvided.provide({ arbitrary: true })

const outerRepositoryOverridden = outerRepositoryProvided.override({
  repository: memoryRepository
})
outerRepositoryOverridden.providers.repository satisfies Repository
outerRepositoryOverridden.nested.repositoryWorker.run(undefined)

// @ts-expect-error nested effective overrides validate the effective requirement value
outerRepositoryProvided.override({ repository: 1 })
// @ts-expect-error truly absent provider keys cannot be overridden
outerRepositoryProvided.override({ arbitrary: true })

interface ConflictingTransitiveRepositoryBrick extends Brick {
  params: undefined
  result: undefined
  requires: { repository: number }
}

const conflictingTransitiveRepository = brick<ConflictingTransitiveRepositoryBrick>(() => undefined)
const nestedEffectiveConflictLayer = new Layer('nested-effective-conflict', {
  nested: oneLevelTransitiveLayer,
  conflictingTransitiveRepository
})
// @ts-expect-error nested effective requirement conflicts retain RequirementConflict validation
nestedEffectiveConflictLayer.provide({ repository })

type PrimaryService = { kind: 'primary'; run(): string }
type SecondaryService = { kind: 'secondary'; run(): string }
type UnionService = PrimaryService | SecondaryService

interface UnionServiceBrick extends Brick {
  params: undefined
  result: undefined
  requires: { service: UnionService }
}
interface CompatibleUnionServiceBrick extends Brick {
  params: undefined
  result: undefined
  requires: { service: UnionService }
}

const unionService = brick<UnionServiceBrick>(() => undefined)
const compatibleUnionService = brick<CompatibleUnionServiceBrick>(() => undefined)
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

interface DeclaredDependencyBrick extends Brick {
  params: { id: string }
  result: string
}
interface CompatibleDependencyBrick extends Brick {
  params: { id: string }
  result: string
}
interface IncompatibleDependencyBrick extends Brick {
  params: { count: number }
  result: number
}
interface DependencyCallerBrick extends Brick {
  params: undefined
  result: string
  depends: { child: DeclaredDependencyBrick }
}

const compatibleDependency = brick<CompatibleDependencyBrick>(({ id }) => id)
const incompatibleDependency = brick<IncompatibleDependencyBrick>(({ count }) => count)
const dependencyCaller = brick<DependencyCallerBrick>(async (_params, _requirements, { child }) =>
  child({ id: '1' })
)

new Layer('missing-dependency', { dependencyCaller })
new Layer('compatible-direct-dependency', { dependencyCaller, child: compatibleDependency })
// @ts-expect-error a present dependency alias must implement the declared Brick shape
new Layer('incompatible-direct-dependency', { dependencyCaller, child: incompatibleDependency })

const compatibleNestedDependency = new Layer('compatible-nested-dependency', {
  child: compatibleDependency
})
const incompatibleNestedDependency = new Layer('incompatible-nested-dependency', {
  child: incompatibleDependency
})
new Layer('compatible-global-dependency', {
  dependencyCaller,
  compatibleNestedDependency
})
new Layer('incompatible-global-dependency', {
  // @ts-expect-error a structurally resolved nested dependency must implement the declared Brick shape
  dependencyCaller,
  incompatibleNestedDependency
})
new Layer('direct-dependency-takes-scope-precedence', {
  dependencyCaller,
  child: compatibleDependency,
  incompatibleNestedDependency
})

const nestedDependencyCaller = new Layer('nested-dependency-caller', { dependencyCaller })
new Layer('compatible-top-level-fallback', {
  nestedDependencyCaller,
  child: compatibleDependency
})

new Layer('incompatible-top-level-fallback', {
  // @ts-expect-error a nested caller's global fallback must implement the declared Brick shape
  nestedDependencyCaller,
  child: incompatibleDependency
})
new Layer('ambiguous-global-dependency', {
  dependencyCaller,
  compatibleNestedDependency,
  incompatibleNestedDependency
})

interface ConflictingLoggerBrick extends Brick {
  params: undefined
  result: undefined
  requires: { logger: { write(value: number): void } }
}

const conflictLayer = new Layer('conflict', {
  audit,
  conflicting: brick<ConflictingLoggerBrick>(() => undefined)
})

type ConflictRequirements = LayerRequirementsOf<typeof conflictLayer>
declare const conflict: ConflictRequirements['logger']
conflict satisfies RequirementConflict<'logger'>

void application
void complete
