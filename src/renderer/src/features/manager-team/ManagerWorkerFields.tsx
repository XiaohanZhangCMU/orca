import { useId, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import { workerProviderSchema, type ManagerWorker } from '../../../../shared/manager-team-contract'
import type { ManagerModelOption } from './manager-opencode-models'

export const MANAGER_PROVIDER_LABELS = {
  codex: 'Codex / OpenAI',
  claude: 'Claude Code / Anthropic',
  cursor: 'Cursor',
  opencode: 'OpenCode'
}

export function ManagerWorkerFields({
  worker,
  openCodeModels,
  index,
  disabled,
  removable,
  onChange,
  onRemove
}: {
  worker: ManagerWorker
  openCodeModels: ManagerModelOption[]
  index: number
  disabled: boolean
  removable: boolean
  onChange: (worker: ManagerWorker) => void
  onRemove: () => void
}) {
  const id = useId()
  const models =
    worker.provider === 'opencode'
      ? openCodeModels
      : (getAgentSessionOptionCatalog(worker.provider)?.models ?? [])
  const [customModel, setCustomModel] = useState(() =>
    Boolean(worker.model && !models.some((model) => model.id === worker.model))
  )
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Worker {index + 1}</legend>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-2">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={worker.name}
            maxLength={80}
            onChange={(event) => onChange({ ...worker, name: event.target.value })}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || !removable}
          aria-label={`Remove worker ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-provider`}>Provider</Label>
          <Select
            value={worker.provider}
            disabled={disabled}
            onValueChange={(value) => {
              setCustomModel(false)
              onChange({ name: worker.name, provider: workerProviderSchema.parse(value) })
            }}
          >
            <SelectTrigger id={`${id}-provider`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workerProviderSchema.options.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {MANAGER_PROVIDER_LABELS[provider]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-model`}>Model</Label>
          <Select
            value={customModel ? '__custom' : (worker.model ?? '__default')}
            disabled={disabled}
            onValueChange={(value) => {
              setCustomModel(value === '__custom')
              onChange({
                name: worker.name,
                provider: worker.provider,
                ...(value.startsWith('__') ? {} : { model: value })
              })
            }}
          >
            <SelectTrigger id={`${id}-model`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default">Provider default</SelectItem>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
              {!customModel &&
                worker.model &&
                !models.some((model) => model.id === worker.model) && (
                  <SelectItem value={worker.model}>{worker.model} (not in current list)</SelectItem>
                )}
              <SelectItem value="__custom">Custom model ID…</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {customModel && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-custom`}>Custom model ID</Label>
          <Input
            id={`${id}-custom`}
            value={worker.model ?? ''}
            placeholder={
              worker.provider === 'opencode'
                ? 'provider/model'
                : 'Model ID supported by this provider'
            }
            maxLength={200}
            required
            onChange={(event) => onChange({ ...worker, model: event.target.value })}
          />
        </div>
      )}
      {worker.provider === 'opencode' && (
        <p className="text-xs text-muted-foreground">
          Lists this host’s Baseten providers, matching Dreamteam. Other configured local or hosted
          models remain available through Provider default or a custom provider/model ID from{' '}
          <code>opencode models</code>.
        </p>
      )}
    </fieldset>
  )
}
