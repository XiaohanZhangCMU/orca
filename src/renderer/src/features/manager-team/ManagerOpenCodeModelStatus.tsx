import { Button } from '@/components/ui/button'
import type { ManagerModelList } from './use-manager-opencode-models'

export function ManagerOpenCodeModelStatus({
  list,
  disabled,
  onReload
}: {
  list: ManagerModelList
  disabled: boolean
  onReload: () => void
}) {
  return (
    <div className="space-y-2">
      {list.status === 'loading' && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading OpenCode models from the execution host…
        </p>
      )}
      {list.status === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          Could not load OpenCode models. {list.error}
        </p>
      )}
      {list.status === 'ready' && (
        <p role="status" className="text-xs text-muted-foreground">
          {list.models.length > 0
            ? `${list.models.length} Dreamteam-compatible models listed by OpenCode on this host.`
            : 'No Dreamteam-compatible models were listed. Configure a Baseten provider in OpenCode on this host, then reload.'}{' '}
          Listing does not verify credentials or endpoint health. Provider default and custom IDs
          remain available.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || list.status === 'loading'}
        onClick={onReload}
      >
        Reload OpenCode models
      </Button>
    </div>
  )
}
