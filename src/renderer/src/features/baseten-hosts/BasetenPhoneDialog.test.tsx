// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BasetenPhoneDialog } from './BasetenPhoneDialog'

afterEach(cleanup)
it('displays an existing phone QR immediately without asking to enable the host again', async () => {
  const phone = vi.fn().mockResolvedValue({
    state: 'ready',
    qrDataUrl: 'data:image/png;base64,fixture',
    link: 'private-mobile-link',
    endpoint: 'ws://100.64.0.1:6770',
    message: 'Saved phone pairing'
  })
  Object.defineProperty(window, 'api', { configurable: true, value: { basetenHosts: { phone } } })
  render(<BasetenPhoneDialog name="legacy-host" onClose={vi.fn()} />)
  expect(
    await screen.findByRole('img', { name: 'Private Orca Mobile pairing QR for legacy-host' })
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Copy phone pairing link' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Enable private phone access' })).toBeNull()
  expect(phone).toHaveBeenCalledWith('legacy-host')
})
