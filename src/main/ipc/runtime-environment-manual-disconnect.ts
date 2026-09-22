const manuallyDisconnectedEnvironmentIds = new Set<string>()
const intentListeners = new Set<(environmentId: string, disconnected: boolean) => void>()
const connectionPreparers = new Set<(environmentId: string) => Promise<void>>()

export function onRuntimeEnvironmentConnectionPreparation(
  prepare: (environmentId: string) => Promise<void>
): () => void {
  connectionPreparers.add(prepare)
  return () => {
    connectionPreparers.delete(prepare)
  }
}

export async function prepareRuntimeEnvironmentConnection(environmentId: string): Promise<void> {
  for (const prepare of connectionPreparers) {
    await prepare(environmentId)
  }
}

export function onRuntimeEnvironmentConnectionIntent(
  listener: (environmentId: string, disconnected: boolean) => void
): () => void {
  intentListeners.add(listener)
  return () => {
    intentListeners.delete(listener)
  }
}

export const RUNTIME_MANUALLY_DISCONNECTED_MESSAGE = 'Runtime environment is manually disconnected.'

export function markRuntimeEnvironmentManuallyDisconnected(environmentId: string): void {
  manuallyDisconnectedEnvironmentIds.add(environmentId)
  for (const listener of intentListeners) {
    listener(environmentId, true)
  }
}

export function clearRuntimeEnvironmentManualDisconnect(environmentId: string): void {
  manuallyDisconnectedEnvironmentIds.delete(environmentId)
  for (const listener of intentListeners) {
    listener(environmentId, false)
  }
}

export function isRuntimeEnvironmentManuallyDisconnected(environmentId: string): boolean {
  return manuallyDisconnectedEnvironmentIds.has(environmentId)
}
