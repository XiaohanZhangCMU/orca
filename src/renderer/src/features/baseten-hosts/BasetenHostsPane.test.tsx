// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BasetenHostsPane } from './BasetenHostsPane'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { RuntimeHostDetails } from '@/components/settings/runtime-environment-host-details'

const api = { list: vi.fn(), access: vi.fn(), connect: vi.fn(), copy: vi.fn(), phone: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      basetenHosts: api,
      ui: { writeClipboardText: api.copy }
    }
  })
  api.list.mockResolvedValue([
    {
      name: 'orca-test',
      namespace: 'test-cluster',
      storage: '250Gi',
      state: 'ready',
      phase: 'Ready',
      runtimeId: 'runtime-test',
      environmentId: 'saved-host'
    }
  ])
  api.access.mockResolvedValue({ link: 'private-desktop-link' })
  api.connect.mockResolvedValue({ environment: { id: 'environment-test', name: 'orca-test' } })
})
afterEach(cleanup)

it('greys out Connect for a connected host and re-enables it after disconnection', async () => {
  const environment: PublicKnownRuntimeEnvironment = {
    id: 'saved-host',
    name: 'A renamed server',
    runtimeId: 'runtime-before-server-restart',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    preferredEndpointId: 'endpoint',
    endpoints: [
      { id: 'endpoint', kind: 'websocket', label: 'Tunnel', endpoint: 'ws://127.0.0.1:6770' }
    ]
  }
  const connected: RuntimeHostDetails = {
    status: 'ready',
    runtimeStatus: null,
    error: null,
    compatibility: { kind: 'ok', clientProtocolVersion: 3, serverProtocolVersion: 3 }
  }
  const props = { environments: [environment], onConnected: vi.fn(), onSetup: vi.fn() }
  const { rerender } = render(<BasetenHostsPane {...props} details={{ 'saved-host': connected }} />)
  const button = await screen.findByRole('button', { name: /^Connect$/ })
  expect(screen.getByText('Connected')).toBeTruthy()
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(button.dataset.variant).toBe('secondary')
  fireEvent.click(button)
  expect(api.access).not.toHaveBeenCalled()
  expect(api.connect).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Access link' }).hasAttribute('disabled')).toBe(false)
  expect(screen.getByRole('button', { name: 'Pair phone' }).hasAttribute('disabled')).toBe(false)
  rerender(
    <BasetenHostsPane
      {...props}
      details={{
        'saved-host': {
          status: 'error',
          runtimeStatus: null,
          compatibility: null,
          error: 'Disconnected'
        }
      }}
    />
  )
  expect(button.hasAttribute('disabled')).toBe(false)
  expect(button.dataset.variant).toBe('default')
})

it('does not confuse a ready pod with a connected desktop', async () => {
  render(
    <BasetenHostsPane environments={[]} details={{}} onConnected={vi.fn()} onSetup={vi.fn()} />
  )
  await screen.findByText('Pod ready')
  expect(screen.getByText('Not connected')).toBeTruthy()
  expect(api.access).not.toHaveBeenCalled()
})

it('shows automatic reconnection and prevents a duplicate Connect click', async () => {
  api.list.mockResolvedValue([
    {
      name: 'orca-test',
      namespace: 'test-cluster',
      storage: '250Gi',
      state: 'ready',
      phase: 'Ready',
      reconnecting: true
    }
  ])
  render(
    <BasetenHostsPane environments={[]} details={{}} onConnected={vi.fn()} onSetup={vi.fn()} />
  )
  expect(await screen.findByText('Connecting')).toBeTruthy()
  expect(screen.getByRole('button', { name: /^Connect$/ }).hasAttribute('disabled')).toBe(true)
  expect(api.connect).not.toHaveBeenCalled()
})

it('connects through a verified private loopback tunnel, not a manual paste', async () => {
  const onConnected = vi.fn()
  render(
    <BasetenHostsPane environments={[]} details={{}} onConnected={onConnected} onSetup={vi.fn()} />
  )
  fireEvent.click(await screen.findByRole('button', { name: /^Connect$/ }))
  await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
  expect(api.connect).toHaveBeenCalledWith('orca-test')
  expect(api.access).not.toHaveBeenCalled()
  expect(api.copy).not.toHaveBeenCalled()
})

it('does not reconnect or register a host just to copy its access link', async () => {
  const onConnected = vi.fn()
  render(
    <BasetenHostsPane environments={[]} details={{}} onConnected={onConnected} onSetup={vi.fn()} />
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Access link' }))
  await waitFor(() => expect(api.copy).toHaveBeenCalledWith('private-desktop-link'))
  expect(api.connect).not.toHaveBeenCalled()
  expect(onConnected).not.toHaveBeenCalled()
})

it('shows a failed reconnect without claiming the host is connected', async () => {
  api.connect.mockRejectedValueOnce(new Error('Host identity does not match'))
  const onConnected = vi.fn()
  render(
    <BasetenHostsPane environments={[]} details={{}} onConnected={onConnected} onSetup={vi.fn()} />
  )
  fireEvent.click(await screen.findByRole('button', { name: /^Connect$/ }))
  expect((await screen.findByRole('alert')).textContent).toBe('Host identity does not match')
  expect(onConnected).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /^Connect$/ }).hasAttribute('disabled')).toBe(false)
})

it('never offers a stale access link for an unverifiable pod', async () => {
  api.list.mockResolvedValue([
    {
      name: 'orca-test',
      namespace: 'test-cluster',
      storage: '250Gi',
      state: 'unverifiable',
      phase: 'Cluster unreachable'
    }
  ])
  render(
    <BasetenHostsPane environments={[]} details={{}} onConnected={vi.fn()} onSetup={vi.fn()} />
  )
  const access = await screen.findByRole('button', { name: 'Access link' })
  expect(access.hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'Pair phone' }).hasAttribute('disabled')).toBe(true)
})
