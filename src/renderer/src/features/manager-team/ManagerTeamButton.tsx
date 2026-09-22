import { useCallback, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openFileInBrowserTab } from '@/lib/file-preview'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type {
  ManagerTeamDefinition,
  ManagerTeamReceipt
} from '../../../../shared/manager-team-contract'
import { ManagerTeamDialog } from './ManagerTeamDialog'
import {
  callManagerTeam,
  discoverManagerOpenCodeModels,
  managerTeamError,
  resolveManagerTeamTarget,
  type ManagerTeamTarget
} from './manager-team-client'
import {
  clearPendingTeam,
  readPendingTeam,
  savePendingTeam,
  type PendingManagerTeam
} from './manager-team-pending'

function dialogState(worktreeId: string) {
  try {
    const pending = readPendingTeam(worktreeId)
    return { pending, host: pending?.host ?? resolveManagerTeamTarget(worktreeId), error: null }
  } catch (failure) {
    return { pending: null, host: null, error: managerTeamError(failure) }
  }
}

export function ManagerTeamButton({
  worktreeId,
  autoOpen = false,
  onClose
}: {
  worktreeId: string
  autoOpen?: boolean
  onClose?: () => void
}) {
  const [initial] = useState(() =>
    autoOpen ? dialogState(worktreeId) : { pending: null, host: null, error: null }
  )
  const [open, setOpen] = useState(autoOpen)
  const [host, setHost] = useState<ManagerTeamTarget | null>(initial.host)
  const [pending, setPending] = useState<PendingManagerTeam | null>(initial.pending)
  const [receipt, setReceipt] = useState<ManagerTeamReceipt | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(
    initial.pending ? 'Saved launch found. Check its receipt before starting another team.' : ''
  )
  const [error, setError] = useState<string | null>(initial.error)
  const inFlight = useRef(false)
  const openDialog = useCallback(() => {
    setError(null)
    try {
      const saved = readPendingTeam(worktreeId)
      setPending(saved)
      setHost(saved?.host ?? resolveManagerTeamTarget(worktreeId))
      setStatus(
        saved
          ? `Saved team ${saved.run.requestId}. Check its launch; this does not start another manager.`
          : ''
      )
    } catch (failure) {
      setHost(null)
      setError(managerTeamError(failure))
    }
    setOpen(true)
  }, [worktreeId])
  const loadOpenCodeModels = useCallback(async () => {
    if (!host) {
      throw new Error('Reconnect the workspace host to list OpenCode models.')
    }
    return discoverManagerOpenCodeModels(host, worktreeId)
  }, [host, worktreeId])

  function openReport(result: ManagerTeamReceipt, owner: ManagerTeamTarget) {
    const current = resolveManagerTeamTarget(worktreeId)
    if (
      JSON.stringify(current.target) !== JSON.stringify(owner.target) ||
      current.pairingRevision !== owner.pairingRevision
    ) {
      throw new Error('Return to the original workspace host before opening this report.')
    }
    const preview = openFileInBrowserTab({ worktreeId, filePath: result.report })
    if (preview.status === 'unsupported') {
      throw new Error(
        'The report was saved, but this client cannot preview it. Open report.html from this workspace’s files.'
      )
    }
    if (result.stage === 'prompt-accepted') {
      clearPendingTeam(worktreeId)
      setPending(null)
      setReceipt(null)
      setOpen(false)
      onClose?.()
    }
  }

  async function create(team: ManagerTeamDefinition) {
    if (inFlight.current || pending || !host) {
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    const attempt = { host, team, run: { worktreeId, requestId: crypto.randomUUID() } }
    let launchRequested = false
    try {
      savePendingTeam(attempt)
      setPending(attempt)
      setStatus('Preparing the team on its execution host…')
      const prepared = await callManagerTeam(host, 'prepare', attempt.run, team)
      setReceipt(prepared)
      setStatus('Starting the manager and waiting for prompt acceptance…')
      launchRequested = true
      const launched = await callManagerTeam(host, 'launch', attempt.run)
      setReceipt(launched)
      setStatus(
        launched.stage === 'prompt-accepted'
          ? 'Manager prompt accepted. Follow the report for progress.'
          : `Launch receipt: ${launched.stage}.`
      )
      openReport(launched, host)
    } catch (failure) {
      setError(managerTeamError(failure))
      if (launchRequested) {
        setStatus(
          'No automatic retry. Check the saved launch before starting another team; loss of contact is unverifiable.'
        )
      } else {
        clearPendingTeam(worktreeId)
        setPending(null)
        setStatus('Preparation did not finish. No manager launch was requested.')
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function inspect() {
    if (!pending || inFlight.current) {
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await callManagerTeam(pending.host, 'inspect', pending.run)
      setReceipt(result)
      setStatus(
        result.stage === 'prompt-accepted'
          ? 'Manager prompt accepted. Follow the report for progress.'
          : `Launch receipt: ${result.stage}. Inspect the manager terminal and launch.json before taking further action.`
      )
      setError(result.error ?? null)
    } catch (failure) {
      setError(managerTeamError(failure))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
    return null
  }
  return (
    <div className="my-auto shrink-0 [-webkit-app-region:no-drag]">
      {!autoOpen && (
        <Button variant="ghost" size="sm" aria-label="New manager team" onClick={openDialog}>
          <Users /> Team
        </Button>
      )}
      {open && (
        <ManagerTeamDialog
          open={open}
          onOpenChange={(next) => {
            if (!next && receipt?.stage === 'prompt-accepted') {
              clearPendingTeam(worktreeId)
              setPending(null)
              setReceipt(null)
            }
            setOpen(next)
            if (!next) {
              onClose?.()
            }
          }}
          host={host?.label ?? 'Unavailable'}
          loadOpenCodeModels={loadOpenCodeModels}
          busy={busy}
          available={host !== null}
          initialTeam={pending?.team}
          attempted={pending !== null}
          status={status}
          error={error}
          report={receipt?.report ?? null}
          onCreate={(team) => {
            void create(team)
          }}
          onInspect={() => {
            void inspect()
          }}
          onOpenReport={() => {
            if (!receipt || !host) {
              return
            }
            try {
              openReport(receipt, host)
            } catch (failure) {
              setError(managerTeamError(failure))
            }
          }}
        />
      )}
    </div>
  )
}
