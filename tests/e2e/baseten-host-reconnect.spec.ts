import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { RUNTIME_PROTOCOL_VERSION } from '../../src/shared/protocol-version'

test.use({
  seedTestRepo: false,
  orcaAppExtraEnv: {
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_POD_INVENTORY_FILE: join(tmpdir(), `orca-connect-inventory-${randomUUID()}.env`)
  }
})

test('Baseten reconnect keeps the saved server and greys out Connect after verification', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await electronApp.evaluate(({ ipcMain }, protocolVersion) => {
    let connected = false
    const environment = {
      id: 'saved-baseten-server',
      name: 'My saved CPU server',
      runtimeId: 'fixture-runtime',
      createdAt: 1,
      updatedAt: 1,
      pairingRevision: 1,
      lastUsedAt: null,
      connectionDependency: 'ssh-tunnel',
      preferredEndpointId: 'fixture-tunnel',
      endpoints: [
        {
          id: 'fixture-tunnel',
          kind: 'websocket',
          label: 'Tunnel',
          endpoint: 'ws://127.0.0.1:51000'
        }
      ]
    }
    const status = {
      runtimeId: 'fixture-runtime',
      rendererGraphEpoch: 1,
      graphStatus: 'ready',
      authoritativeWindowId: 1,
      liveTabCount: 2,
      liveLeafCount: 2,
      runtimeProtocolVersion: protocolVersion,
      deviceScope: 'runtime'
    }
    ipcMain.removeHandler('basetenHosts:request')
    ipcMain.handle('basetenHosts:request', (_event, request) => {
      if (request.operation === 'list') {
        return [
          {
            name: 'orca-reconnect-test',
            namespace: 'test-cluster',
            storage: '250Gi',
            state: 'ready',
            phase: 'Ready',
            runtimeId: 'fixture-runtime-after-server-restart',
            environmentId: environment.id
          }
        ]
      }
      if (request.operation === 'connect' && request.name === 'orca-reconnect-test') {
        connected = true
        environment.pairingRevision += 1
        environment.endpoints[0].endpoint = 'ws://127.0.0.1:51999'
        return { environment }
      }
      throw new Error('Unexpected fixture operation')
    })
    ipcMain.removeHandler('runtimeEnvironments:list')
    ipcMain.handle('runtimeEnvironments:list', () => [environment])
    ipcMain.removeHandler('runtimeEnvironments:getStatus')
    ipcMain.handle('runtimeEnvironments:getStatus', () =>
      connected
        ? { id: 'status.get', ok: true, result: status, _meta: { runtimeId: status.runtimeId } }
        : {
            id: 'status.get',
            ok: false,
            error: { code: 'runtime_unavailable', message: 'Previous tunnel is closed' }
          }
    )
    ipcMain.removeHandler('runtimeEnvironments:getStatusSnapshots')
    ipcMain.handle('runtimeEnvironments:getStatusSnapshots', () => [
      {
        environmentId: environment.id,
        pairingRevision: environment.pairingRevision,
        sequence: environment.pairingRevision,
        checkedAt: Date.now(),
        status: connected ? status : null,
        verification: connected ? 'verified' : 'unavailable',
        transport: connected ? 'ready' : 'disconnected'
      }
    ])
  }, RUNTIME_PROTOCOL_VERSION)
  await orcaPage.evaluate(() => {
    const store = window.__store!.getState()
    store.openSettingsTarget({ pane: 'servers', repoId: null })
    store.openSettingsPage()
  })
  await orcaPage
    .getByRole('group', { name: 'Remote server workflow' })
    .getByRole('button', { name: /^Setup Baseten host/ })
    .click()
  const hosts = orcaPage.getByRole('region', { name: 'Baseten hosts' })
  const connect = hosts.getByRole('button', { name: 'Connect', exact: true })
  await expect(hosts.getByText('Disconnected', { exact: true })).toBeVisible()
  await expect(connect).toBeEnabled()
  await connect.click()
  await expect(hosts.getByText('Connected', { exact: true })).toBeVisible()
  await expect(connect).toBeDisabled()
  await expect(connect).toHaveAttribute('data-variant', 'secondary')
  await expect(hosts.getByRole('button', { name: 'Pair phone' })).toBeEnabled()
  await expect(hosts.getByRole('button', { name: 'Access link' })).toBeEnabled()
  await expect(hosts.getByRole('alert')).toHaveCount(0)
  const environments = await orcaPage.evaluate(() => window.api.runtimeEnvironments.list())
  expect(environments).toHaveLength(1)
  expect(environments[0]).toMatchObject({
    id: 'saved-baseten-server',
    name: 'My saved CPU server',
    endpoints: [{ endpoint: 'ws://127.0.0.1:51999' }]
  })
  await orcaPage.evaluate(() => document.documentElement.classList.add('dark'))
  await hosts.screenshot({ path: testInfo.outputPath('baseten-connected.png') })
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
})
