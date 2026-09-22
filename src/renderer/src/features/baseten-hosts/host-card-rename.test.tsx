// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { RuntimeServerRow } from '@/components/settings/runtime-server-row'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { BasetenHostsPane } from './BasetenHostsPane'

const initialState = useAppStore.getInitialState()
const environment: PublicKnownRuntimeEnvironment = {
  id: 'saved-host',
  name: 'k8s-cpu-orca',
  runtimeId: 'original-runtime',
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: null,
  preferredEndpointId: 'endpoint',
  endpoints: [
    { id: 'endpoint', kind: 'websocket', label: 'Tunnel', endpoint: 'ws://127.0.0.1:6770' }
  ]
}
const host = {
  name: 'k8s-cpu-orca',
  namespace: 'fixture',
  storage: '250Gi',
  state: 'ready',
  phase: 'Ready',
  environmentId: environment.id,
  runtimeId: 'new-runtime-after-restart'
}
const api = { list: vi.fn(), connect: vi.fn(), access: vi.fn(), phone: vi.fn(), copy: vi.fn() }
const connectServer = vi.fn()
const updateSettings = vi.fn(async (updates: Partial<GlobalSettings>) => {
  useAppStore.setState({
    settings: { ...getDefaultSettings('/fixture'), ...useAppStore.getState().settings, ...updates }
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState(initialState, true)
  useAppStore.setState({
    settings: {
      ...getDefaultSettings('/fixture'),
      hostSettingOverrides: {
        'runtime:saved-host': { defaultWorktreeLocation: '/home/orca/worktrees' },
        'runtime:other-host': { displayLabel: 'china' }
      }
    },
    updateSettings
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { basetenHosts: api, ui: { writeClipboardText: api.copy } }
  })
  api.list.mockResolvedValue([host])
  api.connect.mockResolvedValue({ environment })
  api.access.mockResolvedValue({ link: 'fixture-access-link' })
  api.phone.mockResolvedValue({ state: 'unverifiable', message: 'Fixture only' })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

async function cards() {
  render(
    <>
      <section aria-label="Saved servers">
        <RuntimeServerRow
          environment={environment}
          details={{
            status: 'error',
            runtimeStatus: null,
            compatibility: null,
            error: 'Disconnected'
          }}
          isActive={false}
          remoteUpdate={undefined}
          remoteServerUpdatesRunning={false}
          connecting={false}
          switching={false}
          disconnecting={false}
          removing={false}
          isBusy={false}
          onOpenUpdate={vi.fn()}
          onConnect={connectServer}
          onDisconnect={vi.fn()}
          onRemove={vi.fn()}
        />
      </section>
      <BasetenHostsPane
        environments={[environment]}
        details={{}}
        onConnected={vi.fn()}
        onSetup={vi.fn()}
      />
    </>
  )
  const saved = within(screen.getByRole('region', { name: 'Saved servers' }))
  const pods = within(screen.getByRole('region', { name: 'Baseten hosts' }))
  await pods.findByText('Pod ready')
  return { saved, pods }
}

it.each(['saved', 'pods'] as const)(
  'renames a disconnected host from %s without changing its identity',
  async (surface) => {
    const views = await cards()
    fireEvent.click(views[surface].getByRole('button', { name: 'Rename k8s-cpu-orca' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: ' italy ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    for (const view of Object.values(views)) {
      expect(await view.findByRole('button', { name: 'Rename italy' })).toBeTruthy()
      expect(view.getByText('italy', { exact: true })).toBeTruthy()
      expect(view.getByText('k8s-cpu-orca', { exact: true })).toBeTruthy()
    }
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      hostSettingOverrides: {
        'runtime:saved-host': {
          defaultWorktreeLocation: '/home/orca/worktrees',
          displayLabel: 'italy'
        },
        'runtime:other-host': { displayLabel: 'china' }
      }
    })
    expect(api.connect).not.toHaveBeenCalled()
    expect(api.access).not.toHaveBeenCalled()
    expect(api.phone).not.toHaveBeenCalled()
    expect(connectServer).not.toHaveBeenCalled()

    fireEvent.click(views.pods.getByRole('button', { name: 'Access link' }))
    await waitFor(() => expect(api.copy).toHaveBeenCalledWith('fixture-access-link'))
    expect(api.access).toHaveBeenCalledWith('k8s-cpu-orca')
    fireEvent.click(views.pods.getByRole('button', { name: 'Pair phone' }))
    await waitFor(() => expect(api.phone).toHaveBeenCalledWith('k8s-cpu-orca'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(views.saved.getByRole('button', { name: 'Connect' }))
    expect(connectServer).toHaveBeenCalledWith(environment)
    fireEvent.click(views.pods.getByRole('button', { name: 'Connect' }))
    await views.pods.findByText(/Connected to italy\./)
    expect(api.connect).toHaveBeenCalledWith('k8s-cpu-orca')
  }
)

it('cancels an edit and discards it when reopened', async () => {
  const { pods } = await cards()
  fireEvent.click(pods.getByRole('button', { name: 'Rename k8s-cpu-orca' }))
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'not-saved' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(updateSettings).not.toHaveBeenCalled()
  fireEvent.click(pods.getByRole('button', { name: 'Rename k8s-cpu-orca' }))
  expect(screen.getByLabelText('Display name').getAttribute('value')).toBe('')
})

it.each(['Reset to default', 'blank'])('restores the original name using %s', async (action) => {
  await updateSettings({
    hostSettingOverrides: {
      'runtime:saved-host': {
        displayLabel: 'italy',
        defaultWorktreeLocation: '/home/orca/worktrees'
      },
      'runtime:other-host': { displayLabel: 'china' }
    }
  })
  const { pods, saved } = await cards()
  fireEvent.click(pods.getByRole('button', { name: 'Rename italy' }))
  if (action === 'blank') {
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '  ' } })
    fireEvent.keyDown(screen.getByLabelText('Display name'), { key: 'Enter' })
  } else {
    fireEvent.click(screen.getByRole('button', { name: action }))
  }
  expect(await saved.findByRole('button', { name: 'Rename k8s-cpu-orca' })).toBeTruthy()
  expect(pods.getByRole('button', { name: 'Rename k8s-cpu-orca' })).toBeTruthy()
  expect(useAppStore.getState().settings?.hostSettingOverrides).toEqual({
    'runtime:saved-host': { defaultWorktreeLocation: '/home/orca/worktrees' },
    'runtime:other-host': { displayLabel: 'china' }
  })
})

it('requires a saved host identity before offering a pod alias', async () => {
  api.list.mockResolvedValue([{ ...host, environmentId: undefined }])
  const { pods } = await cards()
  expect(pods.getByRole('button', { name: 'Rename k8s-cpu-orca' }).hasAttribute('disabled')).toBe(
    true
  )
  expect(pods.getByText('Connect once to enable Rename.')).toBeTruthy()
  expect(api.connect).not.toHaveBeenCalled()
})
