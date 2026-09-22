// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useBasetenHostInventory } from './use-baseten-host-inventory'
import type { BasetenHost } from '../../../../shared/baseten-hosts'

const list = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  list.mockReset().mockResolvedValue([])
  Object.defineProperty(window, 'api', { configurable: true, value: { basetenHosts: { list } } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('refreshes inventory and canonical connection details automatically', async () => {
  const refreshConnections = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => useBasetenHostInventory(refreshConnections))
  await act(async () => {})
  expect(result.current.checkedAt).not.toBeNull()
  expect(refreshConnections).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000)
  })
  expect(list).toHaveBeenCalledTimes(2)
  expect(refreshConnections).toHaveBeenCalledTimes(2)
})
it('queues an action-triggered refresh behind a slow request without overlapping it', async () => {
  let finish: (hosts: BasetenHost[]) => void = () => {}
  list.mockReturnValueOnce(
    new Promise<BasetenHost[]>((resolve) => {
      finish = resolve
    })
  )
  const { result } = renderHook(() => useBasetenHostInventory())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000)
  })
  expect(list).toHaveBeenCalledTimes(1)
  act(() => {
    void result.current.refresh()
  })
  await act(async () => {
    finish([])
  })
  expect(list).toHaveBeenCalledTimes(2)
  expect(result.current.refreshing).toBe(false)
})
it('refreshes on return and cancels future polling on unmount', async () => {
  const { unmount } = renderHook(() => useBasetenHostInventory())
  await act(async () => {})
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
  expect(list).toHaveBeenCalledTimes(2)
  unmount()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000)
  })
  expect(list).toHaveBeenCalledTimes(2)
})
