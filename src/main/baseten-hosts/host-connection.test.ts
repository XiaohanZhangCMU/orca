import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'
import {
  addEnvironmentFromPairingCode,
  listEnvironments,
  markEnvironmentUsed,
  resolveEnvironment,
  updateEnvironmentFromPairingCode
} from '../../shared/runtime-environment-store'
import { RUNTIME_PROTOCOL_VERSION } from '../../shared/protocol-version'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { connectBasetenHost } from './host-connection'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  invalidate: vi.fn(),
  clearDisconnect: vi.fn(),
  acceptVerified: vi.fn(),
  owner: vi.fn()
}))
vi.mock('../../shared/remote-runtime-client', () => ({ sendRemoteRuntimeRequest: mocks.request }))
vi.mock('../ipc/runtime-environments', () => ({
  invalidateRuntimeEnvironmentTransport: mocks.invalidate
}))
vi.mock('../ipc/runtime-environment-manual-disconnect', () => ({
  clearRuntimeEnvironmentManualDisconnect: mocks.clearDisconnect
}))
vi.mock('../ipc/runtime-environment-request-connections', () => ({
  getRuntimeEnvironmentStatusOwner: mocks.owner
}))

const publicKeyB64 = Buffer.alloc(32, 1).toString('base64')
const otherKey = Buffer.alloc(32, 2).toString('base64')
const runtimeStatus: RuntimeStatus = {
  runtimeId: 'runtime-test',
  rendererGraphEpoch: 1,
  graphStatus: 'ready',
  authoritativeWindowId: null,
  liveTabCount: 2,
  liveLeafCount: 2,
  protocolVersion: RUNTIME_PROTOCOL_VERSION,
  deviceScope: 'runtime'
}
function link(port = 6770, key = publicKeyB64) {
  return encodePairingOffer({
    v: PAIRING_OFFER_VERSION,
    endpoint: `ws://127.0.0.1:${port}`,
    publicKeyB64: key,
    deviceToken: 'test-private-grant',
    scope: 'runtime'
  })
}
let userDataPath: string
const access = vi.fn()
function saved(
  name = 'orca-test',
  runtimeId: string | null = runtimeStatus.runtimeId,
  key = publicKeyB64
) {
  const environment = addEnvironmentFromPairingCode(userDataPath, {
    name,
    pairingCode: link(6770, key),
    connectionDependency: 'ssh-tunnel',
    now: 123
  })
  if (runtimeId) {
    markEnvironmentUsed(userDataPath, environment.id, { runtimeId, now: 456 })
  }
  return resolveEnvironment(userDataPath, environment.id)
}
beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'orca-baseten-connect-'))
  vi.resetAllMocks()
  mocks.invalidate.mockResolvedValue(undefined)
  mocks.owner.mockReturnValue({ acceptVerified: mocks.acceptVerified })
  mocks.request.mockResolvedValue({
    id: 'status.get',
    ok: true,
    result: runtimeStatus,
    _meta: { runtimeId: runtimeStatus.runtimeId }
  })
  access.mockResolvedValue({ link: link(51999) })
})
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

it('updates the saved tunnel without duplicating the host or changing its workspace identity', async () => {
  const existing = saved()
  const result = await connectBasetenHost(userDataPath, 'orca-test', access)
  expect(listEnvironments(userDataPath)).toHaveLength(1)
  expect(result.environment).toMatchObject({
    id: existing.id,
    createdAt: 123,
    runtimeId: runtimeStatus.runtimeId,
    connectionDependency: 'ssh-tunnel',
    endpoints: [{ endpoint: 'ws://127.0.0.1:51999' }]
  })
  expect(result.environment.pairingRevision).toBeGreaterThan(existing.pairingRevision!)
  expect(JSON.stringify(result)).not.toContain('test-private-grant')
  expect(JSON.stringify(result)).not.toContain(publicKeyB64)
  expect(mocks.invalidate).toHaveBeenCalledWith(existing.id)
  expect(mocks.clearDisconnect).toHaveBeenCalledWith(existing.id)
  expect(mocks.owner).toHaveBeenCalledWith(userDataPath, existing.id)
  expect(mocks.acceptVerified).toHaveBeenCalledWith(
    expect.objectContaining({ result: runtimeStatus })
  )
})

it('finds an already paired runtime even if its saved display name differs', async () => {
  const existing = saved('my-renamed-server')
  const result = await connectBasetenHost(userDataPath, 'orca-test', access)
  expect(result.environment).toMatchObject({ id: existing.id, name: 'my-renamed-server' })
  expect(listEnvironments(userDataPath)).toHaveLength(1)
})

it('recognizes a pairing saved before its runtime ID was recorded', async () => {
  const existing = saved('my-renamed-server', null)
  const result = await connectBasetenHost(userDataPath, 'orca-test', access)
  expect(result.environment).toMatchObject({ id: existing.id, runtimeId: runtimeStatus.runtimeId })
})

it('registers a new host once and coalesces simultaneous Connect clicks', async () => {
  const first = connectBasetenHost(userDataPath, 'orca-test', access)
  const second = connectBasetenHost(userDataPath, 'orca-test', access)
  expect(second).toBe(first)
  await first
  expect(listEnvironments(userDataPath)).toHaveLength(1)
  expect(access).toHaveBeenCalledTimes(1)
  expect(mocks.request).toHaveBeenCalledTimes(1)
  expect(mocks.clearDisconnect).toHaveBeenCalledTimes(1)
})

it.each([
  ['same name, different host', 'runtime-other', otherKey],
  ['same runtime ID, changed key', runtimeStatus.runtimeId, otherKey]
])('refuses %s without changing the saved environment', async (_label, runtimeId, key) => {
  const existing = saved('orca-test', runtimeId, key)
  await expect(connectBasetenHost(userDataPath, 'orca-test', access)).rejects.toThrow('identity')
  expect(resolveEnvironment(userDataPath, existing.id)).toEqual(existing)
  expect(mocks.invalidate).not.toHaveBeenCalled()
  expect(mocks.clearDisconnect).not.toHaveBeenCalled()
})

it('keeps the saved host after a server restart changes its runtime ID but not its key', async () => {
  const existing = saved('my-renamed-server', 'runtime-before-restart')
  const result = await connectBasetenHost(userDataPath, 'orca-test', access)
  expect(result.environment).toMatchObject({
    id: existing.id,
    name: existing.name,
    runtimeId: runtimeStatus.runtimeId,
    endpoints: [{ endpoint: 'ws://127.0.0.1:51999' }]
  })
  expect(listEnvironments(userDataPath)).toHaveLength(1)
  expect(mocks.invalidate).toHaveBeenCalledWith(existing.id)
})

it('does not guess between multiple saved environments with the same identity', async () => {
  saved('first-name')
  saved('second-name')
  const before = listEnvironments(userDataPath)
  await expect(connectBasetenHost(userDataPath, 'orca-test', access)).rejects.toThrow(
    'Multiple saved'
  )
  expect(listEnvironments(userDataPath)).toEqual(before)
  expect(mocks.invalidate).not.toHaveBeenCalled()
})

it('retains the previous endpoint when verification fails and permits retry', async () => {
  const existing = saved()
  mocks.request.mockRejectedValueOnce(new Error('Connection interrupted'))
  await expect(connectBasetenHost(userDataPath, 'orca-test', access)).rejects.toThrow(
    'Connection interrupted'
  )
  expect(resolveEnvironment(userDataPath, existing.id)).toEqual(existing)
  expect(mocks.acceptVerified).not.toHaveBeenCalled()
  await expect(connectBasetenHost(userDataPath, 'orca-test', access)).resolves.toMatchObject({
    environment: { id: existing.id }
  })
})

it('checks the current saved identity again after the network verification', async () => {
  const existing = saved()
  mocks.request.mockImplementationOnce(async () => {
    updateEnvironmentFromPairingCode(userDataPath, existing.id, {
      pairingCode: link(52000, otherKey)
    })
    return { ok: true, result: runtimeStatus }
  })
  await expect(connectBasetenHost(userDataPath, 'orca-test', access)).rejects.toThrow('identity')
  expect(resolveEnvironment(userDataPath, existing.id).endpoints[0].publicKeyB64).toBe(otherKey)
  expect(mocks.invalidate).not.toHaveBeenCalled()
})

it('does not publish stale connected evidence if pairing changes during transport retirement', async () => {
  const existing = saved()
  mocks.invalidate.mockImplementationOnce(async () => {
    updateEnvironmentFromPairingCode(userDataPath, existing.id, { pairingCode: link(52000) })
  })
  await expect(connectBasetenHost(userDataPath, 'orca-test', access)).rejects.toThrow(
    'pairing changed'
  )
  expect(mocks.clearDisconnect).not.toHaveBeenCalled()
  expect(mocks.acceptVerified).not.toHaveBeenCalled()
})
