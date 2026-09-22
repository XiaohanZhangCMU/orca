import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'

async function installHostFixtures(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const environments = ['k8s-cpu-orca', 'orca-cpu-0921'].map((name, index) => ({
      id: `fixture-host-${index}`,
      name,
      runtimeId: `fixture-runtime-${index}`,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: null,
      preferredEndpointId: 'endpoint',
      endpoints: [
        { id: 'endpoint', kind: 'websocket', label: 'Fixture', endpoint: 'ws://127.0.0.1:1' }
      ]
    }))
    ipcMain.removeHandler('runtimeEnvironments:list')
    ipcMain.handle('runtimeEnvironments:list', () => environments)
    ipcMain.removeHandler('runtimeEnvironments:getStatus')
    ipcMain.handle('runtimeEnvironments:getStatus', () => {
      throw new Error('Disconnected fixture: no network requests')
    })
    ipcMain.removeHandler('basetenHosts:request')
    ipcMain.handle('basetenHosts:request', (_event, request) => {
      if (request.operation !== 'list') {
        throw new Error('Renaming must not modify infrastructure or pairing')
      }
      return environments.map((environment, index) => ({
        name: environment.name,
        environmentId: environment.id,
        runtimeId: environment.runtimeId,
        namespace: 'fixture-cluster',
        storage: '250Gi',
        state: 'ready',
        phase: 'Ready',
        management: index === 0 ? 'legacy' : 'installer',
        ...(index === 1 ? { instance: 'fixture-instance' } : {})
      }))
    })
  })
}

async function openHostSettings(page: Page) {
  await waitForSessionReady(page)
  await page.evaluate(() => {
    const store = window.__store!.getState()
    store.openSettingsTarget({ pane: 'servers', repoId: null })
    store.openSettingsPage()
  })
  await page
    .getByRole('group', { name: 'Remote server workflow' })
    .getByRole('button', { name: /^Connect to a host/ })
    .click()
}

async function chooseWorkflow(page: Page, name: RegExp) {
  await page
    .getByRole('group', { name: 'Remote server workflow' })
    .getByRole('button', { name })
    .click()
}

// oxlint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
test('host card aliases stay consistent and persist across app restart', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const session = createRestartSession(testInfo, {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_POD_INVENTORY_FILE: join(tmpdir(), `orca-rename-fixture-${randomUUID()}.env`)
  })
  let app: ElectronApplication | undefined
  try {
    const first = await session.launch()
    app = first.app
    await installHostFixtures(app)
    await openHostSettings(first.page)
    const legacyServer = first.page.locator('[data-settings-section="fixture-host-0"]')
    await legacyServer.getByRole('button', { name: 'Rename k8s-cpu-orca' }).click()
    const dialog = first.page.getByRole('dialog', { name: 'Rename host', exact: true })
    await expect(dialog.getByLabel('Display name')).toBeFocused()
    await dialog.getByLabel('Display name').fill('italy')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(legacyServer.getByText('italy', { exact: true })).toBeVisible()
    await expect(legacyServer.getByText('k8s-cpu-orca', { exact: true })).toBeVisible()

    await chooseWorkflow(first.page, /^Setup Baseten host/)
    const pane = first.page.getByRole('region', { name: 'Baseten hosts' })
    const china = pane.locator('[data-baseten-host="orca-cpu-0921"]')
    await china.getByRole('button', { name: 'Rename orca-cpu-0921' }).click()
    await dialog.getByLabel('Display name').fill('china')
    await dialog.getByLabel('Display name').press('Enter')
    await expect(china.getByText('china', { exact: true })).toBeVisible()
    await expect(china.getByText('orca-cpu-0921', { exact: true })).toBeVisible()
    await expect(pane.getByRole('button', { name: 'Rename italy' })).toBeVisible()

    for (const theme of ['light', 'dark'] as const) {
      await first.page.evaluate(
        (theme) => window.__store!.getState().updateSettingsOrThrow({ theme }),
        theme
      )
      await expect(first.page.locator('html')).toHaveClass(
        theme === 'dark' ? /\bdark\b/ : /\blight\b/
      )
      await pane.screenshot({ path: testInfo.outputPath(`host-aliases-${theme}.png`) })
    }
    await china.getByRole('button', { name: 'Rename china' }).click()
    await expect(dialog.getByLabel('Display name')).toHaveValue('china')
    await dialog.screenshot({ path: testInfo.outputPath('rename-host-dialog.png') })
    await dialog.getByLabel('Display name').press('Escape')

    await chooseWorkflow(first.page, /^Connect to a host/)
    const cpuServer = first.page.locator('[data-settings-section="fixture-host-1"]')
    await expect(cpuServer.getByText('china', { exact: true })).toBeVisible()
    await expect(legacyServer.getByText('italy', { exact: true })).toBeVisible()
    await first.page
      .locator('[data-settings-section="default-runtime"]')
      .getByRole('button', { name: 'Advanced', exact: true })
      .click()
    await first.page.getByRole('combobox', { name: 'Active Server', exact: true }).click()
    await expect(first.page.getByRole('option', { name: 'italy', exact: true })).toBeVisible()
    await expect(first.page.getByRole('option', { name: 'china', exact: true })).toBeVisible()
    await first.page.keyboard.press('Escape')
    await first.page.screenshot({ path: testInfo.outputPath('saved-host-aliases.png') })
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
    await session.close(app)
    app = undefined

    const second = await session.launch()
    app = second.app
    await installHostFixtures(app)
    await openHostSettings(second.page)
    for (const [index, alias] of ['italy', 'china'].entries()) {
      const row = second.page.locator(`[data-settings-section="fixture-host-${index}"]`)
      await expect(row.getByText(alias, { exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: `Rename ${alias}` })).toBeVisible()
    }
    await chooseWorkflow(second.page, /^Setup Baseten host/)
    const secondPane = second.page.getByRole('region', { name: 'Baseten hosts' })
    await expect(secondPane.getByRole('button', { name: 'Rename italy' })).toBeVisible()
    await expect(secondPane.getByRole('button', { name: 'Rename china' })).toBeVisible()
    await secondPane.getByRole('button', { name: 'Rename china' }).click()
    await second.page.getByRole('button', { name: 'Reset to default', exact: true }).click()
    await expect(secondPane.getByRole('button', { name: 'Rename orca-cpu-0921' })).toBeVisible()
    await expect(secondPane.getByRole('button', { name: 'Rename italy' })).toBeVisible()
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
  }
})
