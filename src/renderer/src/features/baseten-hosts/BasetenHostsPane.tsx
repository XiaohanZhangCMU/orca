import { useState } from 'react'
import { Plus, RefreshCw, Smartphone, Copy, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { HostRenameButton } from '@/components/HostRenameButton'
import { useAppStore } from '@/store'
import {
  getRuntimeServerConnectionLabel,
  getRuntimeServerConnectionState,
  type RuntimeHostDetails
} from '@/components/settings/runtime-environment-host-details'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { BasetenHost } from '../../../../shared/baseten-hosts'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import { getEffectiveHostSetting } from '../../../../shared/host-setting-overrides'
import { BasetenSetupDialog } from './BasetenSetupDialog'
import { BasetenPhoneDialog } from './BasetenPhoneDialog'
import { BasetenReleaseDialog } from './BasetenReleaseDialog'
import { useBasetenHostInventory } from './use-baseten-host-inventory'

export function BasetenHostsPane({
  compact = false,
  environments,
  details,
  onConnected,
  onRefreshConnections,
  onSetup
}: {
  compact?: boolean
  environments: PublicKnownRuntimeEnvironment[]
  details: Record<string, RuntimeHostDetails>
  onConnected: () => Promise<void>
  onRefreshConnections?: () => Promise<void>
  onSetup: () => void
}) {
  const settings = useAppStore((state) => state.settings)
  const {
    hosts,
    loading,
    refreshing,
    checkedAt,
    error: inventoryError,
    refresh
  } = useBasetenHostInventory(onRefreshConnections)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [phone, setPhone] = useState<string | null>(null)
  const [releasing, setReleasing] = useState<BasetenHost | null>(null)
  async function access(host: BasetenHost, copy: boolean) {
    if (busy) {
      return
    }
    setBusy(host.name)
    setError(null)
    setNotice('')
    try {
      if (copy) {
        const { link } = await window.api.basetenHosts!.access(host.name)
        await window.api.ui.writeClipboardText(link)
        setNotice(
          'Private desktop access link copied. Its tunnel runs while this Orca app is open. For phones, use Pair phone.'
        )
      } else {
        if (!window.api.basetenHosts?.connect) {
          throw new Error('Restart the local Orca app to load the updated host connection support.')
        }
        const { environment } = await window.api.basetenHosts.connect(host.name)
        await onConnected()
        const label = getEffectiveHostSetting(
          useAppStore.getState().settings,
          toRuntimeExecutionHostId(environment.id),
          'displayLabel',
          environment.name
        )
        setNotice(
          `Connected to ${label}. Choose it under “Run on” when creating a workspace. Phone pairing is separate.`
        )
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Could not connect. Refresh and try again.'
      )
    } finally {
      setBusy(null)
    }
  }
  if (!window.api.basetenHosts) {
    return compact ? null : (
      <p className="text-sm text-muted-foreground">
        Host setup is available in the desktop build of this Orca fork.
      </p>
    )
  }
  return (
    <section className="space-y-4" aria-label="Baseten hosts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Baseten hosts</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {compact
              ? 'Installer-managed pods and older pods registered on this laptop.'
              : 'Kubernetes CPU hosts registered on this laptop. Legacy hosts were set up before the installer.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw /> Refresh
          </Button>
          <Button
            variant={compact ? 'outline' : 'default'}
            size="sm"
            onClick={() => (compact ? onSetup() : setCreating(true))}
          >
            <Plus />
            {compact ? 'Setup Baseten host' : 'Create host'}
          </Button>
        </div>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {refreshing
          ? 'Refreshing host status…'
          : checkedAt
            ? `Checked at ${checkedAt.toLocaleTimeString()}. Auto-refreshes every 15 seconds and when you return.`
            : 'Auto-refresh is enabled.'}
      </p>
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking registered hosts…
        </p>
      )}
      {!loading && hosts.length === 0 && !error && !inventoryError && (
        <p className="text-sm text-muted-foreground">
          No registered Baseten pods yet. Create one with at least 250 GiB of persistent storage.
        </p>
      )}
      <div className="divide-y divide-border">
        {hosts.map((host) => {
          const environment = environments.find(
            (item) => host.environmentId && item.id === host.environmentId
          )
          const hostId = host.environmentId ? toRuntimeExecutionHostId(host.environmentId) : null
          const derivedLabel = environment?.name ?? host.name
          const label = hostId
            ? getEffectiveHostSetting(settings, hostId, 'displayLabel', derivedLabel)
            : derivedLabel
          const connectionState = environment
            ? getRuntimeServerConnectionState(details[environment.id])
            : null
          const isConnected = connectionState === 'connected'
          const connection = host.reconnecting
            ? 'Connecting'
            : connectionState
              ? getRuntimeServerConnectionLabel(connectionState)
              : host.runtimeId
                ? 'Not connected'
                : 'Connection not verified'
          return (
            <div key={host.name} data-baseten-host={host.name} className="space-y-2 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Server className="size-4" />
                <span className="break-all text-sm font-medium">{label}</span>
                <Badge variant="secondary">{connection}</Badge>
                {host.management === 'legacy' && <Badge variant="outline">Legacy</Badge>}
                <span className="text-xs text-muted-foreground">
                  {host.state === 'ready'
                    ? 'Pod ready'
                    : host.state === 'setting-up'
                      ? 'Setting up'
                      : host.state === 'failed'
                        ? 'Setup needs attention'
                        : host.state === 'released'
                          ? 'Released'
                          : host.state === 'releasing'
                            ? 'Releasing'
                            : 'Execution status unverifiable'}
                </span>
              </div>
              {label !== host.name && (
                <p className="break-all font-mono text-xs text-muted-foreground">{host.name}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {host.namespace} · {host.storage}
                {host.management === 'legacy' ? '' : ' persistent · non-root'}
              </p>
              {host.management === 'legacy' && (
                <p className="text-xs text-muted-foreground">
                  Uses its existing tunnel or Tailscale route. Release is unavailable without an
                  installer ownership receipt.
                </p>
              )}
              {host.state !== 'ready' && (
                <p role="status" className="text-xs text-muted-foreground">
                  {host.phase}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={isConnected ? 'secondary' : 'default'}
                  disabled={
                    isConnected || host.reconnecting || busy !== null || host.state !== 'ready'
                  }
                  onClick={() => void access(host, false)}
                >
                  {busy === host.name ? 'Connecting…' : 'Connect'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null || host.state !== 'ready'}
                  onClick={() => void access(host, true)}
                >
                  <Copy /> Access link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={host.state !== 'ready' && host.management !== 'legacy'}
                  onClick={() => setPhone(host.name)}
                >
                  <Smartphone /> Pair phone
                </Button>
                <HostRenameButton
                  hostId={hostId}
                  derivedLabel={derivedLabel}
                  variant="outline"
                  size="sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    busy !== null ||
                    !host.instance ||
                    host.management === 'legacy' ||
                    ['setting-up', 'released', 'releasing'].includes(host.state)
                  }
                  onClick={() => setReleasing(host)}
                >
                  Release host
                </Button>
              </div>
              {!hostId && (
                <p className="text-xs text-muted-foreground">Connect once to enable Rename.</p>
              )}
            </div>
          )
        })}
      </div>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {(error || inventoryError) && (
        <p role="alert" className="text-sm text-destructive">
          {error || inventoryError}
        </p>
      )}
      {creating && (
        <BasetenSetupDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setNotice(
              'Setup started. Keep Orca open until the bootstrap is transferred; the pod then continues independently.'
            )
            void refresh()
          }}
        />
      )}
      {phone && <BasetenPhoneDialog name={phone} onClose={() => setPhone(null)} />}
      {releasing && (
        <BasetenReleaseDialog
          host={releasing}
          onClose={() => setReleasing(null)}
          onReleased={() => {
            setNotice(
              'Release requested. Waiting for the cluster to confirm the pods have stopped. The persistent disk is retained.'
            )
            void refresh()
          }}
        />
      )}
    </section>
  )
}
