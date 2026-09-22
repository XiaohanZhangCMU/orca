import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  readHostConfig: vi.fn(),
  startHost: vi.fn(),
  hostStatus: vi.fn(),
  initializeWorkspace: vi.fn(),
  call: vi.fn(),
  checkedProcess: vi.fn(),
  readPodPlan: vi.fn(),
  podEnvironment: vi.fn()
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  existsSync: mocks.existsSync,
  writeFileSync: mocks.writeFileSync
}))
vi.mock('../src/host-config', () => ({ readHostConfig: mocks.readHostConfig }))
vi.mock('../src/host-control', () => ({
  startHost: mocks.startHost,
  hostStatus: mocks.hostStatus,
  initializeWorkspace: mocks.initializeWorkspace
}))
vi.mock('../../../src/cli/runtime-client', () => ({
  RuntimeClient: class {
    call = mocks.call
  }
}))
vi.mock('../src/cluster-process', () => ({ checkedProcess: mocks.checkedProcess }))
vi.mock('../src/pod-environment', () => ({
  podHome: join(tmpdir(), 'orca-services-fixture'),
  podState: join(tmpdir(), 'orca-services-fixture', 'state'),
  readPodPlan: mocks.readPodPlan,
  podEnvironment: mocks.podEnvironment
}))

const home = join(tmpdir(), 'orca-services-fixture')
const config = { root: join(home, '.local/share/orca-pod-host'), profile: join(home, '.orca') }
const ready = { runtimeId: 'fixture-host', graph: 'ready', ready: true }
let previousExitCode: typeof process.exitCode

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  previousExitCode = process.exitCode
  vi.stubEnv('KUBECONFIG', 'previous-config')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.readPodPlan.mockReturnValue({
    kubeconfigName: 'fixture-config',
    repositories: [{ name: 'trainers' }, { name: 'orca' }]
  })
  mocks.podEnvironment.mockReturnValue({})
  mocks.readHostConfig.mockReturnValue(config)
  mocks.hostStatus.mockResolvedValue(ready)
  mocks.checkedProcess.mockResolvedValue('')
  mocks.existsSync.mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = previousExitCode
})

async function startServices() {
  await import('../src/pod-services')
  await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith(JSON.stringify(ready)))
}

it.each([false, true])(
  'starts without seeding or deleting projects, with old registration marker: %s',
  async (registered) => {
    mocks.existsSync.mockImplementation(
      (path) => registered && String(path).endsWith('registered.json')
    )
    await startServices()

    expect(mocks.startHost).toHaveBeenCalledExactlyOnceWith(config)
    expect(mocks.hostStatus).toHaveBeenCalledExactlyOnceWith(config)
    expect(mocks.initializeWorkspace).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
    expect(mocks.checkedProcess).not.toHaveBeenCalled()
    expect(mocks.existsSync).toHaveBeenCalledExactlyOnceWith(
      join(home, '.local/share/orca-tailnet-proxy/phone.json')
    )
    expect(process.env.KUBECONFIG).toBe(join(home, '.kube', 'fixture-config'))
  }
)

it('still resumes private phone access after starting the host', async () => {
  mocks.existsSync.mockReturnValue(true)
  await startServices()

  expect(mocks.checkedProcess).toHaveBeenCalledExactlyOnceWith(
    {
      program: process.execPath,
      args: [join(home, '.local/share/orca-tailnet-proxy/pod-phone.cjs'), 'start']
    },
    'Resume private phone access'
  )
  expect(mocks.startHost.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.checkedProcess.mock.invocationCallOrder[0]
  )
  expect(mocks.initializeWorkspace).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
})

it('keeps desktop readiness available if the phone proxy cannot resume', async () => {
  mocks.existsSync.mockReturnValue(true)
  mocks.checkedProcess.mockRejectedValue(new Error('proxy unavailable'))
  await startServices()

  expect(console.error).toHaveBeenCalledWith(
    'Private phone access could not resume; Orca remains available through its desktop tunnel.'
  )
  expect(process.exitCode).toBe(previousExitCode)
})

it('reports startup failure without touching the project catalog', async () => {
  mocks.startHost.mockRejectedValue(new Error('host unavailable'))
  await import('../src/pod-services')
  await vi.waitFor(() => expect(process.exitCode).toBe(1))

  expect(console.error).toHaveBeenCalledWith('Orca startup failed; inspect the private server log')
  expect(mocks.initializeWorkspace).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
  expect(mocks.checkedProcess).not.toHaveBeenCalled()
})
