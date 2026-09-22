import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareSession } from '../src/report-store'
import { launchManager, messageManager, verifyLocalWorkspace } from '../src/launch-manager'
import { readJson } from '../src/scoped-files'
import { OrcaCommandError } from '../src/orca-process'

const roots: string[] = []
const capabilities = ['terminal.prompt-delivery.v1', 'orchestration.contract.v1']
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-manager-launch-')))
  roots.push(root)
  const run = await prepareSession({
    workspace: root,
    objective: 'Check the target; no implementation',
    workers: 2,
    managerAgent: 'codex',
    workerAgent: 'claude',
    orca: process.execPath,
    publisher: '/test/manager.cjs'
  })
  const call = vi.fn(async (args: string[]): Promise<unknown> => {
    switch (args.slice(0, 2).join(' ')) {
      case 'status':
        return {
          target: { kind: 'local' },
          runtime: { reachable: true, runtimeId: 'host-a', capabilities }
        }
      case 'worktree show':
        return { worktree: { id: 'folder:one', repoId: 'project', path: root, hostId: 'local' } }
      case 'repo show':
        return { repo: { connectionId: null, executionHostId: 'local' } }
      case 'terminal create':
        return {
          terminal: { handle: 'term_manager', worktreeId: 'folder:one', executionHostId: 'local' }
        }
      case 'terminal wait':
        return { wait: { satisfied: true } }
      case 'terminal send':
        return {
          send: { handle: 'term_manager', accepted: true, prompt: { stages: ['input_accepted'] } }
        }
      default:
        throw new Error(`Unexpected command: ${args.join(' ')}`)
    }
  })
  return { root, run, call }
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('Orca-owned manager launch', () => {
  it('launches once, waits for readiness, and submits a prompt without shell interpolation', async () => {
    const { run, call } = await fixture()
    expect(await launchManager(run, call)).toMatchObject({
      stage: 'prompt-accepted',
      terminal: 'term_manager'
    })
    expect(call.mock.calls.map(([args]) => args.slice(0, 2).join(' '))).toEqual([
      'status',
      'worktree show',
      'repo show',
      'terminal create',
      'terminal wait',
      'terminal send'
    ])
    expect(call.mock.calls[3][0]).toEqual([
      'terminal',
      'create',
      '--worktree',
      'id:folder:one',
      '--title',
      'Manager',
      '--command',
      'codex'
    ])
    expect(call.mock.calls[5][0][5]).toContain('Manager assignment')
    await expect(launchManager(run, call)).rejects.toThrow('already has a launch receipt')
    expect(call.mock.calls.filter(([args]) => args[1] === 'create')).toHaveLength(1)
  })

  it('refuses a remote/default environment before creating any terminal', async () => {
    const { root, call } = await fixture()
    call.mockResolvedValueOnce({
      target: { kind: 'environment', environment: 'pod' },
      runtime: { reachable: true, runtimeId: 'remote' }
    })
    await expect(verifyLocalWorkspace(call, root)).rejects.toThrow('execution host')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it.each(['ssh:server', 'runtime:pod'])(
    'refuses workspace owner %s without a local fallback',
    async (hostId) => {
      const { root, call } = await fixture()
      call.mockResolvedValueOnce({
        target: { kind: 'local' },
        runtime: { reachable: true, runtimeId: 'host-a', capabilities }
      })
      call.mockResolvedValueOnce({ worktree: { id: 'w', repoId: 'project', path: root, hostId } })
      await expect(verifyLocalWorkspace(call, root)).rejects.toThrow('another host')
      expect(call.mock.calls.some(([args]) => args[0] === 'terminal')).toBe(false)
    }
  )

  it('retains ambiguous mutation receipts and never automatically retries or closes terminals', async () => {
    const { run, call } = await fixture()
    const original = call.getMockImplementation()!
    call.mockImplementation(async (args) => {
      if (args[1] === 'send') {
        throw new OrcaCommandError('lost reply', { recovery: { requestId: 'same-request' } })
      }
      return original(args)
    })
    await expect(launchManager(run, call)).rejects.toThrow('do not start a duplicate')
    expect(await readJson(join(run, 'launch.json'))).toMatchObject({
      stage: 'unverifiable',
      terminal: 'term_manager',
      failedStage: 'submitting-prompt',
      receipt: { recovery: { requestId: 'same-request' } }
    })
    expect(call.mock.calls.filter(([args]) => args[1] === 'send')).toHaveLength(1)
    expect(call.mock.calls.some(([args]) => args.includes('close'))).toBe(false)
  })

  it('does not send a prompt if readiness is unproven', async () => {
    const { run, call } = await fixture()
    const original = call.getMockImplementation()!
    call.mockImplementation((args) =>
      args[1] === 'wait' ? Promise.resolve({ wait: { satisfied: false } }) : original(args)
    )
    await expect(launchManager(run, call)).rejects.toThrow('inspection')
    expect(call.mock.calls.some(([args]) => args[1] === 'send')).toBe(false)
  })

  it('fences messages after a runtime change and does not send user text to an idle shell', async () => {
    const { run, call } = await fixture()
    await launchManager(run, call)
    call.mockClear()
    call.mockResolvedValueOnce({
      target: { kind: 'local' },
      runtime: { reachable: true, runtimeId: 'host-b', capabilities }
    })
    await expect(messageManager(run, 'Do not execute in a shell', call)).rejects.toThrow(
      'identity changed'
    )
    expect(call.mock.calls.some(([args]) => args[1] === 'send')).toBe(false)
    call.mockClear()
    const original = call.getMockImplementation()!
    call.mockImplementation((args) =>
      args[1] === 'wait' ? Promise.resolve({ wait: { satisfied: false } }) : original(args)
    )
    await expect(messageManager(run, 'Not a shell command', call)).rejects.toThrow()
    expect(call.mock.calls.some(([args]) => args[1] === 'send')).toBe(false)
  })

  it('refuses an old host before terminal creation instead of assuming absent capabilities', async () => {
    const { root, call } = await fixture()
    call.mockResolvedValueOnce({
      target: { kind: 'local' },
      runtime: { reachable: true, runtimeId: 'host-a' }
    })
    await expect(verifyLocalWorkspace(call, root)).rejects.toThrow('Update the execution host')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('does not claim prompt acceptance when the host returns a refusal or a missing receipt', async () => {
    const { run, call } = await fixture()
    const original = call.getMockImplementation()!
    call.mockImplementation((args) =>
      args[1] === 'send' ? Promise.resolve({ send: { accepted: false } }) : original(args)
    )
    await expect(launchManager(run, call)).rejects.toThrow('acceptance is unverifiable')
    expect(await readJson(join(run, 'launch.json'))).toMatchObject({ stage: 'unverifiable' })
  })
})
