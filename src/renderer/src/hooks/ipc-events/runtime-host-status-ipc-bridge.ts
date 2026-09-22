import type { RuntimeHostStatusSnapshot } from '../../../../shared/runtime-host-status'
import { useAppStore } from '@/store'

export function registerRuntimeHostStatusIpcBridge(unsubs: (() => void)[]): void {
  const api = window.api.runtimeEnvironments
  if (!api?.onStatusChanged) {
    return
  }
  let stopped = false
  const refreshing = new Map<string, number>()
  const apply = (snapshot: RuntimeHostStatusSnapshot): void => {
    if (stopped) {
      return
    }
    const state = useAppStore.getState()
    state.applyRuntimeHostStatusSnapshot(snapshot)
    const environment = state.runtimeEnvironments.find(
      (entry) => entry.id === snapshot.environmentId
    )
    if (
      (!environment && state.runtimeEnvironmentCatalogSettled) ||
      (environment &&
        snapshot.pairingRevision <= (environment.pairingRevision ?? environment.createdAt)) ||
      (refreshing.get(snapshot.environmentId) ?? -Infinity) >= snapshot.pairingRevision
    ) {
      return
    }
    refreshing.set(snapshot.environmentId, snapshot.pairingRevision)
    // Reconnect can publish a new revision after the renderer has loaded the old catalog.
    void state
      .hydrateRuntimeEnvironmentStatuses({ refreshCatalog: true })
      .then(() => {
        if (!stopped) {
          useAppStore.getState().applyRuntimeHostStatusSnapshot(snapshot)
        }
      })
      .catch((error) => console.error('Failed to refresh runtime pairing catalog:', error))
      .finally(() => {
        if (refreshing.get(snapshot.environmentId) === snapshot.pairingRevision) {
          refreshing.delete(snapshot.environmentId)
        }
      })
  }
  unsubs.push(api.onStatusChanged(apply), () => {
    stopped = true
    refreshing.clear()
  })
  void api
    .getStatusSnapshots()
    .then((snapshots) => {
      if (!stopped) {
        snapshots.forEach(apply)
      }
    })
    .catch((error) => console.error('Failed to read runtime status snapshots:', error))
}
