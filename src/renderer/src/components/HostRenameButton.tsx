import { useState, type ComponentProps } from 'react'
import { Pencil } from 'lucide-react'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { getEffectiveHostSetting } from '../../../shared/host-setting-overrides'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from './ui/button'
import { HostRenameDialog } from './sidebar/HostRenameDialog'

type HostRenameButtonProps = Pick<
  ComponentProps<typeof Button>,
  'variant' | 'size' | 'disabled'
> & {
  hostId: ExecutionHostId | null
  derivedLabel: string
}

export function HostRenameButton({
  hostId,
  derivedLabel,
  variant = 'ghost',
  size = 'xs',
  disabled = false
}: HostRenameButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = useAppStore((state) =>
    hostId
      ? getEffectiveHostSetting(state.settings, hostId, 'displayLabel', derivedLabel)
      : derivedLabel
  )
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || !hostId}
        aria-label={translate('hosts.renameButtonLabel', 'Rename {{name}}', { name: label })}
        onClick={() => setOpen(true)}
      >
        <Pencil />
        {translate('hosts.renameButton', 'Rename')}
      </Button>
      {open && hostId && (
        <HostRenameDialog
          key={hostId}
          open={open}
          onOpenChange={setOpen}
          hostId={hostId}
          derivedLabel={derivedLabel}
        />
      )}
    </>
  )
}
