import { useAppStore } from '@/store'
import { resolveWorktreeOperationRouteResult } from '@/lib/worktree-operation-route'
import {
  callRuntimeRpc,
  hasRuntimeRpcErrorCode,
  type RuntimeClientTarget
} from '@/runtime/runtime-rpc-client'
import { captureRuntimeEnvironmentRequestRevision } from '@/runtime/runtime-environment-revision'
import { readManagerOpenCodeModels } from './manager-opencode-models'
import {
  managerTeamReceiptSchema,
  type ManagerTeamDefinition,
  type ManagerTeamRun
} from '../../../../shared/manager-team-contract'

export type ManagerTeamTarget = {
  target: RuntimeClientTarget
  label: string
  pairingRevision?: number
}

export function resolveManagerTeamTarget(worktreeId: string): ManagerTeamTarget {
  const state = useAppStore.getState()
  const result = resolveWorktreeOperationRouteResult(state, worktreeId)
  if (result.kind !== 'resolved' || !result.route.executionHostId) {
    throw new Error('The workspace host is not resolved yet. Wait for it to reconnect.')
  }
  const { executionHostId, runtimeEnvironmentId } = result.route
  if (executionHostId.startsWith('ssh:')) {
    throw new Error(
      'Teams need a paired Orca runtime on the remote host, not a direct SSH connection.'
    )
  }
  if (runtimeEnvironmentId) {
    const environment = state.runtimeEnvironments.find((item) => item.id === runtimeEnvironmentId)
    const pairingRevision = captureRuntimeEnvironmentRequestRevision(runtimeEnvironmentId)
    if (!environment || pairingRevision === undefined) {
      throw new Error('Reconnect the workspace host before creating a team.')
    }
    return {
      target: { kind: 'environment', environmentId: runtimeEnvironmentId },
      label: environment.name,
      pairingRevision
    }
  }
  if (executionHostId !== 'local') {
    throw new Error('This workspace has no reachable owning runtime.')
  }
  return { target: { kind: 'local' }, label: 'This computer' }
}

export async function callManagerTeam(
  host: ManagerTeamTarget,
  action: 'prepare' | 'launch' | 'inspect',
  run: ManagerTeamRun,
  team?: ManagerTeamDefinition
) {
  const result = await callRuntimeRpc<unknown>(
    host.target,
    `managerTeam.${action}`,
    {
      ...run,
      ...(team ? { team } : {})
    },
    { timeoutMs: 135_000, expectedEnvironmentPairingRevision: host.pairingRevision }
  )
  return managerTeamReceiptSchema.parse(result)
}

export async function discoverManagerOpenCodeModels(host: ManagerTeamTarget, worktreeId: string) {
  const reply = await callRuntimeRpc<unknown>(
    host.target,
    'managerTeam.models',
    { worktreeId },
    { timeoutMs: 75_000, expectedEnvironmentPairingRevision: host.pairingRevision }
  ).catch((error: unknown) => {
    if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
      throw new Error(
        'Update this host’s Orca server to load OpenCode models. Provider default and custom model IDs remain available.'
      )
    }
    throw error
  })
  return readManagerOpenCodeModels(reply)
}

export function managerTeamError(error: unknown): string {
  if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
    return 'This host does not have the team extension. Update its Orca server to this fork, then reopen this dialog. No local fallback was attempted.'
  }
  return error instanceof Error ? error.message : String(error)
}
