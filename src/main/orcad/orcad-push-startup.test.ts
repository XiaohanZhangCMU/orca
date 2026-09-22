import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DeviceRegistry } from '../runtime/device-registry'
import { RuntimeMobileNotificationController } from '../runtime/runtime-mobile-notification-controller'
import { PushUnregisterOutbox } from '../runtime/push/push-unregister-outbox'
import { createPushHostKeypair } from '../runtime/push/push-host-challenge-fixtures'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-types'

const state = vi.hoisted(() => ({
  root: '',
  controller: null as RuntimeMobileNotificationController | null,
  registry: null as DeviceRegistry | null,
  rpcStarted: false,
  registerPtys: vi.fn(async () => {}),
  syncWindowGraph: vi.fn(),
  startRpc: vi.fn(),
  pairing: vi.fn(() => ({
    available: true as const,
    pairingUrl: 'orca://pair?code=test',
    endpoint: 'ws://100.64.1.20:6770',
    deviceId: 'test-device',
    webClientUrl: null
  })),
  register: vi.fn(async () => ({ ok: true, registrationId: 'headless-registration' })),
  send: vi.fn(async () => ({ ok: true, results: [] }))
}))
vi.mock('./orcad-app-paths', () => ({
  resolveOrcadInstallRoot: () => state.root,
  resolveOrcadPath: () => state.root,
  resolveUserDataPath: () => state.root
}))
vi.mock('./orcad-browser-provider', () => ({ resolveOrcadBrowserProvider: async () => null }))
vi.mock('./orcad-instance-lock', () => ({ acquireOrcadInstanceLock: () => ({ release() {} }) }))
vi.mock('./orcad-daemon-supervision', () => ({
  startOrcadDaemon: async () => {},
  stopOrcadDaemon: async () => {}
}))
vi.mock('./orcad-health', () => ({ collectOrcadHealth: async () => ({}) }))
vi.mock('../daemon/daemon-init', () => ({ daemonOwnsFreshPersistentPtys: () => false }))
vi.mock('../ipc/pty', () => ({
  registerHeadlessPtyRuntime: state.registerPtys,
  getLocalPtyProvider: () => null,
  getSshPtyProvider: () => null
}))
vi.mock('../persistence/loading-store/store', () => ({
  Store: class {
    getSettings() {
      return {}
    }
  }
}))
vi.mock('../orca-profiles/profile-index-store', () => ({
  initOrcaProfilePaths() {},
  ensureActiveOrcaProfile: () => ({ dataFile: join(state.root, 'profile.json') })
}))
vi.mock('../ssh/ssh-host-key-store', () => ({ initSshHostKeyStoreFile() {} }))
vi.mock('../server/serve-readiness', () => ({
  ServeReadinessPublisher: class {
    async publish() {}
  }
}))
vi.mock('../runtime/orca-runtime', () => ({
  OrcaRuntimeService: class {
    syncWindowGraph = state.syncWindowGraph
    getRuntimeId() {
      return 'headless-runtime'
    }
    rehydrateClientHostedBrowserPages() {}
    async refreshRestoredOrchestrationAuthority() {}
    async reconcileLegacyWorkerTerminals() {}
    setMobilePushRegistrar(
      registrar: Parameters<RuntimeMobileNotificationController['setPushRegistrar']>[0]
    ) {
      state.controller!.setPushRegistrar(registrar)
    }
    onNotificationDispatched(
      listener: Parameters<RuntimeMobileNotificationController['onDispatched']>[0]
    ) {
      return state.controller!.onDispatched(listener)
    }
  }
}))
vi.mock('../runtime/runtime-rpc', () => ({
  OrcaRuntimeRpcServer: class {
    createPairingOffer = state.pairing
    async start() {
      state.startRpc()
      state.rpcStarted = true
    }
    async stop() {
      state.rpcStarted = false
    }
    getWebSocketEndpoint() {
      return null
    }
    getE2EEKeypair() {
      expect(state.rpcStarted).toBe(true)
      return createPushHostKeypair()
    }
    getDeviceRegistry() {
      return state.registry
    }
    getPushUnregisterOutbox() {
      return new PushUnregisterOutbox(state.root)
    }
    setOnPushUnregisterQueued() {}
  }
}))
vi.mock('../runtime/push/push-gateway-client', () => ({
  PushGatewayClient: class {
    registerDevice = state.register
    send = state.send
    async deleteDevice() {
      return { deleted: true, retryable: false }
    }
  }
}))

afterEach(() => {
  rmSync(state.root, { recursive: true, force: true })
  vi.clearAllMocks()
})

it.each([false, true])(
  'publishes the selected phone scope (%s) without changing runtime pairing',
  async (mobilePairing) => {
    state.root = mkdtempSync(join(tmpdir(), 'orca-headless-pairing-'))
    state.controller = new RuntimeMobileNotificationController()
    state.registry = new DeviceRegistry(state.root)
    const { startOrcad } = await import('./orcad-entry')
    const host = await startOrcad({
      mobilePairing,
      pairingAddress: 'ws://100.64.1.20:6770',
      json: true
    })
    try {
      expect(state.pairing).toHaveBeenCalledExactlyOnceWith({
        address: 'ws://100.64.1.20:6770',
        name: expect.stringMatching(mobilePairing ? /^Mobile / : /^CLI /),
        scope: mobilePairing ? 'mobile' : 'runtime'
      })
      expect(host.readiness.pairing).toMatchObject({
        available: true,
        scope: mobilePairing ? 'mobile' : 'runtime'
      })
    } finally {
      await host.stop()
    }
  }
)

it('initializes the headless graph before RPC and push, then stops dispatch on shutdown', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'orca-headless-push-'))
  state.controller = new RuntimeMobileNotificationController()
  state.registry = new DeviceRegistry(state.root)
  const phone = state.registry.addDevice('headless-phone', 'mobile')
  const { startOrcad } = await import('./orcad-entry')
  const host = await startOrcad({ noPairing: true, json: true })
  try {
    expect(state.syncWindowGraph).toHaveBeenCalledExactlyOnceWith(HEADLESS_RUNTIME_WINDOW_ID, {
      tabs: [],
      leaves: []
    })
    expect(state.syncWindowGraph.mock.invocationCallOrder[0]).toBeGreaterThan(
      state.registerPtys.mock.invocationCallOrder[0]
    )
    expect(state.startRpc.mock.invocationCallOrder[0]).toBeGreaterThan(
      state.syncWindowGraph.mock.invocationCallOrder[0]
    )
    const result = await state.controller.registerPushDevice({
      deviceId: phone.deviceId,
      platform: 'android',
      token: 'test-token',
      filter: {
        onlyWhenDesktopAway: true
      }
    })
    expect(result).toMatchObject({ registered: true })
    expect(state.registry.getDevice(phone.deviceId)?.pushRegistration?.expiresAt).toBeGreaterThan(
      Date.now()
    )
    state.controller.dispatch({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'QA',
      body: 'QA'
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.send).toHaveBeenCalledTimes(1)
  } finally {
    await host.stop()
  }
  expect(state.controller.getListenerCount()).toBe(0)
  expect(await state.controller.registerPushDevice({} as never)).toMatchObject({
    registered: false
  })
})
