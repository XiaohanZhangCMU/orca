// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagerModelOption } from './manager-opencode-models'
import { useManagerOpenCodeModels } from './use-manager-opencode-models'

afterEach(cleanup)
const models = [{ id: 'baseten/a/model', label: 'model' }]

describe('team-scoped OpenCode discovery', () => {
  it('loads only when OpenCode is selected, without one request per worker', async () => {
    const load = vi.fn(async () => models)
    const { result, rerender } = renderHook(
      ({ enabled }) => useManagerOpenCodeModels(enabled, load),
      { initialProps: { enabled: false } }
    )
    expect(load).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.list).toEqual({ status: 'ready', models }))
    rerender({ enabled: true })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('exposes failure and explicitly retries without starting any agent', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce([])
    const { result } = renderHook(() => useManagerOpenCodeModels(true, load))
    await waitFor(() =>
      expect(result.current.list).toEqual({ status: 'error', models: [], error: 'Disconnected' })
    )
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.list).toEqual({ status: 'ready', models: [] }))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('ignores a late reply from a previous host', async () => {
    const previous = Promise.withResolvers<ManagerModelOption[]>()
    const oldHost = vi.fn(() => previous.promise)
    const newHost = vi.fn(async () => models)
    const { result, rerender } = renderHook(({ load }) => useManagerOpenCodeModels(true, load), {
      initialProps: { load: oldHost }
    })
    rerender({ load: newHost })
    await waitFor(() => expect(result.current.list.models).toEqual(models))
    await act(async () => previous.resolve([{ id: 'baseten/old/model', label: 'Old host' }]))
    expect(result.current.list.models).toEqual(models)
  })

  it('ignores a late result after OpenCode is deselected', async () => {
    const pending = Promise.withResolvers<ManagerModelOption[]>()
    const load = () => pending.promise
    const { result, rerender } = renderHook(
      ({ enabled }) => useManagerOpenCodeModels(enabled, load),
      { initialProps: { enabled: true } }
    )
    rerender({ enabled: false })
    await act(async () => pending.resolve(models))
    expect(result.current.list.models).toEqual([])
  })
})
