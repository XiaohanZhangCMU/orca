import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorktreeExecutionHostId } from '../../../../shared/execution-host'
import { projectGroupIdFromRepoId } from '../../../../shared/folder-workspace-worktree'
import { getProjectGroupHostId } from '@/store/slices/project-group-owner-routing'

export function isPodStarterWorkspaceGroup(group: ProjectGroup): boolean {
  // Only replace the installer's default label; custom group names remain user-owned.
  return (
    group.name === 'Non-root workspaces' &&
    group.createdFrom === 'manual' &&
    !group.parentGroupId &&
    getProjectGroupHostId(group) !== 'local'
  )
}

export function getPodStarterWorkspacePath(
  worktree: Pick<Worktree, 'repoId' | 'hostId' | 'path'>,
  groups: readonly ProjectGroup[]
): string | undefined {
  const groupId = projectGroupIdFromRepoId(worktree.repoId)
  if (!groupId || !worktree.path.trim()) {
    return undefined
  }
  const hostId = getWorktreeExecutionHostId(worktree, undefined)
  const group = groups.find(
    (entry) => entry.id === groupId && getProjectGroupHostId(entry) === hostId
  )
  return group && isPodStarterWorkspaceGroup(group) ? worktree.path : undefined
}
