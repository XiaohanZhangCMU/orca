import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { folderWorkspaceRepoId } from '../../../../shared/folder-workspace-worktree'
import {
  getPodStarterWorkspacePath,
  isPodStarterWorkspaceGroup
} from './starter-workspace-presentation'

const group: ProjectGroup = {
  id: 'starter',
  name: 'Non-root workspaces',
  parentPath: '/home/orca/Codes',
  executionHostId: 'runtime:cpu',
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}
const workspace = {
  repoId: folderWorkspaceRepoId(group.id),
  hostId: 'runtime:cpu' as const,
  path: '/home/orca/Codes/workspace'
}

describe('pod starter workspace presentation', () => {
  it('recognizes only the default remote starter group', () => {
    expect(isPodStarterWorkspaceGroup(group)).toBe(true)
    expect(isPodStarterWorkspaceGroup({ ...group, executionHostId: 'local' })).toBe(false)
    expect(isPodStarterWorkspaceGroup({ ...group, name: 'Research' })).toBe(false)
    expect(isPodStarterWorkspaceGroup({ ...group, parentGroupId: 'parent' })).toBe(false)
    expect(isPodStarterWorkspaceGroup({ ...group, createdFrom: 'folder-scan' })).toBe(false)
  })

  it.each(['/home/orca/Codes/workspace', 'C:\\Users\\orca\\Codes', '/home/orca/Research notes'])(
    'uses the full host path without changing its separators: %s',
    (path) => {
      expect(getPodStarterWorkspacePath({ ...workspace, path }, [group])).toBe(path)
    }
  )

  it('does not match a same-ID group owned by another host', () => {
    expect(
      getPodStarterWorkspacePath(workspace, [{ ...group, executionHostId: 'runtime:other' }])
    ).toBeUndefined()
    expect(
      getPodStarterWorkspacePath(workspace, [{ ...group, executionHostId: 'runtime:other' }, group])
    ).toBe(workspace.path)
  })

  it('leaves custom groups and ordinary git worktrees unchanged', () => {
    expect(getPodStarterWorkspacePath(workspace, [{ ...group, name: 'Research' }])).toBeUndefined()
    expect(
      getPodStarterWorkspacePath({ ...workspace, repoId: 'git-repo' }, [group])
    ).toBeUndefined()
    expect(getPodStarterWorkspacePath(workspace, [])).toBeUndefined()
    expect(getPodStarterWorkspacePath({ ...workspace, path: '' }, [group])).toBeUndefined()
  })

  it('uses the canonical legacy SSH owner', () => {
    const sshGroup = { ...group, executionHostId: undefined, connectionId: 'cpu-ssh' }
    expect(getPodStarterWorkspacePath({ ...workspace, hostId: 'ssh:cpu-ssh' }, [sshGroup])).toBe(
      workspace.path
    )
  })
})
