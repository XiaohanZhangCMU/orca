import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: { runtimeEnvironments: [{ id: 'pod', name: 'k8s-cpu' }] },
  route: vi.fn(),
  rpc: vi.fn()
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/lib/worktree-operation-route', () => ({
  resolveWorktreeOperationRouteResult: mocks.route
}))
vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await import('@/runtime/runtime-rpc-result')
  return { ...actual, callRuntimeRpc: mocks.rpc }
})
import {
  callManagerTeam,
  discoverManagerOpenCodeModels,
  managerTeamError,
  resolveManagerTeamTarget
} from './manager-team-client'
import { replaceRuntimeEnvironmentRevisions } from '@/runtime/runtime-environment-revision'

beforeEach(() => {
  vi.clearAllMocks()
  replaceRuntimeEnvironmentRevisions([{ id: 'pod', createdAt: 1, pairingRevision: 2 }])
})

describe('manager workspace owner routing', () => {
  it.each(['folder:one', 'git-worktree'])(
    'queries models on the selected host for %s without a laptop fallback',
    async (worktreeId) => {
      const host = {
        target: { kind: 'environment' as const, environmentId: 'pod' },
        label: 'k8s-cpu',
        pairingRevision: 2
      }
      mocks.rpc.mockResolvedValue({
        success: true,
        catalogOrigin: 'probe',
        models: [{ id: 'baseten/zai-org/GLM-5.2' }]
      })
      expect(await discoverManagerOpenCodeModels(host, worktreeId)).toEqual([
        { id: 'baseten/zai-org/GLM-5.2', label: 'GLM-5.2' }
      ])
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
        host.target,
        'managerTeam.models',
        { worktreeId },
        { timeoutMs: 75_000, expectedEnvironmentPairingRevision: 2 }
      )
      mocks.rpc.mockRejectedValue(new Error('Disconnected'))
      await expect(discoverManagerOpenCodeModels(host, worktreeId)).rejects.toThrow('Disconnected')
      expect(mocks.rpc).toHaveBeenCalledTimes(2)
    }
  )

  it('sends remote teams only to the owning runtime and pins its pairing revision', async () => {
    mocks.route.mockReturnValue({
      kind: 'resolved',
      route: { executionHostId: 'runtime:pod', runtimeEnvironmentId: 'pod' }
    })
    const host = resolveManagerTeamTarget('folder:one')
    expect(host).toEqual({
      target: { kind: 'environment', environmentId: 'pod' },
      label: 'k8s-cpu',
      pairingRevision: 2
    })
    mocks.rpc.mockResolvedValue({
      run: '/remote/run',
      report: '/remote/report.html',
      stage: 'prepared'
    })
    const run = { worktreeId: 'folder:one', requestId: crypto.randomUUID() }
    await callManagerTeam(host, 'inspect', run)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(host.target, 'managerTeam.inspect', run, {
      timeoutMs: 135_000,
      expectedEnvironmentPairingRevision: 2
    })
    mocks.rpc.mockRejectedValue(new Error('Disconnected'))
    await expect(callManagerTeam(host, 'launch', run)).rejects.toThrow('Disconnected')
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it.each([
    { kind: 'missing' },
    { kind: 'ambiguous' },
    { kind: 'resolved', route: { executionHostId: 'ssh:pod', runtimeEnvironmentId: null } },
    {
      kind: 'resolved',
      route: { executionHostId: 'runtime:missing', runtimeEnvironmentId: 'missing' }
    },
    { kind: 'resolved', route: { executionHostId: 'runtime:pod', runtimeEnvironmentId: null } }
  ])('refuses unresolved/SSH ownership without local substitution: %j', (route) => {
    mocks.route.mockReturnValue(route)
    expect(() => resolveManagerTeamTarget('workspace')).toThrow()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('accepts explicit local ownership', () => {
    mocks.route.mockReturnValue({
      kind: 'resolved',
      route: { executionHostId: 'local', runtimeEnvironmentId: null }
    })
    expect(resolveManagerTeamTarget('folder:one').target).toEqual({ kind: 'local' })
  })

  it('gives an upgrade explanation when a new client reaches an old host', () => {
    expect(
      managerTeamError(Object.assign(new Error('method_not_found'), { code: 'method_not_found' }))
    ).toContain('Update its Orca server to this fork')
  })

  it('explains missing model-list support without trying local discovery', async () => {
    mocks.rpc.mockRejectedValue(
      Object.assign(new Error('method_not_found'), { code: 'method_not_found' })
    )
    await expect(
      discoverManagerOpenCodeModels(
        { target: { kind: 'environment', environmentId: 'pod' }, label: 'Pod', pairingRevision: 2 },
        'folder:one'
      )
    ).rejects.toThrow('Update this host’s Orca server to load OpenCode models')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})
