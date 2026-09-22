import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'
import {
  addEnvironmentFromPairingCode,
  listEnvironments,
  markEnvironmentUsed,
  removeEnvironment,
  resolveEnvironment
} from '../../shared/runtime-environment-store'
import type { BasetenHost, BasetenHostRegistration } from '../../shared/baseten-hosts'
import { RUNTIME_PROTOCOL_VERSION } from '../../shared/protocol-version'
import {
  clearRuntimeEnvironmentManualDisconnect,
  isRuntimeEnvironmentManuallyDisconnected,
  markRuntimeEnvironmentManuallyDisconnected,
  prepareRuntimeEnvironmentConnection
} from '../ipc/runtime-environment-manual-disconnect'
import { BasetenHostReconnection } from './host-reconnection'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  invalidate: vi.fn(),
  accept: vi.fn(),
  close: vi.fn()
}))
vi.mock('../../shared/remote-runtime-client', () => ({ sendRemoteRuntimeRequest: mocks.request }))
vi.mock('../ipc/runtime-environments', () => ({
  invalidateRuntimeEnvironmentTransport: mocks.invalidate
}))
vi.mock('../ipc/runtime-environment-request-connections', () => ({
  getRuntimeEnvironmentStatusOwner: () => ({ acceptVerified: mocks.accept })
}))
vi.mock('./host-tunnels', () => ({ closeHostTunnel: mocks.close }))

const key = Buffer.alloc(32, 1).toString('base64')
const otherKey = Buffer.alloc(32, 2).toString('base64')
function link(port = 6770, publicKeyB64 = key) {
  return encodePairingOffer({
    v: PAIRING_OFFER_VERSION,
    scope: 'runtime',
    endpoint: `ws://127.0.0.1:${port}`,
    publicKeyB64,
    deviceToken: 'private-test-token'
  })
}
const registration: BasetenHostRegistration = {
  name: 'cpu-test',
  management: 'installer',
  instance: 'pod-instance',
  publicKeyB64: key
}
const host: BasetenHost = {
  ...registration,
  namespace: 'test',
  storage: '250Gi',
  state: 'ready',
  phase: 'Ready',
  runtimeId: 'new-process-id'
}
const response = {
  id: 'status.get',
  ok: true,
  result: {
    runtimeId: 'new-process-id',
    rendererGraphEpoch: 1,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 2,
    liveLeafCount: 2,
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    deviceScope: 'runtime'
  }
}
let directory: string
const managers: BasetenHostReconnection[] = []
const environmentIds: string[] = []
const service = {
  registrations: vi.fn<() => Promise<BasetenHostRegistration[]>>(),
  access: vi.fn()
}
function saved(name = 'Renamed host', publicKeyB64 = key, used = true) {
  const environment = addEnvironmentFromPairingCode(directory, {
    name,
    pairingCode: link(51000, publicKeyB64),
    connectionDependency: 'ssh-tunnel'
  })
  if (used) {
    markEnvironmentUsed(directory, environment.id, { runtimeId: 'old-process-id' })
  }
  environmentIds.push(environment.id)
  return resolveEnvironment(directory, environment.id)
}
function manager() {
  const controller = new BasetenHostReconnection(directory, service)
  managers.push(controller)
  return controller
}
beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'orca-host-restore-'))
  service.registrations.mockResolvedValue([registration])
  service.access.mockResolvedValue({ link: link(52000) })
  mocks.request.mockResolvedValue(response)
  mocks.invalidate.mockResolvedValue(undefined)
})
afterEach(() => {
  for (const controller of managers.splice(0)) {
    controller.dispose()
  }
  for (const id of environmentIds.splice(0)) {
    clearRuntimeEnvironmentManualDisconnect(id)
  }
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

it('restores a saved host on each app launch while preserving workspace identity', async () => {
  const environment = saved()
  const first = manager()
  await first.start()
  expect(resolveEnvironment(directory, environment.id)).toMatchObject({
    id: environment.id,
    name: 'Renamed host',
    endpoints: [{ endpoint: 'ws://127.0.0.1:52000' }]
  })
  first.dispose()
  service.access.mockResolvedValue({ link: link(53000) })
  const second = manager()
  await second.start()
  expect(service.access).toHaveBeenCalledTimes(2)
  expect(listEnvironments(directory)).toHaveLength(1)
  expect(second.decorate([{ ...host, runtimeId: 'yet-another-process' }])[0]).toMatchObject({
    environmentId: environment.id,
    reconnecting: false
  })
  expect(resolveEnvironment(directory, environment.id).endpoints[0].endpoint).toBe(
    'ws://127.0.0.1:53000'
  )
  expect(readFileSync(join(directory, 'baseten-host-connections.json'), 'utf8')).not.toContain(
    'private-test-token'
  )
})

it('matches the stable key before reconnect, not names or runtime IDs', async () => {
  const environment = saved()
  const controller = manager()
  await controller.refreshRegistrations()
  expect(controller.decorate([host])[0].environmentId).toBe(environment.id)
  expect(service.access).not.toHaveBeenCalled()
})

it('authenticates a same-name migration candidate when the installer has no saved link', async () => {
  const environment = saved(registration.name)
  service.registrations.mockResolvedValue([{ ...registration, publicKeyB64: undefined }])
  const controller = manager()
  await controller.refreshRegistrations()
  expect(controller.decorate([host])[0].environmentId).toBeUndefined()
  await controller.start()
  expect(controller.decorate([host])[0].environmentId).toBe(environment.id)
  expect(service.access).toHaveBeenCalledTimes(1)
})

it('does not auto-connect unpaired hosts, unverified entries, or legacy tunnels', async () => {
  saved('Unused entry', key, false)
  saved('Legacy entry', otherKey)
  service.registrations.mockResolvedValue([
    registration,
    { name: 'legacy', management: 'legacy', publicKeyB64: otherKey },
    { name: 'new-host', management: 'installer', instance: 'new-instance' }
  ])
  await manager().start()
  expect(service.access).not.toHaveBeenCalled()
})

it('persists explicit Disconnect across app launches and reconnects only on request', async () => {
  const environment = saved()
  const first = manager()
  await first.start()
  markRuntimeEnvironmentManuallyDisconnected(environment.id)
  first.dispose()
  clearRuntimeEnvironmentManualDisconnect(environment.id)
  service.access.mockClear()
  const second = manager()
  expect(isRuntimeEnvironmentManuallyDisconnected(environment.id)).toBe(true)
  await second.start()
  expect(service.access).not.toHaveBeenCalled()
  await second.connect(registration.name)
  expect(isRuntimeEnvironmentManuallyDisconnected(environment.id)).toBe(false)
  expect(service.access).toHaveBeenCalledTimes(1)
})

it('prepares a fresh tunnel when Connect is used on the ordinary server list', async () => {
  const environment = saved()
  const controller = manager()
  await controller.start()
  markRuntimeEnvironmentManuallyDisconnected(environment.id)
  clearRuntimeEnvironmentManualDisconnect(environment.id)
  await prepareRuntimeEnvironmentConnection(environment.id)
  expect(service.access).toHaveBeenCalledTimes(2)
})

it.each(['disconnect', 'remove', 'quit'] as const)(
  'does not undo %s while startup verification is in flight',
  async (action) => {
    const environment = saved()
    let finish: () => void = () => {
      throw new Error('Verification has not started')
    }
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(response)
        })
    )
    const controller = manager()
    const started = controller.start()
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    if (action === 'disconnect') {
      markRuntimeEnvironmentManuallyDisconnected(environment.id)
    }
    if (action === 'remove') {
      removeEnvironment(directory, environment.id)
      clearRuntimeEnvironmentManualDisconnect(environment.id)
    }
    if (action === 'quit') {
      controller.dispose()
    }
    finish()
    await started
    expect(mocks.accept).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledWith(registration.name)
    if (action === 'remove') {
      expect(listEnvironments(directory)).toHaveLength(0)
    } else {
      expect(resolveEnvironment(directory, environment.id).endpoints[0].endpoint).toBe(
        'ws://127.0.0.1:51000'
      )
    }
  }
)

it('does not resurrect a disconnected host after transport retirement', async () => {
  const environment = saved()
  mocks.invalidate.mockImplementationOnce(async () =>
    markRuntimeEnvironmentManuallyDisconnected(environment.id)
  )
  await manager().start()
  expect(mocks.accept).not.toHaveBeenCalled()
  expect(isRuntimeEnvironmentManuallyDisconnected(environment.id)).toBe(true)
})

it('retries transient failures without duplicating saved hosts', async () => {
  vi.useFakeTimers()
  saved()
  service.access.mockRejectedValueOnce(new Error('Unavailable'))
  const controller = manager()
  await controller.start()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(service.access).toHaveBeenCalledTimes(2)
  expect(mocks.accept).toHaveBeenCalledTimes(1)
  expect(listEnvironments(directory)).toHaveLength(1)
})

it('cancels scheduled retries when explicitly disconnected', async () => {
  vi.useFakeTimers()
  const environment = saved()
  service.access.mockRejectedValue(new Error('Unavailable'))
  const controller = manager()
  await controller.start()
  markRuntimeEnvironmentManuallyDisconnected(environment.id)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(service.access).toHaveBeenCalledTimes(1)
})

it('refuses an unexpected host key without replacing the saved pairing', async () => {
  const environment = saved()
  service.access.mockResolvedValue({ link: link(52000, otherKey) })
  await manager().start()
  expect(resolveEnvironment(directory, environment.id)).toEqual(environment)
  expect(mocks.accept).not.toHaveBeenCalled()
})

it('does not retarget a remembered host to a replacement pod installation', async () => {
  saved()
  const controller = manager()
  await controller.start()
  controller.dispose()
  service.access.mockClear()
  service.registrations.mockResolvedValue([{ ...registration, instance: 'replacement' }])
  const second = manager()
  await second.start()
  await second.refreshRegistrations()
  expect(second.decorate([host])[0].environmentId).toBeUndefined()
  expect(service.access).not.toHaveBeenCalled()
})

it('fails closed on malformed preferences instead of overwriting disconnect choices', () => {
  const file = join(directory, 'baseten-host-connections.json')
  writeFileSync(file, '{incomplete', { mode: 0o600 })
  expect(() => manager()).toThrow()
  expect(readFileSync(file, 'utf8')).toBe('{incomplete')
})
