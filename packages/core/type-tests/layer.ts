import {
  type Flow,
  flow,
  Layer,
  type LayerEntriesOf,
  type LayerProvidersOf,
  type LayerRequirementsOf,
  type LayerUnprovidedRequirementsOf,
  type RequirementConflict
} from '../src/index'

type Database = { find(id: string): string }
type Logger = { log(message: string): void }

interface GetUserFlow extends Flow {
  params: { id: string }
  result: { id: string }
  requires: { database: Database; logger: Logger }
}

interface AuditFlow extends Flow {
  params: undefined
  result: undefined
  requires: { logger: Logger }
}

const getUser = flow<GetUserFlow>(({ id }) => ({ id }))
const audit = flow<AuditFlow>(() => undefined)
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
// Nested providers still satisfy bound Flow requirements across the complete Layer tree.
applicationWithNestedProviders.audit.run(undefined)

declare const applicationWithNestedProviderMap: LayerProvidersOf<
  typeof applicationWithNestedProviders
>
// @ts-expect-error LayerProvidersOf only includes providers directly attached to the Layer
applicationWithNestedProviderMap.logger

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

type Repository = { get(id: string): string }

interface RepositoryFlow extends Flow {
  params: undefined
  result: undefined
  requires: { repository: Repository }
}

interface TransitiveRequirementFlow extends Flow {
  params: undefined
  result: undefined
  depends: { repositoryWorker: RepositoryFlow }
}

const repository: Repository = { get: (id) => id }
const repositoryWorker = flow<RepositoryFlow>(() => undefined)
const transitiveRequirement = flow<TransitiveRequirementFlow>(
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

// Direct Flow effective requirements validate transitive provider values.
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
  dependencies: { repositoryWorker }
})
oneLevelTransitiveProvided.nested.transitiveRequirement.run(undefined, {
  dependencies: { repositoryWorker }
})
twoLevelTransitiveProvided.nested.nested.transitiveRequirement.run(undefined, {
  dependencies: { repositoryWorker }
})

const oneLevelTransitiveOverridden = oneLevelTransitiveProvided.override({ repository })
oneLevelTransitiveOverridden.nested.transitiveRequirement.run(undefined, {
  dependencies: { repositoryWorker }
})

// @ts-expect-error overrides validate nested transitive requirement values
oneLevelTransitiveProvided.override({ repository: 1 })

interface ConflictingTransitiveRepositoryFlow extends Flow {
  params: undefined
  result: undefined
  requires: { repository: number }
}

const conflictingTransitiveRepository = flow<ConflictingTransitiveRepositoryFlow>(() => undefined)
const nestedEffectiveConflictLayer = new Layer('nested-effective-conflict', {
  nested: oneLevelTransitiveLayer,
  conflictingTransitiveRepository
})
// @ts-expect-error nested effective requirement conflicts retain RequirementConflict validation
nestedEffectiveConflictLayer.provide({ repository })

type PrimaryService = { kind: 'primary'; run(): string }
type SecondaryService = { kind: 'secondary'; run(): string }
type UnionService = PrimaryService | SecondaryService

interface UnionServiceFlow extends Flow {
  params: undefined
  result: undefined
  requires: { service: UnionService }
}
interface CompatibleUnionServiceFlow extends Flow {
  params: undefined
  result: undefined
  requires: { service: UnionService }
}

const unionService = flow<UnionServiceFlow>(() => undefined)
const compatibleUnionService = flow<CompatibleUnionServiceFlow>(() => undefined)
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

interface DeclaredDependencyFlow extends Flow {
  params: { id: string }
  result: string
}
interface CompatibleDependencyFlow extends Flow {
  params: { id: string }
  result: string
}
interface IncompatibleDependencyFlow extends Flow {
  params: { count: number }
  result: number
}
interface DependencyCallerFlow extends Flow {
  params: undefined
  result: string
  depends: { child: DeclaredDependencyFlow }
}

const compatibleDependency = flow<CompatibleDependencyFlow>(({ id }) => id)
const incompatibleDependency = flow<IncompatibleDependencyFlow>(({ count }) => count)
const dependencyCaller = flow<DependencyCallerFlow>(async (_params, _requirements, { child }) =>
  child({ id: '1' })
)

new Layer('missing-dependency', { dependencyCaller })
new Layer('compatible-direct-dependency', { dependencyCaller, child: compatibleDependency })
// @ts-expect-error a present dependency alias must implement the declared Flow shape
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
  // @ts-expect-error a structurally resolved nested dependency must implement the declared Flow shape
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
  // @ts-expect-error a nested caller's global fallback must implement the declared Flow shape
  nestedDependencyCaller,
  child: incompatibleDependency
})
new Layer('ambiguous-global-dependency', {
  dependencyCaller,
  compatibleNestedDependency,
  incompatibleNestedDependency
})

interface ConflictingLoggerFlow extends Flow {
  params: undefined
  result: undefined
  requires: { logger: { write(value: number): void } }
}

const conflictLayer = new Layer('conflict', {
  audit,
  conflicting: flow<ConflictingLoggerFlow>(() => undefined)
})

type ConflictRequirements = LayerRequirementsOf<typeof conflictLayer>
declare const conflict: ConflictRequirements['logger']
conflict satisfies RequirementConflict<'logger'>

void application
void complete
