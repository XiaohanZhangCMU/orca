import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { RuntimeHostStatusSnapshot } from '../../../../shared/runtime-host-status'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { createCompatibleRuntimeStatusResponse } from '@/runtime/runtime-compatibility-test-fixture'
import { registerRuntimeHostStatusIpcBridge } from './runtime-host-status-ipc-bridge'

const mocks = vi.hoisted(() => ({ getState: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), dismiss: vi.fn() } }))
vi.mock('@/runtime/restored-client-hosted-browser-host-attach', () => ({
  ensureBrowserClientHostsForRestoredPages: vi.fn(),
  ensureBrowserClientHostForRestartedRuntime: vi.fn()
}))
vi.mock('@/runtime/client-hosted-browser-close-intent-replay', () => ({
  replayClientHostedBrowserCloseIntents: vi.fn()
}))

function environment(revision = 1): PublicKnownRuntimeEnvironment {
  return {
    id: 'cpu',
    name: 'CPU pod',
    createdAt: 1,
    updatedAt: revision,
    pairingRevision: revision,
    runtimeId: 'cpu-runtime',
    lastUsedAt: null,
    preferredEndpointId: 'tunnel',
    endpoints: [
      { id: 'tunnel', kind: 'websocket', label: 'Tunnel', endpoint: 'ws://127.0.0.1:51999' }
    ]
  }
}
function snapshot(revision = 2, sequence = 1): RuntimeHostStatusSnapshot {
  const response = createCompatibleRuntimeStatusResponse('cpu-runtime')
  if (!response.ok) {
    throw new Error('Expected a successful fixture')
  }
  return {
    environmentId: 'cpu',
    pairingRevision: revision,
    sequence,
    checkedAt: sequence,
    verification: 'verified',
    transport: 'ready',
    status: response.result
  }
}

let store: ReturnType<typeof createTestStore>
let unsubs: (() => void)[]
let listener: ((value: RuntimeHostStatusSnapshot) => void) | undefined
let saved: PublicKnownRuntimeEnvironment[]
let latest: RuntimeHostStatusSnapshot[]
const list = vi.fn<() => Promise<PublicKnownRuntimeEnvironment[]>>()
const read = vi.fn<() => Promise<RuntimeHostStatusSnapshot[]>>()
const unsubscribe = vi.fn()
const settle = async () => {
  for (let i = 0; i < 80; i += 1) {
    await Promise.resolve()
  }
}
function publish(value = snapshot()) {
  latest = [value]
  if (!listener) {
    throw new Error('Status bridge is not registered')
  }
  listener(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  unsubs = []
  listener = undefined
  saved = [environment(2)]
  latest = []
  list.mockReset().mockImplementation(async () => saved)
  read.mockReset().mockImplementation(async () => latest)
  vi.stubGlobal('window', {
    api: {
      runtimeEnvironments: {
        list,
        getStatusSnapshots: read,
        getStatus: vi.fn(async () => createCompatibleRuntimeStatusResponse('cpu-runtime')),
        onStatusChanged: (callback: typeof listener) => {
          listener = callback
          return unsubscribe
        }
      }
    },
    dispatchEvent: vi.fn()
  })
  store = createTestStore()
  mocks.getState.mockImplementation(store.getState)
  store.getState().setRuntimeEnvironments([environment()])
})
afterEach(() => {
  unsubs.forEach((stop) => stop())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('runtime status pairing synchronization', () => {
  it('refreshes a background reconnect and coalesces repeated status publications', async () => {
    const held = Promise.withResolvers<PublicKnownRuntimeEnvironment[]>()
    list.mockReturnValueOnce(held.promise)
    registerRuntimeHostStatusIpcBridge(unsubs)
    publish()
    publish(snapshot(2, 2))
    publish(snapshot(2, 3))
    expect(list).toHaveBeenCalledTimes(1)
    expect(getRuntimeEnvironmentRevision('cpu')).toBe(1)
    held.resolve(saved)
    await settle()
    expect(getRuntimeEnvironmentRevision('cpu')).toBe(2)
    expect(store.getState().runtimeStatusByEnvironmentId.get('cpu')?.snapshot).toMatchObject({
      pairingRevision: 2,
      sequence: 3,
      verification: 'verified'
    })
    expect(store.getState().runtimeEnvironments).toEqual(saved)
    expect(store.getState().settings?.activeRuntimeEnvironmentId).toBeFalsy()
  })

  it('recovers when reconnect completed before the status listener attached', async () => {
    latest = [snapshot()]
    registerRuntimeHostStatusIpcBridge(unsubs)
    await settle()
    expect(list).toHaveBeenCalledTimes(1)
    expect(getRuntimeEnvironmentRevision('cpu')).toBe(2)
    expect(store.getState().runtimeStatusByEnvironmentId.get('cpu')?.status?.runtimeId).toBe(
      'cpu-runtime'
    )
  })

  it('re-lists when a reconnect races an already in-flight startup catalog read', async () => {
    const held = Promise.withResolvers<PublicKnownRuntimeEnvironment[]>()
    list.mockReturnValueOnce(held.promise)
    const hydration = store.getState().hydrateRuntimeEnvironmentStatuses()
    registerRuntimeHostStatusIpcBridge(unsubs)
    publish()
    expect(list).toHaveBeenCalledTimes(1)
    held.resolve([environment(1)])
    await hydration
    await settle()
    expect(list).toHaveBeenCalledTimes(2)
    expect(getRuntimeEnvironmentRevision('cpu')).toBe(2)
    expect(
      store.getState().runtimeStatusByEnvironmentId.get('cpu')?.snapshot?.pairingRevision
    ).toBe(2)
  })

  it('queues another revision arriving during catalog refresh without publishing the old status', async () => {
    const held = Promise.withResolvers<PublicKnownRuntimeEnvironment[]>()
    list.mockReturnValueOnce(held.promise)
    registerRuntimeHostStatusIpcBridge(unsubs)
    publish()
    saved = [environment(3)]
    publish(snapshot(3, 4))
    held.resolve([environment(2)])
    await settle()
    expect(list).toHaveBeenCalledTimes(2)
    expect(getRuntimeEnvironmentRevision('cpu')).toBe(3)
    expect(store.getState().runtimeStatusByEnvironmentId.get('cpu')?.snapshot).toMatchObject({
      pairingRevision: 3,
      sequence: 4
    })
  })

  it('recovers when the notification precedes the very first catalog response', async () => {
    store = createTestStore()
    mocks.getState.mockImplementation(store.getState)
    const held = Promise.withResolvers<PublicKnownRuntimeEnvironment[]>()
    list.mockReturnValueOnce(held.promise)
    const hydration = store.getState().hydrateRuntimeEnvironmentStatuses()
    registerRuntimeHostStatusIpcBridge(unsubs)
    publish()
    held.resolve([environment(1)])
    await hydration
    await settle()
    expect(list).toHaveBeenCalledTimes(2)
    expect(getRuntimeEnvironmentRevision('cpu')).toBe(2)
    expect(store.getState().runtimeStatusByEnvironmentId.get('cpu')?.snapshot).toMatchObject({
      pairingRevision: 2,
      verification: 'verified'
    })
  })

  it('does not refresh for current or older revisions', async () => {
    store.getState().setRuntimeEnvironments([environment(2)])
    registerRuntimeHostStatusIpcBridge(unsubs)
    publish(snapshot(2, 4))
    publish(snapshot(1, 100))
    await settle()
    expect(list).not.toHaveBeenCalled()
    expect(store.getState().runtimeStatusByEnvironmentId.get('cpu')?.snapshot?.sequence).toBe(4)
  })

  it('does not resurrect a host removed while the old catalog request is pending', async () => {
    const held = Promise.withResolvers<PublicKnownRuntimeEnvironment[]>()
    list.mockReturnValueOnce(held.promise)
    registerRuntimeHostStatusIpcBridge(unsubs)
    publish()
    saved = []
    store.getState().setRuntimeEnvironments([])
    held.resolve([environment(2)])
    await settle()
    publish(snapshot(3))
    await settle()
    expect(store.getState().runtimeEnvironments).toEqual([])
    expect(store.getState().runtimeStatusByEnvironmentId.has('cpu')).toBe(false)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('does not overwrite a newer explicit disconnect with the reconnect snapshot', async () => {
    const held = Promise.withResolvers<PublicKnownRuntimeEnvironment[]>()
    list.mockReturnValueOnce(held.promise)
    registerRuntimeHostStatusIpcBridge(unsubs)
    publish()
    publish({
      ...snapshot(2, 2),
      retired: true,
      verification: 'blocked',
      transport: 'disconnected'
    })
    held.resolve(saved)
    await settle()
    expect(store.getState().runtimeStatusByEnvironmentId.get('cpu')?.snapshot).toMatchObject({
      sequence: 2,
      retired: true,
      transport: 'disconnected'
    })
    expect(store.getState().runtimeStatusByEnvironmentId.get('cpu')?.status).toBeNull()
  })

  it('can retry a failed catalog read on a later publication without bypassing the revision fence', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    list.mockRejectedValueOnce(new Error('Catalog unavailable'))
    registerRuntimeHostStatusIpcBridge(unsubs)
    publish()
    await settle()
    expect(getRuntimeEnvironmentRevision('cpu')).toBe(1)
    expect(store.getState().runtimeStatusByEnvironmentId.has('cpu')).toBe(false)
    publish(snapshot(2, 2))
    await settle()
    expect(getRuntimeEnvironmentRevision('cpu')).toBe(2)
  })

  it('ignores a late startup snapshot after the bridge is disposed', async () => {
    const held = Promise.withResolvers<RuntimeHostStatusSnapshot[]>()
    read.mockReturnValueOnce(held.promise)
    registerRuntimeHostStatusIpcBridge(unsubs)
    unsubs.splice(0).forEach((stop) => stop())
    held.resolve([snapshot()])
    publish()
    await settle()
    expect(list).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
