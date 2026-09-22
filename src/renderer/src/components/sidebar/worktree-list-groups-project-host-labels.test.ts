import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { getHostContextLabel } from '../../../../shared/worktree/host-context-labels'
import { buildRows } from './worktree-list/grouping/build-rows'

const group: ProjectGroup = {
  id: 'group-1',
  name: 'Non-root workspaces',
  parentPath: '/home/orca/Codes',
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

function headers(groups: ProjectGroup[], labels = new Map<string, string>()) {
  return buildRows(
    'repo',
    [],
    new Map(),
    null,
    new Set(),
    undefined,
    undefined,
    undefined,
    {},
    new Map(),
    false,
    undefined,
    groups,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    labels
  ).filter((row) => row.type === 'header')
}

describe('project group host labels', () => {
  it('distinguishes identical starter groups without changing their names or identities', () => {
    const names = ['orca-cpu-0921', 'xiaohan-orca-cpu', 'xiaohan-orca-e2e-0920']
    const groups = names.map((name, index) => ({
      ...group,
      id: `group-${index}`,
      executionHostId: `runtime:${name}`,
      tabOrder: index
    }))
    const before = structuredClone(groups)
    const rows = headers(groups, new Map(names.map((name) => [`runtime:${name}`, name])))

    expect(rows.map((row) => row.label)).toEqual(names)
    expect(rows.every((row) => !row.hostContextLabel)).toBe(true)
    expect(rows.map((row) => row.key)).toEqual(groups.map((item) => `project-group:${item.id}`))
    expect(groups).toEqual(before)
  })

  it('labels direct SSH groups using their saved host name', () => {
    expect(
      headers([{ ...group, connectionId: 'cpu-ssh' }], new Map([['ssh:cpu-ssh', 'CPU SSH']]))[0]
    ).toMatchObject({ label: 'CPU SSH' })
  })

  it('honors the explicit owner instead of a legacy SSH connection', () => {
    expect(
      headers(
        [{ ...group, connectionId: 'old-ssh', executionHostId: 'runtime:cpu' }],
        new Map([
          ['ssh:old-ssh', 'Old SSH'],
          ['runtime:cpu', 'CPU pod']
        ])
      )[0]
    ).toMatchObject({ label: 'CPU pod' })
  })

  it('keeps local and unstamped group headings compact', () => {
    for (const executionHostId of [undefined, 'local']) {
      expect(headers([{ ...group, executionHostId }])[0]).not.toHaveProperty('hostContextLabel')
    }
  })

  it('uses the canonical fallback before a remote host label is available', () => {
    expect(headers([{ ...group, executionHostId: 'runtime:cpu' }])[0]).toMatchObject({
      label: getHostContextLabel('runtime:cpu')
    })
  })

  it('reflects a renamed host without renaming the group', () => {
    const groups = [{ ...group, executionHostId: 'runtime:cpu' }]
    const labels = new Map([['runtime:cpu', 'Old pod name']])
    expect(headers(groups, labels)[0]?.label).toBe('Old pod name')
    labels.set('runtime:cpu', 'Research pod')
    expect(headers(groups, labels)[0]).toMatchObject({
      label: 'Research pod'
    })
    expect(groups[0].name).toBe(group.name)
  })

  it('preserves custom group names and shows their host as secondary context', () => {
    const groups = [{ ...group, name: 'Research projects', executionHostId: 'runtime:cpu' }]
    expect(headers(groups, new Map([['runtime:cpu', 'CPU pod']]))[0]).toMatchObject({
      label: 'Research projects',
      hostContextLabel: 'CPU pod'
    })
  })
})
