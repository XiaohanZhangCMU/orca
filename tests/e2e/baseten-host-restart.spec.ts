import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import {
  expectTerminalAccessibilityText,
  focusActiveTerminalInput,
  resolveActiveTabId,
  waitForActivePanePtyId
} from './helpers/terminal'
import { decodePairingOffer, encodePairingOffer } from '../../src/shared/pairing'
import {
  addEnvironmentFromPairingCode,
  markEnvironmentUsed
} from '../../src/shared/runtime-environment-store'

test.skip(
  process.platform === 'win32',
  'The local fake kubectl fixture uses a POSIX executable script.'
)

async function hostsPane(page: Page) {
  await page.evaluate(() => {
    const store = window.__store!.getState()
    store.openSettingsTarget({ pane: 'servers', repoId: null })
    store.openSettingsPage()
  })
  await page
    .getByRole('group', { name: 'Remote server workflow' })
    .getByRole('button', { name: /^Setup Baseten host/ })
    .click()
  return page.getByRole('region', { name: 'Baseten hosts' })
}

// oxlint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
test('refreshes pairing after startup without Settings and preserves Disconnect across relaunch', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'orca-baseten-restart-'))
  const host = await launchHeadlessPairedRuntimeHost()
  const offer = decodePairingOffer(host.offer.pairingUrl)
  const registration = {
    name: 'restart-cpu',
    management: 'installer',
    instance: '02096460-2ee2-4f40-bbc8-c4d30d7a8e63',
    publicKeyB64: offer.publicKeyB64
  }
  mkdirSync(join(root, 'extensions', 'pod-setup'), { recursive: true })
  mkdirSync(join(root, 'out', 'pod-setup'), { recursive: true })
  writeFileSync(join(root, 'extensions', 'pod-setup', 'build.mjs'), '')
  copyFileSync(
    join(process.cwd(), 'tests/e2e/fixtures/baseten-restart-worker.cjs'),
    join(root, 'out', 'pod-setup', 'desktop.cjs')
  )
  copyFileSync(
    join(process.cwd(), 'tests/e2e/fixtures/baseten-restart-forward.cjs'),
    join(root, 'forward.cjs')
  )
  chmodSync(join(root, 'forward.cjs'), 0o700)
  writeFileSync(
    join(root, 'fixture.json'),
    JSON.stringify({
      registration,
      waitForAccessFile: true,
      link: encodePairingOffer({ ...offer, scope: 'runtime', endpoint: 'ws://127.0.0.1:6770' })
    }),
    { mode: 0o600 }
  )
  const session = createRestartSession(testInfo, {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_DEV_REPO_ROOT: root,
    ORCA_BASETEN_FIXTURE_PORT: new URL(offer.endpoint).port
  })
  const saved = addEnvironmentFromPairingCode(session.userDataDir, {
    name: 'Renamed CPU host',
    pairingCode: encodePairingOffer({ ...offer, endpoint: 'ws://127.0.0.1:1' }),
    connectionDependency: 'ssh-tunnel'
  })
  markEnvironmentUsed(session.userDataDir, saved.id, { runtimeId: 'old-runtime-id' })
  const accessCount = () =>
    existsSync(join(root, 'access-count'))
      ? readFileSync(join(root, 'access-count'), 'utf8').trim().split('\n').length
      : 0
  let app: ElectronApplication | undefined
  try {
    const { result } = await host.client.call<{ group: { id: string } }>('projectGroup.create', {
      name: 'Restart workspaces',
      parentPath: host.userDataDir
    })
    await host.client.call('folderWorkspace.create', {
      projectGroupId: result.group.id,
      name: 'Reconnect workspace',
      folderPath: host.userDataDir
    })
    const first = await session.launch()
    app = first.app
    // Hold reconnect until the renderer has loaded the old pairing, without opening Settings.
    await first.page.waitForFunction((environmentId) => {
      const state = window.__store!.getState()
      return (
        state.runtimeEnvironmentCatalogSettled &&
        state.runtimeEnvironments.some((environment) => environment.id === environmentId)
      )
    }, saved.id)
    writeFileSync(join(root, 'access-ready'), '')
    await expect(first.page.getByText('Restart workspaces', { exact: true })).toBeVisible({
      timeout: 30_000
    })
    await expect(first.page.getByText('Reconnect workspace', { exact: true })).toBeVisible()
    await first.page.getByText('Reconnect workspace', { exact: true }).click()
    await waitForActivePanePtyId(first.page)
    const tabId = await resolveActiveTabId(first.page)
    if (!tabId) {
      throw new Error('Remote workspace did not open a terminal')
    }
    await focusActiveTerminalInput(first.page)
    await first.page.keyboard.type("printf '%s%s\\n' 'PAIRING_' 'CURRENT'")
    await first.page.keyboard.press('Enter')
    await expectTerminalAccessibilityText(first.page, tabId, 'PAIRING_CURRENT')
    await first.page.screenshot({ path: testInfo.outputPath('reconnected-without-settings.png') })
    const firstPane = await hostsPane(first.page)
    await expect(firstPane.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(firstPane.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
    expect(accessCount()).toBe(1)
    await session.close(app)
    app = undefined

    const second = await session.launch()
    app = second.app
    const secondPane = await hostsPane(second.page)
    await expect(secondPane.getByText('Connected', { exact: true })).toBeVisible({
      timeout: 30_000
    })
    expect(accessCount()).toBe(2)
    const environments = await second.page.evaluate(() => window.api.runtimeEnvironments.list())
    expect(environments).toHaveLength(1)
    expect(environments[0].id).toBe(saved.id)
    await second.page
      .getByRole('group', { name: 'Remote server workflow' })
      .getByRole('button', { name: /^Connect to a host/ })
      .click()
    await second.page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(second.page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(
      0
    )
    await session.close(app)
    app = undefined

    const third = await session.launch()
    app = third.app
    const thirdPane = await hostsPane(third.page)
    await expect(thirdPane.getByText('Disconnected', { exact: true })).toBeVisible()
    await expect(thirdPane.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
    expect(accessCount()).toBe(2)
    await thirdPane.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(thirdPane.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(thirdPane.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
    expect(accessCount()).toBe(3)
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
    await thirdPane.screenshot({ path: testInfo.outputPath('baseten-restart-connected.png') })
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    await host.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
