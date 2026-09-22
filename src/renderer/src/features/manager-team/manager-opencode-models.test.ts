import { describe, expect, it } from 'vitest'
import { parseLineModels } from '../../../../shared/commit-message-model-parsers'
import { readManagerOpenCodeModels } from './manager-opencode-models'

const reply = (ids: string[]) => ({
  success: true,
  catalogOrigin: 'probe',
  models: parseLineModels(ids.join('\n'))
})

describe('Dreamteam OpenCode model choices', () => {
  it('uses Dreamteam’s provider filter, names and exact launch IDs', () => {
    const models = readManagerOpenCodeModels(
      reply([
        'opencode/big-pickle',
        'ollama/local-model',
        'baseten/zai-org/GLM-5.2',
        'baseten-k3/moonshotai/Kimi-K3',
        'baseten/moonshotai/Kimi-K3',
        'baseten/deepseek-ai/DeepSeek-V4-Pro',
        'baseten/zai-org/GLM-5.2'
      ])
    )
    expect(models).toEqual([
      { id: 'baseten-k3/moonshotai/Kimi-K3', label: 'Kimi-K3 (baseten-k3)' },
      { id: 'baseten/deepseek-ai/DeepSeek-V4-Pro', label: 'DeepSeek-V4-Pro' },
      { id: 'baseten/moonshotai/Kimi-K3', label: 'Kimi-K3 (baseten)' },
      { id: 'baseten/zai-org/GLM-5.2', label: 'GLM-5.2' }
    ])
  })

  it('keeps an empty host list empty instead of seeding unverified models', () => {
    expect(readManagerOpenCodeModels(reply([]))).toEqual([])
    expect(readManagerOpenCodeModels(reply(['opencode/big-pickle']))).toEqual([])
  })

  it('rejects failed, fallback and legacy unverified replies', () => {
    expect(() =>
      readManagerOpenCodeModels({ success: false, error: 'OpenCode not installed' })
    ).toThrow('not installed')
    for (const catalogOrigin of ['spec', undefined, 'future-origin']) {
      expect(() =>
        readManagerOpenCodeModels({ ...reply(['baseten/a/model']), catalogOrigin })
      ).toThrow('did not return a live')
    }
  })

  it('excludes malformed IDs and disambiguates identical tails from one provider', () => {
    const models = readManagerOpenCodeModels(
      reply([
        'baseten/',
        'baseten/invalid;',
        'baseten/model\tbad',
        `baseten-${'x'.repeat(201)}/model`,
        'baseten/a/model',
        'baseten/b/model'
      ])
    )
    expect(models).toEqual([
      { id: 'baseten/a/model', label: 'baseten/a/model' },
      { id: 'baseten/b/model', label: 'baseten/b/model' }
    ])
  })
})
