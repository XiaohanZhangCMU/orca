import { useId, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  managerProviderSchema,
  managerTeamDefinitionSchema,
  type ManagerTeamDefinition,
  type ManagerWorker
} from '../../../../shared/manager-team-contract'
import { ManagerWorkerFields, MANAGER_PROVIDER_LABELS } from './ManagerWorkerFields'
import { ManagerOpenCodeModelStatus } from './ManagerOpenCodeModelStatus'
import { useManagerOpenCodeModels, type ManagerModelLoader } from './use-manager-opencode-models'

export type ManagerTeamDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  host: string
  busy: boolean
  available: boolean
  initialTeam?: ManagerTeamDefinition
  loadOpenCodeModels?: ManagerModelLoader
  attempted: boolean
  status: string
  error: string | null
  report: string | null
  onCreate: (team: ManagerTeamDefinition) => void
  onInspect: () => void
  onOpenReport: () => void
}

export function ManagerTeamDialog(props: ManagerTeamDialogProps) {
  const id = useId()
  const [objective, setObjective] = useState(props.initialTeam?.objective ?? '')
  const [manager, setManager] = useState<ManagerTeamDefinition['manager']>(
    props.initialTeam?.manager ?? 'codex'
  )
  const [workers, setWorkers] = useState<{ id: string; value: ManagerWorker }[]>(() =>
    (
      props.initialTeam?.workers ??
      [1, 2, 3].map((number): ManagerWorker => ({ name: `Worker ${number}`, provider: 'codex' }))
    ).map((value) => ({ id: crypto.randomUUID(), value }))
  )
  const [validation, setValidation] = useState<string | null>(null)
  const locked = props.busy || props.attempted
  const hasOpenCode = workers.some(({ value }) => value.provider === 'opencode')
  const { list, reload } = useManagerOpenCodeModels(
    props.open && props.available && hasOpenCode,
    props.loadOpenCodeModels
  )
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!props.busy) {
          props.onOpenChange(open)
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={!props.busy}>
        <DialogHeader>
          <DialogTitle>New manager team</DialogTitle>
          <DialogDescription>
            A manager delegates to your workers and publishes an HTML report in Orca.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            if (locked || !props.available) {
              return
            }
            const parsed = managerTeamDefinitionSchema.safeParse({
              objective,
              manager,
              workers: workers.map((worker) => worker.value)
            })
            if (!parsed.success) {
              setValidation(parsed.error.issues[0]?.message ?? 'Check the team settings.')
              return
            }
            setValidation(null)
            props.onCreate(parsed.data)
          }}
        >
          <div className="max-h-[60vh] space-y-4 overflow-y-auto scrollbar-sleek">
            <p className="text-xs text-muted-foreground">Execution host: {props.host}</p>
            <div className="space-y-2">
              <Label htmlFor={`${id}-objective`}>What should the team accomplish?</Label>
              <Textarea
                id={`${id}-objective`}
                value={objective}
                disabled={locked}
                required
                maxLength={20_000}
                placeholder="Describe the outcome, constraints, and how to verify it."
                onChange={(event) => setObjective(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-manager`}>Manager provider</Label>
              <Select
                value={manager}
                disabled={locked}
                onValueChange={(value) => setManager(managerProviderSchema.parse(value))}
              >
                <SelectTrigger id={`${id}-manager`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {managerProviderSchema.options.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {MANAGER_PROVIDER_LABELS[provider]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Each provider uses its existing login on this host. Suggested models come from Orca’s
              catalog; availability depends on your account. The manager uses its configured default
              model.
            </p>
            {hasOpenCode && props.loadOpenCodeModels && (
              <ManagerOpenCodeModelStatus list={list} disabled={locked} onReload={reload} />
            )}
            {workers.map((worker, index) => (
              <ManagerWorkerFields
                key={worker.id}
                worker={worker.value}
                openCodeModels={list.models}
                index={index}
                disabled={locked}
                removable={workers.length > 1}
                onChange={(value) =>
                  setWorkers((current) =>
                    current.map((item) => (item.id === worker.id ? { ...item, value } : item))
                  )
                }
                onRemove={() =>
                  setWorkers((current) => current.filter((item) => item.id !== worker.id))
                }
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked || workers.length >= 8}
              onClick={() => {
                const name =
                  Array.from({ length: 8 }, (_, i) => `Worker ${i + 1}`).find(
                    (candidate) => !workers.some((worker) => worker.value.name === candidate)
                  ) ?? 'New worker'
                setWorkers((current) => [
                  ...current,
                  { id: crypto.randomUUID(), value: { name, provider: 'codex' } }
                ])
              }}
            >
              <Plus /> Add worker
            </Button>
            <p className="text-xs text-muted-foreground">
              1–8 workers. Provider/model choices are manager instructions, not a hard policy or
              spending limit. Normal provider permissions still apply.
            </p>
            {(validation || props.error) && (
              <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">
                {validation || props.error}
              </p>
            )}
            {props.status && (
              <p role="status" className="text-sm text-muted-foreground">
                {props.status}
              </p>
            )}
            {props.report && (
              <p className="break-all text-xs text-muted-foreground">{props.report}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={props.busy}
              onClick={() => props.onOpenChange(false)}
            >
              {props.attempted ? 'Close' : 'Cancel'}
            </Button>
            {props.report && (
              <Button type="button" variant="outline" onClick={props.onOpenReport}>
                Open report
              </Button>
            )}
            {props.attempted ? (
              <Button type="button" disabled={props.busy} onClick={props.onInspect}>
                Check launch
              </Button>
            ) : (
              <Button type="submit" disabled={props.busy || !props.available || !objective.trim()}>
                Create team
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
