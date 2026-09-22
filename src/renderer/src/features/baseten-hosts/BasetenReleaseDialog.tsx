import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import type { BasetenHost } from '../../../../shared/baseten-hosts'

export function BasetenReleaseDialog({
  host,
  onClose,
  onReleased
}: {
  host: BasetenHost
  onClose: () => void
  onReleased: () => void
}) {
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function release() {
    if (busy || confirmation !== host.name || !host.instance) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.api.basetenHosts!.release(host.name, host.instance, confirmation)
      onReleased()
      onClose()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Release is unverifiable. Refresh before retrying.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release {host.name}?</DialogTitle>
          <DialogDescription>
            Stop this host’s pods in {host.namespace}. All running agents and terminal sessions on
            this host will stop. Unsaved in-memory work will be lost.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          The {host.storage} persistent disk, repositories, credentials, and saved files stay in the
          cluster. Storage charges may continue. The deployment is scaled to zero, not deleted.
        </p>
        <div className="space-y-2">
          <Label htmlFor="release-host-name">Type {host.name} to confirm</Label>
          <Input
            id="release-host-name"
            value={confirmation}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy || confirmation !== host.name}
            onClick={() => void release()}
          >
            {busy ? 'Releasing host…' : 'Release host'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
