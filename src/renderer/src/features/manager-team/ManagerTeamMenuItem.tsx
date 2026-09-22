import { Users } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { openManagerTeam } from './manager-team-navigation'

export function ManagerTeamMenuItem({ worktreeId }: { worktreeId: string }) {
  if (worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
    return null
  }
  return (
    <DropdownMenuItem onSelect={() => openManagerTeam(worktreeId)}>
      <Users /> Team workflow
    </DropdownMenuItem>
  )
}
