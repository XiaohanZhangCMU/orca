import { ManagerTeamButton } from './ManagerTeamButton'
import { useManagerTeamNavigation } from './manager-team-navigation'

export function ManagerTeamHost() {
  const { worktreeId, close } = useManagerTeamNavigation()
  return worktreeId ? (
    <ManagerTeamButton key={worktreeId} worktreeId={worktreeId} autoOpen onClose={close} />
  ) : null
}
