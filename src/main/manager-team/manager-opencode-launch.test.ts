import { expect, it } from 'vitest'
import { resolveWorkerLaunchPreferences } from '../runtime/rpc/methods/orchestration/worker/worker-launch-preferences'

it('preserves the selected OpenCode provider/model ID at launch', () => {
  for (const model of [
    'baseten-k3/moonshotai/Kimi-K3',
    'baseten/deepseek-ai/DeepSeek-V4-Pro',
    'baseten/zai-org/GLM-5.2'
  ]) {
    expect(
      resolveWorkerLaunchPreferences({ agent: 'opencode', model }).receipt?.effective?.model
    ).toBe(model)
  }
})
