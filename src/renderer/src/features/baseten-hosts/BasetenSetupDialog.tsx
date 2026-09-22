import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  basetenSetupSchema,
  type BasetenSetup,
  type BasetenPreflight
} from '../../../../shared/baseten-hosts'

export function BasetenSetupDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [setup, setSetup] = useState<BasetenSetup | null>(null)
  const [checked, setChecked] = useState<BasetenPreflight | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.api.basetenHosts
      ?.defaults()
      .then((value) => {
        if (active) {
          setSetup(value)
        }
      })
      .catch(() => {
        if (active) {
          setError('Could not load setup defaults. Reopen this page after restarting Orca.')
        }
      })
    return () => {
      active = false
    }
  }, [])
  function update(patch: Partial<BasetenSetup>) {
    setSetup((value) => (value ? { ...value, ...patch } : null))
    setChecked(null)
    setConsent(false)
    setError(null)
  }
  async function check() {
    const parsed = basetenSetupSchema.safeParse(setup)
    if (!parsed.success) {
      setError(
        'Use a lowercase host name and namespace, valid local paths, at least 250 GiB, and a setup description.'
      )
      return
    }
    setBusy(true)
    setError(null)
    setChecked(null)
    setConsent(false)
    try {
      setChecked(await window.api.basetenHosts!.check(parsed.data))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Setup checks failed.')
    } finally {
      setBusy(false)
    }
  }
  async function create() {
    if (!checked?.ticket || !consent) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.api.basetenHosts!.create(checked.ticket, consent)
      onCreated()
      onClose()
    } catch (failure) {
      setChecked(null)
      setError(failure instanceof Error ? failure.message : 'Could not start setup.')
    } finally {
      setBusy(false)
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
      <DialogContent className="sm:max-w-xl">
        <div className="max-h-[75vh] space-y-4 overflow-y-auto scrollbar-sleek">
          <DialogHeader>
            <DialogTitle>Create a Baseten host</DialogTitle>
            <DialogDescription>
              A private CPU workstation, running as orca—not root. Repositories, tools, and your
              home directory stay on persistent storage.
            </DialogDescription>
          </DialogHeader>
          {setup ? (
            <fieldset disabled={busy} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="baseten-name">Host name</Label>
                <Input
                  id="baseten-name"
                  value={setup.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="baseten-namespace">Namespace</Label>
                  <Input
                    id="baseten-namespace"
                    value={setup.namespace}
                    onChange={(e) => update({ namespace: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="baseten-storage">Persistent storage (GiB)</Label>
                  <Input
                    id="baseten-storage"
                    type="number"
                    min={250}
                    max={4096}
                    value={setup.storageGi}
                    onChange={(e) => update({ storageGi: Number(e.target.value) })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                2 CPUs / 8 GiB requested · up to 16 CPUs / 96 GiB · no GPU. Storage remains
                allocated until explicitly removed.
              </p>
              <details className="space-y-3">
                <summary className="cursor-pointer text-sm">Advanced setup</summary>
                <div className="space-y-1">
                  <Label htmlFor="baseten-source">Trusted Orca source checkout</Label>
                  <Input
                    id="baseten-source"
                    value={setup.source}
                    onChange={(e) => update({ source: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="baseten-dreamteam">Dreamteam checkout</Label>
                  <Input
                    id="baseten-dreamteam"
                    value={setup.dreamteam}
                    onChange={(e) => update({ dreamteam: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="baseten-kubeconfig">Kubernetes config</Label>
                  <Input
                    id="baseten-kubeconfig"
                    value={setup.kubeconfig}
                    onChange={(e) => update({ kubeconfig: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="baseten-prompt">Setup request (saved in the run record)</Label>
                  <Textarea
                    id="baseten-prompt"
                    value={setup.prompt}
                    onChange={(e) => update({ prompt: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Only use a checkout you trust: its setup scripts run on this laptop. macOS or
                  Linux, installed Orca dependencies, Kubernetes access, and the Dreamteam
                  credential tools are required.
                </p>
              </details>
              <Button variant="outline" onClick={() => void check()} disabled={busy}>
                {busy ? 'Working…' : 'Check setup'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Checks use read-only credential requests and Kubernetes admission dry runs. Notion
                is optional. Credential values are never shown here.
              </p>
              {checked && (
                <section className="space-y-3" aria-label="Setup check results">
                  <dl className="space-y-1">
                    {checked.checks.map((check) => (
                      <div key={check.service} className="flex justify-between gap-4 text-sm">
                        <dt>
                          {check.service}
                          {check.optional ? ' (optional)' : ''}
                        </dt>
                        <dd>{check.status}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    Repositories: {checked.repositories.join(', ')}
                  </p>
                  {!checked.ticket ? (
                    <p role="alert" className="text-sm text-destructive">
                      Required checks did not pass. Fix the credentials and check again.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="baseten-consent"
                          checked={consent}
                          onCheckedChange={(value) => setConsent(value === true)}
                        />
                        <Label htmlFor="baseten-consent">
                          Create this workload and copy the installer’s allowlisted credentials into
                          its private persistent home.
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Includes GitHub, Linear, Hugging Face, W&amp;B, Rancher/Kubernetes, Baseten,
                        Tinker, storage credentials, and available agent credentials. It does not
                        copy your whole home or SSH private keys. Cluster and storage charges may
                        apply.
                      </p>
                      <Button disabled={!consent || busy} onClick={() => void create()}>
                        Create host
                      </Button>
                    </>
                  )}
                </section>
              )}
            </fieldset>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Loading setup…
            </p>
          )}
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
