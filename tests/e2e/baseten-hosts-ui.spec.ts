import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { openSidebarWorkspaceComposer } from './helpers/sidebar-project-dialog'
import { encodeMobilePairingQr } from '../../src/main/runtime/mobile-pairing-qr'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../src/shared/pairing'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

test.use({
  orcaAppExtraEnv: {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_DEV_REPO_ROOT: process.cwd(),
    ORCA_POD_INVENTORY_FILE: join(tmpdir(), `orca-ui-inventory-${randomUUID()}.env`)
  }
})

test('Team workflow is available in workspace creation and the plus menu', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
  await expect(orcaPage.getByRole('button', { name: 'New manager team', exact: true })).toHaveCount(
    0
  )
  await orcaPage.getByRole('button', { name: 'New tab', exact: true }).first().click()
  await orcaPage.getByRole('menuitem', { name: 'Team workflow', exact: true }).click()
  const team = orcaPage.getByRole('dialog', { name: 'New manager team' })
  await expect(team).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('team-workflow.png') })
  await team.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openSidebarWorkspaceComposer(orcaPage)
  const create = orcaPage.getByRole('dialog', { name: /Create (workspace|worktree)/i })
  await create
    .locator('[data-contextual-tour-target="workspace-creation-agent"]')
    .getByRole('combobox')
    .click()
  await orcaPage.getByRole('option', { name: 'Team workflow', exact: true }).click()
  await expect(
    create.getByRole('button', { name: /Create workspace & configure team/ })
  ).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('workspace-team-option.png') })
  await create.getByRole('button', { name: /Create workspace & configure team/ }).click()
  await expect(team).toBeVisible({ timeout: 30_000 })
  await expect(team.getByText(/Execution host:/)).toBeVisible()
})

test('Baseten settings display creation, connection and phone pairing without provisioning real resources', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  const local = await orcaPage.evaluate(async () => ({
    defaults: await window.api.basetenHosts!.defaults(),
    hosts: await window.api.basetenHosts!.list()
  }))
  expect(local.defaults.storageGi).toBe(250)
  expect(local.hosts).toEqual([])
  const link = encodePairingOffer({
    v: PAIRING_OFFER_VERSION,
    endpoint: 'ws://100.64.0.10:6770',
    scope: 'mobile',
    deviceToken: 'ui-fixture-not-a-real-token',
    publicKeyB64: Buffer.alloc(32).toString('base64')
  })
  const qr = await encodeMobilePairingQr(link)
  if (!qr.ok) {
    throw new Error('Fixture QR generation failed')
  }
  await electronApp.evaluate(
    ({ ipcMain }, fixture) => {
      let created = false
      let released = false
      let phoneEnabled = false
      let phoneRefreshes = 0
      ipcMain.removeHandler('basetenHosts:request')
      ipcMain.handle('basetenHosts:request', (_event, request) => {
        if (request.operation === 'defaults') {
          return {
            name: 'orca-ui-test',
            namespace: 'test-cluster',
            source: '/trusted/orca',
            dreamteam: '/trusted/dreamteam',
            kubeconfig: '/private/kubeconfig',
            storageGi: 250,
            prompt: 'UI fixture only'
          }
        }
        if (request.operation === 'list') {
          return created
            ? [
                {
                  name: 'orca-ui-test',
                  namespace: 'test-cluster',
                  storage: '250Gi',
                  state: released ? 'released' : 'ready',
                  phase: released ? 'Compute released. Persistent disk retained.' : 'Ready',
                  management: 'installer',
                  instance: 'd98da145-8f28-481f-82ce-5dd5c095fa80',
                  runtimeId: 'fixture'
                }
              ]
            : []
        }
        if (request.operation === 'check') {
          return {
            ticket: 'test-ticket',
            checks: [
              { service: 'github', status: 'verified', optional: false },
              { service: 'notion', status: 'missing', optional: true }
            ],
            repositories: ['orca', 'dreamteam', 'trainers', 'baseten']
          }
        }
        if (request.operation === 'create') {
          if (!request.consent) {
            throw new Error('Consent required')
          }
          created = true
          return
        }
        if (request.operation === 'phone') {
          if (phoneEnabled) {
            if (phoneRefreshes++ === 0) {
              return {
                state: 'authorizing',
                authUrl: 'https://login.tailscale.com/a/testfixture',
                message: 'Authorize this pod in Tailscale.'
              }
            }
            return {
              state: 'ready',
              link: fixture.link,
              qrDataUrl: fixture.qrDataUrl,
              endpoint: 'ws://100.64.0.10:6770',
              message: 'Ready to pair; phone connection has not been verified.'
            }
          }
          return { state: 'not-enabled', message: 'Enable private phone access for this host.' }
        }
        if (request.operation === 'enablePhone') {
          phoneEnabled = true
          return
        }
        if (request.operation === 'release') {
          if (
            request.confirmation !== 'orca-ui-test' ||
            request.instance !== 'd98da145-8f28-481f-82ce-5dd5c095fa80'
          ) {
            throw new Error('Exact confirmation required')
          }
          released = true
          return
        }
        throw new Error('Unexpected test operation')
      })
    },
    { link, qrDataUrl: qr.qrDataUrl }
  )
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'servers', repoId: null })
    state.openSettingsPage()
  })
  await orcaPage
    .getByRole('group', { name: 'Remote server workflow' })
    .getByRole('button', { name: /^Setup Baseten host/ })
    .click()
  await orcaPage.getByRole('button', { name: 'Create host', exact: true }).click()
  const setup = orcaPage.getByRole('dialog', { name: 'Create a Baseten host' })
  await expect(setup.getByLabel('Persistent storage (GiB)')).toHaveValue('250')
  await setup.getByRole('button', { name: 'Check setup', exact: true }).click()
  const create = setup.getByRole('button', { name: 'Create host', exact: true })
  await expect(create).toBeDisabled()
  await setup.getByRole('checkbox').click()
  await orcaPage.screenshot({ path: testInfo.outputPath('baseten-setup.png') })
  await create.click()
  await expect(orcaPage.getByText('orca-ui-test', { exact: true })).toBeVisible()
  await expect(orcaPage.getByText('Not connected', { exact: true })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('baseten-hosts.png') })
  await orcaPage.getByRole('button', { name: 'Pair phone', exact: true }).click()
  await expect(orcaPage.getByLabel('Allowed devices’ Tailscale IPv4 addresses')).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('baseten-phone.png') })
  await orcaPage.getByLabel('Allowed devices’ Tailscale IPv4 addresses').fill('100.64.0.20')
  await orcaPage.getByRole('button', { name: 'Enable private phone access', exact: true }).click()
  await expect(orcaPage.getByRole('button', { name: 'Authorize host in Tailscale' })).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Refresh phone access' }).click()
  await expect(
    orcaPage.getByRole('img', { name: 'Private Orca Mobile pairing QR for orca-ui-test' })
  ).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Copy phone pairing link' })).toBeVisible()
  await orcaPage.getByRole('dialog').screenshot({
    path: testInfo.outputPath('baseten-phone-qr.png'),
    animations: 'disabled'
  })
  await orcaPage.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await orcaPage.getByRole('button', { name: 'Pair phone', exact: true }).click()
  await expect(
    orcaPage.getByRole('img', { name: 'Private Orca Mobile pairing QR for orca-ui-test' })
  ).toBeVisible()
  await expect(orcaPage.getByLabel('Allowed devices’ Tailscale IPv4 addresses')).toHaveCount(0)
  await orcaPage.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await orcaPage.getByRole('button', { name: 'Release host', exact: true }).click()
  const release = orcaPage.getByRole('dialog', { name: 'Release orca-ui-test?' })
  await expect(release.getByRole('button', { name: 'Release host', exact: true })).toBeDisabled()
  await expect(release.getByText(/persistent disk.*stay in the cluster/)).toBeVisible()
  await release.getByLabel('Type orca-ui-test to confirm').fill('orca-ui-test')
  await release.screenshot({
    path: testInfo.outputPath('baseten-release.png'),
    animations: 'disabled'
  })
  await orcaPage.evaluate(() => document.documentElement.classList.add('dark'))
  await release.screenshot({
    path: testInfo.outputPath('baseten-release-dark.png'),
    animations: 'disabled'
  })
  await orcaPage.evaluate(() => document.documentElement.classList.remove('dark'))
  await release.getByRole('button', { name: 'Release host', exact: true }).click()
  await expect(orcaPage.getByText('Released', { exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
  await expect(orcaPage.getByRole('button', { name: 'Release host', exact: true })).toBeDisabled()
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
})
