import { beforeEach, expect, it, vi } from 'vitest'
import type { ProcessSpec } from '../../shared/child-process/run-process'
import type { BasetenSetup } from '../../shared/baseten-hosts'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))
vi.mock('../../shared/child-process/run-process', () => ({
  runProcess: mocks.run,
  spawnProcess: vi.fn()
}))
const setup: BasetenSetup = {
  name: 'orca-test',
  namespace: 'test-cluster',
  source: process.cwd(),
  dreamteam: '/dreamteam',
  kubeconfig: '/kubeconfig',
  storageGi: 250,
  prompt: 'Create the requested test workstation'
}
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.run.mockImplementation(async (spec: ProcessSpec) => {
    const request = spec.input ? JSON.parse(spec.input) : null
    const result =
      request?.command === 'check'
        ? {
            checks: [{ service: 'github', status: 'verified', optional: false }],
            repositories: ['orca'],
            blocked: false
          }
        : { ok: true }
    return {
      code: 0,
      signal: null,
      stdout: request ? JSON.stringify({ ok: true, result }) : '',
      stderr: '',
      timedOut: false
    }
  })
})

it('refuses missing/forged consent tickets without running anything', async () => {
  const { basetenHostService } = await import('./host-service')
  await expect(basetenHostService.create('forged', true)).rejects.toThrow('Check this setup again')
  expect(mocks.run).not.toHaveBeenCalled()
})

it('binds a one-use consent ticket to the checked setup', async () => {
  const { basetenHostService } = await import('./host-service')
  const result = await basetenHostService.check(setup)
  if (!result.ticket) {
    throw new Error('Missing fixture ticket')
  }
  await expect(basetenHostService.create(result.ticket, false)).rejects.toThrow(
    'confirm credential transfer'
  )
  await basetenHostService.create(result.ticket, true)
  await expect(basetenHostService.create(result.ticket, true)).rejects.toThrow(
    'Check this setup again'
  )
  await vi.waitFor(() =>
    expect(
      mocks.run.mock.calls.some(
        ([spec]) => spec.input && JSON.parse(spec.input).command === 'create'
      )
    ).toBe(true)
  )
  const request = mocks.run.mock.calls
    .map(([spec]) => (spec.input ? JSON.parse(spec.input) : null))
    .find((value) => value?.command === 'create')
  expect(request.setup).toEqual(setup)
})

it('does not expose worker stderr or tokens when an operation fails', async () => {
  const { basetenHostService } = await import('./host-service')
  mocks.run.mockResolvedValue({
    code: 1,
    signal: null,
    stdout: '',
    stderr: 'private-token-do-not-render',
    timedOut: false
  })
  await expect(basetenHostService.check(setup)).rejects.toThrow(
    'Could not build the pod setup tools'
  )
})
