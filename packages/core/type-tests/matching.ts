import { P } from '../src/index'
import { createMatchingBuilder } from '../src/matching/builder'
import type { MatchingBuilder } from '../src/matching/types'

type Failure = 'missing' | 'denied' | { type: 'unavailable'; retryAfter: number }
const initial = createMatchingBuilder<Failure, { id: string }>(async () => ({
  ok: false,
  error: 'missing'
}))

const literal = initial.with('missing', () => ({ anonymous: true as const }))
literal satisfies MatchingBuilder<
  Failure,
  { id: string },
  { id: string } | { readonly anonymous: true },
  'denied' | { type: 'unavailable'; retryAfter: number }
>

const conditional = initial.with('missing', () => (Math.random() ? 'fallback' : undefined))
conditional satisfies MatchingBuilder<Failure, { id: string }, { id: string } | string, Failure>

const object = initial.with({ type: 'unavailable' }, (error) => error.retryAfter.toString())
object satisfies MatchingBuilder<
  Failure,
  { id: string },
  { id: string } | string,
  'missing' | 'denied'
>

const exhaustive = initial.with(P._, () => 'fallback')
exhaustive satisfies MatchingBuilder<Failure, { id: string }, { id: string } | string, never>

// @ts-expect-error arrays are outside the supported public matching contract
initial.with(['missing'], () => 'nope')
