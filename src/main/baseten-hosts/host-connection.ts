import {
  addEnvironmentFromPairingCode,
  listEnvironments,
  markEnvironmentUsed,
  resolveEnvironment,
  updateEnvironmentFromPairingCode
} from '../../shared/runtime-environment-store'
import {
  getPreferredPairingOffer,
  redactRuntimeEnvironment
} from '../../shared/runtime-environments'
import type { BasetenHostsApi } from '../../shared/baseten-hosts'
import { verifyRuntimeEnvironmentPairingCode } from '../ipc/runtime-environment-pairing-verification'
import { invalidateRuntimeEnvironmentTransport } from '../ipc/runtime-environments'
import { clearRuntimeEnvironmentManualDisconnect } from '../ipc/runtime-environment-manual-disconnect'
import { getRuntimeEnvironmentStatusOwner } from '../ipc/runtime-environment-request-connections'

const connections = new Map<string, ReturnType<BasetenHostsApi['connect']>>()
export type HostConnectionGuard = { environmentId?: string; isCurrent: () => boolean }

export function connectBasetenHost(
  userDataPath: string,
  name: string,
  access: () => ReturnType<BasetenHostsApi['access']>,
  guard?: HostConnectionGuard
): ReturnType<BasetenHostsApi['connect']> {
  const key = `${userDataPath}\0${name}`
  let task = connections.get(key)
  if (!task) {
    task = connect(userDataPath, name, access, guard).finally(() => connections.delete(key))
    connections.set(key, task)
  }
  return task
}

async function connect(
  userDataPath: string,
  name: string,
  access: () => ReturnType<BasetenHostsApi['access']>,
  guard?: HostConnectionGuard
): ReturnType<BasetenHostsApi['connect']> {
  const checkCurrent = () => {
    if (guard && !guard.isCurrent()) {
      throw new Error('Host connection was cancelled.')
    }
  }
  checkCurrent()
  const { link } = await access()
  checkCurrent()
  const verified = await verifyRuntimeEnvironmentPairingCode({
    pairingCode: link,
    allowLoopback: true
  })
  if (!verified.ok) {
    throw new Error(verified.message)
  }
  checkCurrent()
  const { pairing, runtimeStatus } = verified
  const environments = listEnvironments(userDataPath)
  const matches = environments.filter(
    (environment) =>
      environment.runtimeId === runtimeStatus.runtimeId ||
      getPreferredPairingOffer(environment).publicKeyB64 === pairing.publicKeyB64
  )
  if (matches.length > 1) {
    throw new Error('Multiple saved servers match this host. Review them in Connect to a host.')
  }
  const existing = matches[0] ?? environments.find((environment) => environment.name === name)
  if (guard?.environmentId && existing?.id !== guard.environmentId) {
    throw new Error(
      'The saved host changed during reconnect. Connect again to verify its identity.'
    )
  }
  // Runtime IDs change on restart; the authenticated host key is the persistent identity.
  if (existing && getPreferredPairingOffer(existing).publicKeyB64 !== pairing.publicKeyB64) {
    throw new Error(
      'This host does not match the saved server identity. Its connection was not replaced.'
    )
  }
  // Preserve the environment ID: workspaces and terminals refer to it, not the pod name.
  const environment = existing
    ? updateEnvironmentFromPairingCode(userDataPath, existing.id, { pairingCode: link })
    : addEnvironmentFromPairingCode(userDataPath, {
        name,
        pairingCode: link,
        ...(verified.usesSshTunnel ? { connectionDependency: 'ssh-tunnel' as const } : {})
      })
  markEnvironmentUsed(userDataPath, environment.id, {
    runtimeId: runtimeStatus.runtimeId,
    pairedDeviceId: runtimeStatus.pairedDeviceId
  })
  await invalidateRuntimeEnvironmentTransport(environment.id)
  checkCurrent()
  const current = resolveEnvironment(userDataPath, environment.id)
  if (current.pairingRevision !== environment.pairingRevision) {
    throw new Error('This server pairing changed during reconnect. Refresh and try again.')
  }
  clearRuntimeEnvironmentManualDisconnect(environment.id)
  getRuntimeEnvironmentStatusOwner(userDataPath, environment.id).acceptVerified({
    id: 'status.get',
    ok: true,
    result: runtimeStatus,
    _meta: { runtimeId: runtimeStatus.runtimeId }
  })
  return { environment: redactRuntimeEnvironment(current) }
}
