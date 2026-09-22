// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BasetenReleaseDialog } from './BasetenReleaseDialog'

afterEach(cleanup)
it('requires the exact host name and explains that sessions stop but disk data stays', async () => {
  const release = vi.fn().mockResolvedValue(undefined)
  const onReleased = vi.fn()
  Object.defineProperty(window, 'api', { configurable: true, value: { basetenHosts: { release } } })
  render(
    <BasetenReleaseDialog
      host={{
        name: 'orca-test',
        namespace: 'test-cluster',
        storage: '250Gi',
        phase: 'Ready',
        state: 'ready',
        instance: 'test-instance'
      }}
      onClose={vi.fn()}
      onReleased={onReleased}
    />
  )
  const button = screen.getByRole('button', { name: /^Release host$/ })
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(/All running agents and terminal sessions/)).toBeTruthy()
  expect(screen.getByText(/persistent disk.*stay in the cluster/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Type orca-test to confirm'), {
    target: { value: 'orca-test' }
  })
  fireEvent.click(button)
  await waitFor(() => expect(onReleased).toHaveBeenCalledTimes(1))
  expect(release).toHaveBeenCalledWith('orca-test', 'test-instance', 'orca-test')
})
