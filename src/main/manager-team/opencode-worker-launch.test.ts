import { describe, expect, it } from 'vitest'
import { resolveWorkerLaunchPreferences } from '../runtime/rpc/methods/orchestration/worker/worker-launch-preferences'
import { WorkerStartParams } from '../../shared/rpc-contract/orchestration-worker-start-params'
import { managerTeamPrepareSchema } from '../../shared/manager-team-contract'

describe('OpenCode team worker integration', () => {
  it('accepts the selected provider/model through both team and upstream worker boundaries', () => {
    const model = 'local-fixture/org/model:Q4_K_M'
    const parsed = managerTeamPrepareSchema.parse({
      worktreeId: 'folder:one',
      requestId: '76a6583a-0db7-4395-9656-e34598701235',
      team: {
        objective: 'Fixture',
        manager: 'codex',
        workers: [{ name: 'IC', provider: 'opencode', model }]
      }
    })
    const worker = parsed.team.workers[0]
    expect(
      WorkerStartParams.safeParse({
        spec: 'Fixture',
        from: 'term_manager',
        agent: worker.provider,
        model: worker.model
      }).success
    ).toBe(true)
    expect(resolveWorkerLaunchPreferences({ agent: worker.provider, model: worker.model })).toEqual(
      {
        preferences: { model },
        receipt: {
          requested: { agent: 'opencode', model, effort: null },
          effective: { agent: 'opencode', model, effort: null }
        }
      }
    )
  })

  it('keeps the configured default when no explicit model is selected', () => {
    expect(resolveWorkerLaunchPreferences({ agent: 'opencode' }).preferences).toBeUndefined()
  })

  it('refuses unsupported effort instead of silently dropping it', () => {
    expect(() =>
      resolveWorkerLaunchPreferences({ agent: 'opencode', model: 'fixture/model', effort: 'high' })
    ).toThrow('does not support effort high')
  })
})
