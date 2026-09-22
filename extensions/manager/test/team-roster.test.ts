import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareSession, loadSession } from '../src/report-store'
import { verifyLocalWorkspace } from '../src/launch-manager'
import { managerTeamDefinitionSchema } from '../../../src/shared/manager-team-contract'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('per-worker launch settings', () => {
  it('round-trips a mixed roster and publishes exact provider/model arguments', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'orca-team-roster-'))
    roots.push(workspace)
    const input = {
      workspace,
      objective: 'Verify the change',
      workers: 4,
      managerAgent: 'codex' as const,
      workerAgent: 'codex' as const,
      workerProfiles: [
        { name: 'Builder', provider: 'claude' as const, model: 'test-sonnet' },
        { name: 'Reviewer', provider: 'codex' as const, model: 'test-reasoner' },
        { name: 'Verifier', provider: 'cursor' as const },
        {
          name: 'Local reviewer',
          provider: 'opencode' as const,
          model: 'local-fixture/org/model:Q4_K_M'
        }
      ],
      orca: process.execPath,
      publisher: '/fixture/manager.cjs',
      publisherNode: 'node'
    }
    const requestId = randomUUID()
    const run = await prepareSession(input, requestId)
    expect((await loadSession(run)).workerProfiles).toEqual(input.workerProfiles)
    const prompt = await readFile(join(run, 'manager-prompt.md'), 'utf8')
    expect(prompt).toContain('["--agent","claude","--model","test-sonnet"]')
    expect(prompt).toContain('["--agent","codex","--model","test-reasoner"]')
    expect(prompt).toContain('["--agent","cursor"]')
    expect(prompt).toContain('["--agent","opencode","--model","local-fixture/org/model:Q4_K_M"]')
    expect(prompt).toContain('Do not substitute providers/models')
    expect(prompt).toContain('["node","/fixture/manager.cjs","publish"')
    expect(await prepareSession(input, requestId)).toBe(run)
    await expect(
      prepareSession({ ...input, objective: 'Different objective' }, requestId)
    ).rejects.toThrow('different team')
    await expect(prepareSession(input, '../../outside')).rejects.toThrow()
  })

  it('requires a nonempty, bounded roster with distinct names and safe model IDs', () => {
    const valid = {
      objective: 'Review',
      manager: 'claude',
      workers: [{ name: 'Reviewer', provider: 'codex' }]
    }
    expect(managerTeamDefinitionSchema.safeParse(valid).success).toBe(true)
    expect(
      managerTeamDefinitionSchema.safeParse({
        ...valid,
        workers: [{ name: 'Default worker', provider: 'opencode' }]
      }).success
    ).toBe(true)
    for (const workers of [
      [],
      Array(9).fill(valid.workers[0]),
      [valid.workers[0], valid.workers[0]],
      [{ name: 'Test', provider: 'unknown' }],
      [{ name: 'Test', provider: 'claude', model: '--dangerous' }],
      [{ name: 'Test', provider: 'opencode', model: 'missing-provider' }],
      [{ name: 'Test', provider: 'opencode', model: 'provider/' }]
    ]) {
      expect(managerTeamDefinitionSchema.safeParse({ ...valid, workers }).success).toBe(false)
    }
  })

  it('uses the host-validated folder binding without assuming it has a Git repo', async () => {
    const call = vi.fn(async () => ({
      target: { kind: 'local' },
      runtime: {
        reachable: true,
        runtimeId: 'pod',
        capabilities: ['terminal.prompt-delivery.v1', 'orchestration.contract.v1']
      }
    }))
    expect(
      await verifyLocalWorkspace(call, '/folder', { workspaceId: 'folder:one', runtimeId: 'pod' })
    ).toEqual({ workspaceId: 'folder:one', runtimeId: 'pod' })
    expect(call).toHaveBeenCalledExactlyOnceWith(['status'])
    await expect(
      verifyLocalWorkspace(call, '/folder', { workspaceId: 'folder:one', runtimeId: 'other' })
    ).rejects.toThrow('owning runtime changed')
  })
})
