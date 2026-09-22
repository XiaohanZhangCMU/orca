// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BasetenSetupDialog } from './BasetenSetupDialog'

const api = { defaults: vi.fn(), check: vi.fn(), create: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { configurable: true, value: { basetenHosts: api } })
  api.defaults.mockResolvedValue({
    name: 'orca-test',
    namespace: 'test-cluster',
    storageGi: 250,
    source: '/checkout',
    dreamteam: '/dreamteam',
    kubeconfig: '/kubeconfig',
    prompt: 'Create the test host'
  })
  api.check.mockResolvedValue({
    ticket: 'ticket',
    checks: [
      { service: 'github', status: 'verified', optional: false },
      { service: 'notion', status: 'missing', optional: true }
    ],
    repositories: ['orca', 'trainers']
  })
  api.create.mockResolvedValue(undefined)
})
afterEach(cleanup)

it('requires successful checks and explicit credential consent before creation', async () => {
  const onCreated = vi.fn()
  render(<BasetenSetupDialog onClose={vi.fn()} onCreated={onCreated} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Check setup' }))
  const create = await screen.findByRole('button', { name: 'Create host' })
  expect(create.hasAttribute('disabled')).toBe(true)
  expect(api.create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(create)
  await waitFor(() => expect(api.create).toHaveBeenCalledWith('ticket', true))
  expect(onCreated).toHaveBeenCalledTimes(1)
})

it('invalidates the check ticket when the target or storage changes', async () => {
  render(<BasetenSetupDialog onClose={vi.fn()} onCreated={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Check setup' }))
  await screen.findByRole('button', { name: 'Create host' })
  fireEvent.change(screen.getByLabelText('Host name'), { target: { value: 'different-host' } })
  expect(screen.queryByRole('button', { name: 'Create host' })).toBeNull()
  expect(api.create).not.toHaveBeenCalled()
})

it('blocks volumes below 250 GiB and does not make a preflight request', async () => {
  render(<BasetenSetupDialog onClose={vi.fn()} onCreated={vi.fn()} />)
  const storage = await screen.findByLabelText('Persistent storage (GiB)')
  fireEvent.change(storage, { target: { value: '249' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check setup' }))
  expect(screen.getByRole('alert').textContent).toContain('250 GiB')
  expect(api.check).not.toHaveBeenCalled()
})

it('keeps failed required checks blocked even when Notion is optional', async () => {
  api.check.mockResolvedValue({
    ticket: null,
    checks: [{ service: 'github', status: 'failed', optional: false }],
    repositories: []
  })
  render(<BasetenSetupDialog onClose={vi.fn()} onCreated={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Check setup' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Create host' })).toBeNull()
})
