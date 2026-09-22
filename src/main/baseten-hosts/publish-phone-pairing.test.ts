import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { decodePairingOffer } from '../../shared/pairing'
import { publishPhonePairing } from './publish-phone-pairing'

it('persists a distinct mobile-scoped grant without changing desktop access', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'orca-phone-grant-'))
  const runtime = new OrcaRuntimeService()
  const server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath: profile,
    enableWebSocket: true,
    wsPort: 0,
    pinnedBindHost: '127.0.0.1'
  })
  try {
    await server.start()
    const desktop = server.createPairingOffer({
      address: '127.0.0.1',
      scope: 'runtime',
      name: 'desktop fixture'
    })
    publishPhonePairing(server, profile, runtime.getRuntimeId(), '127.0.0.1')
    const file = join(profile, 'baseten-phone.json')
    const saved = z
      .object({
        runtimeId: z.string(),
        offer: z.object({
          available: z.literal(true),
          deviceId: z.string(),
          pairingUrl: z.string()
        })
      })
      .parse(JSON.parse(readFileSync(file, 'utf8')))
    expect(saved.runtimeId).toBe(runtime.getRuntimeId())
    expect(decodePairingOffer(saved.offer.pairingUrl).scope).toBe('mobile')
    expect(server.getDeviceRegistry()?.getDevice(saved.offer.deviceId)?.scope).toBe('mobile')
    expect(desktop.available).toBe(true)
    if (desktop.available) {
      expect(server.getDeviceRegistry()?.getDevice(desktop.deviceId)?.scope).toBe('runtime')
      expect(desktop.deviceId).not.toBe(saved.offer.deviceId)
    }
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }
  } finally {
    await server.stop()
    rmSync(profile, { recursive: true, force: true })
  }
})
