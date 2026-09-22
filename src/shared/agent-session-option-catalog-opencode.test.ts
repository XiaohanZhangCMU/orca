import { describe, expect, it } from 'vitest'
import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import {
  removeOverriddenAgentSessionArgs,
  resolveAgentSessionOptionLaunch
} from './agent-session-option-launch'

describe('OpenCode model launch catalog', () => {
  it.each(['local-fixture/model:latest', 'hosted-fixture/org/model-Q4_K_M'])(
    'passes an opaque provider/model ID unchanged: %s',
    (model) => {
      expect(resolveAgentSessionOptionLaunch('opencode', { model })).toEqual({
        args: ['--model', model],
        appliedValues: { model }
      })
    }
  )

  it('does not pin a model or change permissions when using the host default', () => {
    expect(getAgentSessionOptionCatalog('opencode')?.models).toEqual([])
    expect(resolveAgentSessionOptionLaunch('opencode', {})).toEqual({ args: [], appliedValues: {} })
  })

  it.each([['--model', 'old/model'], ['--model=old/model'], ['-m', 'old/model'], ['-mold/model']])(
    'removes conflicting model defaults from %j',
    (...tokens) => {
      expect(
        removeOverriddenAgentSessionArgs('opencode', { model: 'new/model' }, [
          '--port',
          '1234',
          ...tokens,
          '--',
          '--model',
          'prompt-text'
        ])
      ).toEqual(['--port', '1234', '--', '--model', 'prompt-text'])
      expect(
        resolveAgentSessionOptionLaunch('opencode', { model: 'new/model' }, tokens).appliedValues
      ).toEqual({})
    }
  )
})
