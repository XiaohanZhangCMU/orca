import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { MANAGER_TEAM_METHODS } from './manager-team-rpc'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  scope: vi.fn(),
  folderModels: vi.fn(),
  gitModels: vi.fn()
}))
vi.mock('./manager-team-model-discovery', () => ({
  discoverFolderOpenCodeModels: mocks.folderModels
}))
vi.mock('./manager-team-process', () => ({
  resolveManagerAssets: async () => ({ publisher: '/host/manager.cjs', orca: '/host/orca.cjs' }),
  callManager: mocks.call
}))

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The dispatcher and handlers only consume the runtime ports implemented by this fixture.
const runtime = {
  getRuntimeId: () => 'host-id',
  showTerminalWorkspaceLaunchScope: mocks.scope,
  getClientSettings: () => ({ agentCmdOverrides: { opencode: 'ocskip' } }),
  discoverRuntimeCommitMessageModels: mocks.gitModels
} as unknown as OrcaRuntimeService
const dispatcher = new RpcDispatcher({ runtime, methods: MANAGER_TEAM_METHODS })
const requestId = '76a6583a-0db7-4395-9656-e34598701235'
const team = {
  objective: 'Fixture',
  manager: 'claude',
  workers: [{ name: 'Reviewer', provider: 'cursor', model: 'fixture-model' }]
}
const dispatch = (action: string, params: unknown) =>
  dispatcher.dispatch({ id: 'req', authToken: 'fixture', method: `managerTeam.${action}`, params })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.scope.mockResolvedValue({
    id: 'folder:one',
    path: '/host/folder',
    connectionId: null,
    repo: null,
    folderWorkspace: { executionHostId: 'local' }
  })
})

describe('manager team host RPC', () => {
  it('lists folder models without assuming a Git worktree or launching a manager', async () => {
    const result = { success: true, catalogOrigin: 'probe', models: [{ id: 'baseten/model' }] }
    mocks.folderModels.mockResolvedValue(result)
    expect(await dispatch('models', { worktreeId: 'folder:one' })).toMatchObject({
      ok: true,
      result
    })
    expect(mocks.scope).toHaveBeenCalledExactlyOnceWith('id:folder:one')
    expect(mocks.folderModels).toHaveBeenCalledExactlyOnceWith('/host/folder', 'ocskip')
    expect(mocks.gitModels).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('reuses Git workspace discovery and its execution-runtime routing', async () => {
    mocks.scope.mockResolvedValue({
      id: 'git-one',
      path: '/host/repo',
      connectionId: null,
      repo: { executionHostId: 'local' },
      folderWorkspace: null
    })
    mocks.gitModels.mockResolvedValue({ success: false, error: 'No CLI' })
    expect(await dispatch('models', { worktreeId: 'git-one' })).toMatchObject({
      ok: true,
      result: { success: false, error: 'No CLI' }
    })
    expect(mocks.gitModels).toHaveBeenCalledExactlyOnceWith('id:git-one', 'opencode')
    expect(mocks.folderModels).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('prepares a host-resolved folder with a pinned runtime and mixed-provider definition', async () => {
    mocks.call.mockResolvedValue({ run: '/host/run', report: '/host/report.html' })
    const result = await dispatch('prepare', { worktreeId: 'folder:one', requestId, team })
    expect(result).toMatchObject({ ok: true, result: { stage: 'prepared' } })
    expect(mocks.scope).toHaveBeenCalledExactlyOnceWith('id:folder:one')
    const [publisher, cwd, args] = mocks.call.mock.calls[0]
    expect(publisher).toBe('/host/manager.cjs')
    expect(cwd).toBe('/host/folder')
    expect(args).toEqual([
      'prepare',
      '--workspace',
      '/host/folder',
      '--orca',
      '/host/orca.cjs',
      '--request-id',
      requestId,
      '--team',
      JSON.stringify(team),
      '--workspace-id',
      'folder:one',
      '--runtime-id',
      'host-id',
      '--publisher-node',
      'node'
    ])
  })

  it.each([
    { connectionId: 'ssh:one', repo: {}, folderWorkspace: null },
    { connectionId: null, repo: { executionHostId: 'runtime:another' }, folderWorkspace: null },
    { connectionId: null, repo: null, folderWorkspace: { executionHostId: 'ssh:one' } },
    { connectionId: null, repo: null, folderWorkspace: null }
  ])('refuses nonlocal or missing scope before running any process: %j', async (scope) => {
    mocks.scope.mockResolvedValue({ id: 'one', path: '/remote/path', ...scope })
    expect(await dispatch('prepare', { worktreeId: 'one', requestId, team })).toMatchObject({
      ok: false
    })
    expect(mocks.call).not.toHaveBeenCalled()
    expect(await dispatch('models', { worktreeId: 'one' })).toMatchObject({ ok: false })
    expect(mocks.gitModels).not.toHaveBeenCalled()
    expect(mocks.folderModels).not.toHaveBeenCalled()
  })

  it('inspect reads the saved receipt without launching an agent', async () => {
    mocks.call.mockResolvedValue({
      report: '/host/report.html',
      launch: { stage: 'unverifiable', terminal: 'term_1', error: 'Lost contact' }
    })
    expect(await dispatch('inspect', { worktreeId: 'folder:one', requestId })).toMatchObject({
      ok: true,
      result: { stage: 'unverifiable', terminal: 'term_1' }
    })
    expect(mocks.call.mock.calls[0][2]).toEqual([
      'show',
      '--run',
      join('/host/folder', '.orca-manager', 'runs', requestId)
    ])
  })

  it('rejects path traversal IDs and invalid worker models at the RPC boundary', async () => {
    expect(
      await dispatch('launch', { worktreeId: 'one', requestId: '../../outside' })
    ).toMatchObject({ ok: false })
    expect(
      await dispatch('prepare', {
        worktreeId: 'one',
        requestId,
        team: { ...team, workers: [{ name: 'Bad', provider: 'codex', model: 'x; echo injected' }] }
      })
    ).toMatchObject({ ok: false })
    expect(mocks.scope).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
  })
})
