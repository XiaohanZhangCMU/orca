import { useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ManagerTeamDialog } from '../../../src/renderer/src/features/manager-team/ManagerTeamDialog'
import type { ManagerTeamDefinition } from '../../../src/shared/manager-team-contract'
import './team-dialog-fixture.css'
import { readManagerOpenCodeModels } from '../../../src/renderer/src/features/manager-team/manager-opencode-models'

function Fixture() {
  const [submitted, setSubmitted] = useState<ManagerTeamDefinition | null>(null)
  const requests = useRef(0)
  const loadOpenCodeModels = useCallback(async () => {
    requests.current += 1
    await new Promise((resolve) => setTimeout(resolve, 200))
    const scenario = new URLSearchParams(location.search).get('models')
    if (scenario === 'error' && requests.current === 1) {
      throw new Error('Fixture host unavailable')
    }
    return readManagerOpenCodeModels({
      success: true,
      catalogOrigin: 'probe',
      models:
        scenario === 'empty' || (scenario === 'removed' && requests.current > 1)
          ? []
          : [
              { id: 'baseten/zai-org/GLM-5.2' },
              { id: 'baseten-k3/moonshotai/Kimi-K3' },
              { id: 'baseten/moonshotai/Kimi-K3' },
              { id: 'baseten/deepseek-ai/DeepSeek-V4-Pro' },
              { id: 'opencode/big-pickle' }
            ]
    })
  }, [])
  return (
    <>
      <ManagerTeamDialog
        open
        onOpenChange={() => undefined}
        host="k8s-cpu (fixture)"
        loadOpenCodeModels={loadOpenCodeModels}
        busy={false}
        available
        attempted={false}
        status=""
        error={null}
        report={null}
        onCreate={setSubmitted}
        onInspect={() => undefined}
        onOpenReport={() => undefined}
      />
      <output data-testid="submitted">{JSON.stringify(submitted)}</output>
    </>
  )
}
const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing fixture root')
}
createRoot(root).render(<Fixture />)
