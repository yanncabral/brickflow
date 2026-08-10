import type {
  Engine,
  EngineExecutionHandle,
  EngineExecutionRequest,
  EngineStatus
} from '../src/index'

const engine: Engine = {
  start<Result, Error>(
    request: EngineExecutionRequest<Result, Error>
  ): EngineExecutionHandle<Result, Error> {
    void request.execute
    return {
      id: request.id,
      result: Promise.resolve({ ok: false, error: undefined as Error }),
      status: async (): Promise<EngineStatus> => 'queued',
      cancel: async () => {},
      signal: async () => undefined
    }
  }
}
void engine
