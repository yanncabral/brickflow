# Manual de arquiteturas com Brick

Este manual define como organizar aplicações usando `Brick` como unidade de
comportamento e `Layer` como unidade de composição.

## 1. Comece pelo comportamento

Uma operação relevante deve nascer como um use case com contrato explícito:

```ts
type CreateUser = Brick<{
  params: { email: string; name: string }
  result: User
  errors: { type: 'email-already-used'; email: string }
  requires: { userRepository: UserRepository; clock: () => Date }
}>
```

Contraexemplo: começar por uma classe `UserService` com dezenas de métodos.
Isso normalmente faz o banco definir o desenho do comportamento.

## 2. Organize por slices verticais

Cada módulo deve conter tudo relacionado à sua capacidade:

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

O mesmo padrão vale para `users/`. Não espalhe `users` entre pastas globais
`domain`, `application` e `infrastructure` quando o objetivo é plugabilidade.

## 3. O Layer é a interface do módulo

O arquivo `sessions-module.ts` exporta os use cases como Layer:

```ts
export const sessionsLayer = new Layer('sessions', {
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions
})

export type SessionsModule = typeof sessionsLayer
```

Não repita essa forma em uma interface TypeScript manual:

```ts
// Contraexemplo
interface SessionsModule {
  createSession: unknown
  revokeSession: unknown
}
```

O tipo derivado do Layer preserva contratos, falhas, requisitos, dependências
e opções de execução. Ele é a fonte de verdade do módulo.

## 4. Separe comportamento de capacidade

Repositories e serviços técnicos são requisitos estruturais:

```ts
interface SessionRepository {
  findById(id: string): Promise<Session | undefined>
  insert(session: Session): Promise<void>
  update(session: Session): Promise<void>
}
```

O use case declara o requisito:

```ts
type RevokeSession = Brick<{
  params: { id: string }
  result: undefined
  errors: { type: 'session-not-found'; id: string }
  requires: { sessionRepository: SessionRepository; clock: () => Date }
}>
```

O adapter Drizzle implementa o repository; não decide autorização ou o
significado de uma sessão revogada.

```ts
// Contraexemplo: regra de negócio escondida no adapter
await db.delete(sessions).where(eq(sessions.id, id))
```

## 5. Use `depends` e `requires` corretamente

Use `depends` para comportamento fornecido por outro Brick:

```ts
type AuthenticateUser = Brick<{
  params: LoginInput
  result: AuthenticatedSession
  errors: UserErrors | SessionErrors
  depends: { findUserByEmail: FindUserByEmail }
}>
```

Use `requires` para capacidades técnicas:

```ts
requires: {
  passwordHasher: PasswordHasher
  sessionRepository: SessionRepository
}
```

Contraexemplo: importar `drizzleUserRepository` diretamente dentro do use
case. Isso elimina o seam e dificulta testes e substituições.

## 6. Falhas são locais e composable

Não crie um catálogo obrigatório de falhas por módulo. Declare as falhas no
contrato que as produz:

```ts
type RefreshSession = Brick<{
  params: { token: string }
  result: Session
  errors:
    | { type: 'session-not-found' }
    | { type: 'session-expired' }
    | { type: 'session-revoked' }
  requires: { sessionRepository: SessionRepository }
}>
```

Use unions para compor falhas entre módulos. Não transforme falhas tipadas em
`Error` genérico; defects inesperados continuam sendo defects.

## 7. Componha Layers imutáveis

O Layer base contém os Bricks:

```ts
export const sessionsLayer = new Layer('sessions', {
  createSession,
  refreshSession,
  revokeSession
})
```

Layers de ambiente fornecem adapters:

```ts
export const sessionsMemoryLayer = sessionsLayer.provide({
  sessionRepository: memorySessionRepository,
  clock: fixedClock
})
```

Use `.provide()` para requisitos ausentes e `.override()` para substituir um
provider existente. Nunca altere um Layer em lugar.

```ts
// Contraexemplo
container.register('sessionRepository', repository)
globalThis.sessionRepository = repository
```

## 8. A aplicação apenas compõe módulos

```ts
export const appLayer = new Layer('app', {
  users: usersProductionLayer,
  sessions: sessionsProductionLayer,
  authorization: authorizationLayer
})
```

O código consumidor usa a interface pública do Layer:

```ts
await appLayer.sessions.revokeSession.run({ id: sessionId })
```

Ele não deve importar adapters ou arquivos internos do módulo.

## 9. Valide nas fronteiras

HTTP, banco, filas e serialização carregam dados não confiáveis:

```text
request desconhecido
    ↓ schema.parse
input validado
    ↓
Brick
```

Contraexemplo: aceitar qualquer string como `Email` porque a marca TypeScript
não existe em runtime. Revalide após persistência ou serialização.

## 10. Signals são interação, não dependência comum

Use `depends` para chamar outro Brick. Use `Signal` quando a execução precisa
de uma resposta externa, como aprovação MFA:

```ts
signals: {
  requireMfa: {
    request: { userId: string }
    response: { approved: boolean }
  }
}
```

Contraexemplo: usar Signals para substituir todas as chamadas entre use cases.
Isso torna o grafo indireto e exige handlers onde não há interação real.

## 11. Teste pela interface do módulo

Use adapters em memória e atravesse o Layer público:

```ts
const testApp = new Layer('app', {
  users: usersMemoryLayer,
  sessions: sessionsMemoryLayer
})

const user = await testApp.users.createUser.run(input)
```

Se o teste precisa conhecer detalhes internos, o módulo provavelmente tem uma
interface rasa ou um seam mal colocado.

## Checklist

- O módulo representa uma capacidade coesa?
- Seu `*-module.ts` exporta um Layer de use cases?
- O tipo público é derivado do Layer?
- Cada use case possui contrato nomeado?
- As falhas estão nos contratos que as produzem?
- `depends` representa comportamento e `requires` representa capacidades?
- Adapters podem ser trocados por Layers?
- Nenhum Layer ou provider é mutado?
- Fronteiras validam dados de runtime?
- Testes atravessam a interface pública?
- O core permanece independente de HTTP, banco e adapters duráveis?
