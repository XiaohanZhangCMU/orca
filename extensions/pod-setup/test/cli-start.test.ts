import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { HostConfig } from '../src/host-config'
import { shellQuote } from '../src/runtime-files'

const mocks = vi.hoisted(() => ({
  installHost: vi.fn(),
  runProcess: vi.fn(),
  readHostConfig: vi.fn(),
  assertHostUser: vi.fn(),
  startHost: vi.fn(),
  hostStatus: vi.fn(),
  printPairing: vi.fn(),
  initializeWorkspace: vi.fn()
}))
vi.mock('../src/install-host', () => ({ installHost: mocks.installHost }))
vi.mock('../../../src/shared/child-process/run-process', () => ({ runProcess: mocks.runProcess }))
vi.mock('../src/host-config', () => ({ readHostConfig: mocks.readHostConfig }))
vi.mock('../src/host-control', () => ({
  assertHostUser: mocks.assertHostUser,
  startHost: mocks.startHost,
  hostStatus: mocks.hostStatus,
  printPairing: mocks.printPairing,
  initializeWorkspace: mocks.initializeWorkspace
}))

const home = join(tmpdir(), 'orca-cli-fixture')
const config: HostConfig = {
  version: 1,
  user: 'orca',
  uid: process.getuid?.() ?? 1001,
  gid: process.getgid?.() ?? 1001,
  home,
  root: join(home, '.local/share/orca-pod-host'),
  profile: join(home, '.orca'),
  workspace: join(home, 'Codes/workspace'),
  port: 6770,
  source: join(home, 'Codes/orca'),
  hashes: {},
  installedAt: 'fixture'
}
let previousArgv: string[]
let previousExitCode: typeof process.exitCode

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  previousArgv = process.argv
  previousExitCode = process.exitCode
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.installHost.mockResolvedValue(config)
  mocks.readHostConfig.mockReturnValue(config)
  mocks.runProcess.mockResolvedValue({
    code: 0,
    timedOut: false,
    outputTruncated: false,
    stdout: 'host-ready',
    stderr: ''
  })
})

afterEach(() => {
  process.argv = previousArgv
  process.exitCode = previousExitCode
  vi.restoreAllMocks()
})

async function runCli(args: string[]) {
  process.argv = [process.execPath, join(home, 'pod-setup.cjs'), ...args]
  await import('../src/cli')
}

function installArgs(...flags: string[]) {
  return [
    'install',
    '--source',
    config.source,
    '--claude',
    join(home, 'claude'),
    '--opencode',
    join(home, 'opencode'),
    ...flags
  ]
}

it.skipIf(!process.getuid)(
  'install --start starts only the host as the existing account',
  async () => {
    await runCli(installArgs('--start'))
    await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith('host-ready'))

    expect(mocks.runProcess).toHaveBeenCalledExactlyOnceWith({
      program: join(config.root, 'bin', 'orca-host'),
      args: ['start'],
      timeoutMs: 110_000,
      maxOutputBytes: 16_000
    })
    expect(mocks.initializeWorkspace).not.toHaveBeenCalled()
  }
)

it('install --start switches account without invoking init-workspace', async () => {
  mocks.installHost.mockResolvedValue({ ...config, uid: config.uid + 1 })
  await runCli(installArgs('--start'))
  await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith('host-ready'))

  expect(mocks.runProcess).toHaveBeenCalledExactlyOnceWith({
    program: 'runuser',
    args: [
      '--login',
      'orca',
      '--command',
      `${shellQuote(join(config.root, 'bin', 'orca-host'))} start`
    ],
    timeoutMs: 110_000,
    maxOutputBytes: 16_000
  })
  expect(mocks.initializeWorkspace).not.toHaveBeenCalled()
})

it('install without --start does not start a process or register workspaces', async () => {
  await runCli(installArgs())
  await vi.waitFor(() => expect(console.log).toHaveBeenCalled())

  expect(mocks.runProcess).not.toHaveBeenCalled()
  expect(mocks.initializeWorkspace).not.toHaveBeenCalled()
})

it('plain start leaves project registration to the user', async () => {
  await runCli(['start'])
  await vi.waitFor(() => expect(mocks.startHost).toHaveBeenCalledExactlyOnceWith(config))

  expect(mocks.initializeWorkspace).not.toHaveBeenCalled()
  expect(mocks.runProcess).not.toHaveBeenCalled()
})

it('keeps the explicit init-workspace command available for existing scripts', async () => {
  await runCli(['init-workspace'])
  await vi.waitFor(() => expect(mocks.initializeWorkspace).toHaveBeenCalledExactlyOnceWith(config))

  expect(mocks.assertHostUser).toHaveBeenCalledWith(config)
  expect(mocks.startHost).not.toHaveBeenCalled()
  expect(mocks.runProcess).not.toHaveBeenCalled()
})
