import { writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'

export function publishPhonePairing(
  rpc: OrcaRuntimeRpcServer,
  profile: string,
  runtimeId: string,
  address?: string
): void {
  const offer = rpc.createPairingOffer({ address, name: 'Baseten phone', scope: 'mobile' })
  const temporary = join(profile, `baseten-phone-${randomUUID()}.json`)
  writeFileSync(temporary, JSON.stringify({ runtimeId, offer }), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, join(profile, 'baseten-phone.json'))
}
