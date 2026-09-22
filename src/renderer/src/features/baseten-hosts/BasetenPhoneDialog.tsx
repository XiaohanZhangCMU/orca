import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { BasetenPhone } from '../../../../shared/baseten-hosts'

export function BasetenPhoneDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [phone, setPhone] = useState<BasetenPhone | null>(null)
  const [ips, setIps] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const refresh = useCallback(async () => {
    if (inFlight.current || !mounted.current) {
      return
    }
    inFlight.current = true
    setRefreshing(true)
    setError(null)
    try {
      const result = await window.api.basetenHosts!.phone(name)
      if (mounted.current) {
        setPhone(result)
      }
    } catch (failure) {
      if (mounted.current) {
        setPhone(null)
        setError(failure instanceof Error ? failure.message : 'Phone access is unverifiable.')
      }
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setRefreshing(false)
      }
    }
  }, [name])
  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])
  useEffect(() => {
    if (phone?.state !== 'authorizing' && phone?.state !== 'unverifiable') {
      return
    }
    const timer = setTimeout(() => void refresh(), 5000)
    return () => clearTimeout(timer)
  }, [phone, refresh])
  async function enable() {
    setBusy(true)
    setError(null)
    try {
      await window.api.basetenHosts!.enablePhone(name, ips.split(/[\s,]+/).filter(Boolean))
      await refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not enable phone access.')
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    if (!phone?.link) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(phone.link)
      setCopied(true)
    } catch {
      setError('Could not copy the pairing link. Try scanning the QR code.')
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <div className="max-h-[75vh] space-y-4 overflow-y-auto scrollbar-sleek">
          <DialogHeader>
            <DialogTitle>Pair your phone with {name}</DialogTitle>
            <DialogDescription>
              Connect directly to this pod, including on 5G. Your laptop does not need to stay
              online.
            </DialogDescription>
          </DialogHeader>
          {!phone && refreshing && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading this host’s phone pairing code…
            </p>
          )}
          {phone?.qrDataUrl && (
            <div className="flex justify-center">
              <img
                src={phone.qrDataUrl}
                alt={`Private Orca Mobile pairing QR for ${name}`}
                className="w-80 max-w-full [image-rendering:pixelated]"
              />
            </div>
          )}
          {phone?.endpoint && (
            <p className="break-all text-center font-mono text-xs text-muted-foreground">
              {phone.endpoint}
            </p>
          )}
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Enable Tailscale on your phone and sign in to the same private network as this host.
            </li>
            <li>
              Authorize the pod below if needed. Your network policy must allow the phone to reach
              port 6770.
            </li>
            <li>
              In Orca Mobile, choose Pair Desktop, then scan this host’s QR or paste its pairing
              link.
            </li>
          </ol>
          {phone?.state === 'not-enabled' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="baseten-phone-ips">Allowed devices’ Tailscale IPv4 addresses</Label>
                <Input
                  id="baseten-phone-ips"
                  placeholder="100.x.x.x, 100.x.x.x"
                  value={ips}
                  onChange={(e) => setIps(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Enter your phone’s address from Tailscale. You may also add this laptop. Only
                  these devices can reach the pod’s Orca port; nothing is exposed publicly.
                </p>
              </div>
              <Button onClick={() => void enable()} disabled={busy || !ips.trim()}>
                {busy ? 'Enabling phone access…' : 'Enable private phone access'}
              </Button>
              <p className="text-xs text-muted-foreground">
                The first setup builds the private proxy using Go on this laptop. Authorization
                opens in your browser.
              </p>
            </div>
          )}
          {phone && (
            <p role="status" className="text-sm text-muted-foreground">
              {phone.message}
            </p>
          )}
          {phone?.authUrl && (
            <Button variant="outline" onClick={() => void window.api.shell.openUrl(phone.authUrl!)}>
              Authorize host in Tailscale
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            {phone?.link && (
              <Button onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy phone pairing link'}
              </Button>
            )}
            <Button variant="outline" disabled={busy || refreshing} onClick={() => void refresh()}>
              Refresh phone access
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Treat the QR and link as credentials. Repeat pairing for each host, then select that
            host in Orca Mobile. Workspaces and agents belong to the selected execution host.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
