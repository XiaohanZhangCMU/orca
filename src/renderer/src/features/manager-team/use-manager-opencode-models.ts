import { useEffect, useState } from 'react'
import type { ManagerModelOption } from './manager-opencode-models'

export type ManagerModelLoader = () => Promise<ManagerModelOption[]>
export type ManagerModelList = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  models: ManagerModelOption[]
  error?: string
}

export function useManagerOpenCodeModels(enabled: boolean, load?: ManagerModelLoader) {
  const [attempt, setAttempt] = useState(0)
  const [list, setList] = useState<ManagerModelList>({ status: 'idle', models: [] })
  useEffect(() => {
    if (!enabled || !load) {
      return
    }
    let active = true
    setList({ status: 'loading', models: [] })
    void load().then(
      (models) => {
        if (active) {
          setList({ status: 'ready', models })
        }
      },
      (error: unknown) => {
        if (active) {
          setList({
            status: 'error',
            models: [],
            error: error instanceof Error ? error.message : 'Could not load models from this host.'
          })
        }
      }
    )
    return () => {
      active = false
    }
  }, [enabled, load, attempt])
  return { list, reload: () => setAttempt((value) => value + 1) }
}
