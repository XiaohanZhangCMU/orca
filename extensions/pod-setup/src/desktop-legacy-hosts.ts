import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import { parsePairingCode } from '../../../src/shared/pairing'
import type { BasetenHost, BasetenPhone } from '../../../src/shared/baseten-hosts'
import { readInventoryFields } from './local-inventory'
import { tailnetIp } from './phone-contract'

function inventoryFile(source: string): string {
  return process.env.ORCA_POD_INVENTORY_FILE || join(source, '.env')
}

export function savedHosts(source: string): string[] {
  const file = inventoryFile(source)
  if (!existsSync(file)) {
    return []
  }
  return [
    ...readFileSync(file, 'utf8').matchAll(/^# BEGIN ORCA POD: ([a-z][a-z0-9-]{1,50}[a-z0-9])$/gm)
  ].map((match) => match[1])
}

export function savedAccess(source: string, name: string): string {
  if (!savedHosts(source).includes(name)) {
    throw new Error('No local host registration')
  }
  const fields = readInventoryFields(inventoryFile(source), name)
  const link = fields.LAPTOP_TAILSCALE_PAIRING_LINK || fields.LAPTOP_PAIRING_LINK
  const offer = link && parsePairingCode(link)
  if (
    !offer ||
    offer.scope === 'mobile' ||
    offer.relay ||
    !fields.DEPLOYMENT ||
    !fields.KUBECONFIG
  ) {
    throw new Error('No registered Kubernetes runtime access link')
  }
  return link
}

export async function legacyHost(source: string, name: string): Promise<BasetenHost> {
  const fields = readInventoryFields(inventoryFile(source), name)
  const row: BasetenHost = {
    name,
    namespace: fields.NAMESPACE || 'Unknown namespace',
    storage: fields.STORAGE || 'Storage not recorded',
    management: 'legacy',
    state: 'unverifiable',
    phase:
      'Legacy registration; connection is unverifiable. Its existing tunnel or Tailscale route must be available.'
  }
  try {
    const client = new RuntimeClient(source, 8000, savedAccess(source, name), null)
    const result = z
      .object({ runtimeId: z.string(), graphStatus: z.string() })
      .parse((await client.call('status.get')).result)
    row.runtimeId = result.runtimeId
    if (result.graphStatus === 'ready') {
      row.state = 'ready'
      row.phase = 'Legacy host ready'
    }
  } catch {
    /* Saved registration remains visible when its execution host cannot answer. */
  }
  return row
}

export function savedPhone(source: string, name: string): BasetenPhone | null {
  const fields = readInventoryFields(inventoryFile(source), name)
  const link = fields.PHONE_PAIRING_LINK
  const phone = link && parsePairingCode(link)
  if (!phone) {
    return null
  }
  const desktop = parsePairingCode(savedAccess(source, name))
  const endpoint = new URL(phone.endpoint)
  if (
    phone.scope !== 'mobile' ||
    phone.relay ||
    !desktop ||
    phone.publicKeyB64 !== desktop.publicKeyB64 ||
    endpoint.protocol !== 'ws:' ||
    endpoint.port !== '6770' ||
    !tailnetIp.safeParse(endpoint.hostname).success ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/'
  ) {
    throw new Error('Saved phone link does not match this host’s private mobile pairing identity.')
  }
  return {
    state: 'ready',
    endpoint: phone.endpoint,
    link,
    message:
      'Scan this saved host pairing code in Orca Mobile with Tailscale enabled. This does not verify that the phone can reach the host; revoked codes must be regenerated on the host.'
  }
}
