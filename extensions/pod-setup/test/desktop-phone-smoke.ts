import { z } from 'zod'
import { decodePairingOffer } from '../../../src/shared/pairing'
import { sendRemoteRuntimeRequest } from '../../../src/shared/remote-runtime-client'
import { encodeMobilePairingQr } from '../../../src/main/runtime/mobile-pairing-qr'
import { savedPhone } from '../src/desktop-legacy-hosts'
import { phoneStatus } from '../src/desktop-phone'

async function main() {
  const name = process.argv[2]
  if (!name) {
    throw new Error('Pass an existing host name. This test never enables or restarts hosts.')
  }
  const phone = savedPhone(process.cwd(), name) ?? (await phoneStatus(name, process.cwd()))
  if (!phone.link) {
    throw new Error('This host has no ready phone link.')
  }
  const offer = decodePairingOffer(phone.link)
  const response = await sendRemoteRuntimeRequest(offer, 'status.get', undefined, 15_000)
  if (!response.ok) {
    throw new Error('The host refused mobile authentication.')
  }
  const status = z
    .object({
      runtimeId: z.string(),
      deviceScope: z.literal('mobile'),
      graphStatus: z.literal('ready')
    })
    .parse(response.result)
  const tabs = await sendRemoteRuntimeRequest(offer, 'session.tabs.listAll', undefined, 15_000)
  if (!tabs.ok) {
    throw new Error('The mobile session catalog is unavailable.')
  }
  const catalog = z
    .object({ snapshots: z.array(z.object({ tabs: z.array(z.object({ type: z.string() })) })) })
    .parse(tabs.result)
  const qr = await encodeMobilePairingQr(phone.link)
  if (!qr.ok) {
    throw new Error('QR encoding failed.')
  }
  console.log(
    JSON.stringify({
      name,
      runtimeId: status.runtimeId,
      scope: status.deviceScope,
      graph: status.graphStatus,
      workspaceCount: catalog.snapshots.length,
      terminalCount: catalog.snapshots
        .flatMap((item) => item.tabs)
        .filter((tab) => tab.type === 'terminal').length,
      qr: 'encoded',
      qrPixels: qr.qrSize,
      physicalPhone: 'not tested'
    })
  )
}
main().catch(() => {
  console.error(
    'Phone smoke check failed. Existing hosts and pairings were not changed; check private network reach and host status.'
  )
  process.exitCode = 1
})
