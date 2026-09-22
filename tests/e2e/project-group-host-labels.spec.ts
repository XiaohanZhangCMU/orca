import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({
  seedTestRepo: false,
  orcaAppExtraEnv: {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_POD_INVENTORY_FILE: join(tmpdir(), `orca-group-labels-${randomUUID()}.env`)
  }
})

test('pod starter groups show host headings and full folder paths in a narrow sidebar', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const names = ['orca-cpu-0921', 'xiaohan-orca-cpu', 'xiaohan-orca-e2e-0920']
  await orcaPage.evaluate(async (names) => {
    const store = window.__store!
    await store.getState().updateSettingsOrThrow({
      experimentalNewWorktreeCardStyle: true,
      compactWorktreeCards: false
    })
    store.setState({
      groupBy: 'repo',
      sidebarWidth: 280,
      worktreeCardProperties: ['status'],
      collapsedGroups: new Set(),
      runtimeEnvironments: names.map((name, index) => ({
        id: `pod-${index}`,
        name,
        runtimeId: `runtime-${index}`,
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: null,
        preferredEndpointId: 'fixture',
        endpoints: [
          { id: 'fixture', kind: 'websocket', label: 'Fixture', endpoint: 'ws://127.0.0.1:1' }
        ]
      })),
      projectGroups: names.map((_, index) => ({
        id: `group-${index}`,
        name: 'Non-root workspaces',
        parentPath: '/home/orca/Codes',
        executionHostId: `runtime:pod-${index}`,
        parentGroupId: null,
        createdFrom: 'manual',
        tabOrder: index,
        isCollapsed: false,
        color: null,
        createdAt: 1,
        updatedAt: 1
      })),
      folderWorkspaces: names.map((_, index) => ({
        id: `folder-${index}`,
        projectGroupId: `group-${index}`,
        name: 'Workspace',
        folderPath: '/home/orca/Codes/workspace',
        executionHostId: `runtime:pod-${index}`,
        linkedTask: null,
        comment: '',
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 0,
        lastActivityAt: 1,
        createdAt: 1,
        updatedAt: 1
      }))
    })
  }, names)

  for (const [index, name] of names.entries()) {
    const heading = orcaPage.locator(`[data-project-group-header-id="group-${index}"]`)
    await expect(heading.getByText('Non-root workspaces', { exact: true })).toHaveCount(0)
    await expect(heading.getByText(name, { exact: true })).toBeVisible()
    expect(await heading.evaluate((element) => element.getBoundingClientRect().height)).toBe(28)
    expect(
      await heading
        .getByText(name, { exact: true })
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true)
    const workspace = orcaPage.locator(`[data-worktree-id="folder:folder-${index}"]`)
    await expect(workspace.getByText('Workspace', { exact: true })).toBeVisible()
    await expect(
      workspace
        .locator('[data-worktree-card-meta-row]')
        .getByText('/home/orca/Codes/workspace', { exact: true })
    ).toBeVisible()
  }

  for (const theme of ['light', 'dark'] as const) {
    await orcaPage.evaluate(
      (theme) => window.__store!.getState().updateSettingsOrThrow({ theme }),
      theme
    )
    await expect(orcaPage.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /\blight\b/)
    await orcaPage.screenshot({ path: testInfo.outputPath(`project-group-hosts-${theme}.png`) })
    const header = await orcaPage.locator('[data-sidebar-section-title="projects"]').boundingBox()
    const sidebar = await orcaPage.locator('[data-worktree-sidebar-container]').boundingBox()
    const lastWorkspace = await orcaPage
      .locator('[data-worktree-id="folder:folder-2"]')
      .boundingBox()
    if (!header || !sidebar || !lastWorkspace) {
      throw new Error('Pod sidebar was not rendered')
    }
    await orcaPage.screenshot({
      path: testInfo.outputPath(`pod-sidebar-${theme}.png`),
      clip: {
        x: sidebar.x,
        y: header.y - 8,
        width: sidebar.width,
        height: lastWorkspace.y + lastWorkspace.height - header.y + 16
      }
    })
  }

  const first = orcaPage.locator('[data-project-group-header-id="group-0"]')
  await first.hover()
  await first.getByRole('button', { name: `Group actions for ${names[0]}` }).click()
  await orcaPage.getByRole('menuitem', { name: 'Rename group', exact: true }).click()
  const rename = orcaPage.getByRole('dialog')
  await expect(rename.getByRole('textbox')).toHaveValue('Non-root workspaces')
  await rename.getByRole('button', { name: 'Cancel', exact: true }).click()

  const longName = 'research-cpu-workstation-with-a-long-distinct-host-name'
  await orcaPage.evaluate((name) => {
    const store = window.__store!
    store.setState({
      runtimeEnvironments: store
        .getState()
        .runtimeEnvironments.map((environment) =>
          environment.id === 'pod-0' ? { ...environment, name } : environment
        )
    })
  }, longName)
  await expect(first.getByText(longName, { exact: true })).toBeVisible()
  await first.getByText(longName, { exact: true }).hover()
  await expect(orcaPage.getByRole('tooltip', { name: longName, exact: true })).toBeVisible()
  await orcaPage.getByRole('tooltip', { name: longName, exact: true }).press('Escape')

  for (const compactWorktreeCards of [true, false]) {
    await orcaPage.evaluate(
      (compactWorktreeCards) =>
        window.__store!.getState().updateSettingsOrThrow({
          experimentalNewWorktreeCardStyle: false,
          compactWorktreeCards
        }),
      compactWorktreeCards
    )
    for (const index of names.keys()) {
      const metadata = orcaPage.locator(
        `[data-worktree-id="folder:folder-${index}"] [data-worktree-card-meta-row]`
      )
      await expect(metadata.getByText('/home/orca/Codes/workspace', { exact: true })).toHaveCount(1)
      await expect(metadata).toBeVisible()
    }
  }
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
})
