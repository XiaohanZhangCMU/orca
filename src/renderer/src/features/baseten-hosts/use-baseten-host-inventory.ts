import { useCallback, useEffect, useRef, useState } from 'react'
import type { BasetenHost } from '../../../../shared/baseten-hosts'

export function useBasetenHostInventory(onRefreshed?: () => Promise<void>) {
  const callback = useRef(onRefreshed)
  useEffect(() => {
    callback.current = onRefreshed
  }, [onRefreshed])
  const [hosts, setHosts] = useState<BasetenHost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const pending = useRef<Promise<void> | null>(null)
  const queued = useRef(false)
  const refresh = useCallback((): Promise<void> => {
    if (pending.current) {
      queued.current = true
      return pending.current
    }
    const api = window.api.basetenHosts
    if (!api || !mounted.current) {
      return Promise.resolve()
    }
    setRefreshing(true)
    const task = (async () => {
      do {
        queued.current = false
        try {
          const rows = await api.list()
          if (mounted.current) {
            setHosts(rows)
            setError(null)
            setCheckedAt(new Date())
            await callback.current?.()
          }
        } catch (failure) {
          if (mounted.current) {
            setError(
              failure instanceof Error ? failure.message : 'Could not verify the registered hosts.'
            )
          }
        }
      } while (queued.current && mounted.current)
    })().finally(() => {
      pending.current = null
      if (mounted.current) {
        setLoading(false)
        setRefreshing(false)
      }
    })
    pending.current = task
    return task
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => {
      if (!pending.current) {
        void refresh()
      }
    }, 15000)
    const onReturn = () => {
      if (!document.hidden) {
        void refresh()
      }
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      mounted.current = false
      clearInterval(timer)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [refresh])
  return { hosts, loading, refreshing, checkedAt, error, refresh }
}
