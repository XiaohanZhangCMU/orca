import { hasFlag } from './agent-cli-flag-detection'
import { removeAgentArgOption } from './agent-session-option-agent-args'
import type { AgentSessionOptionCatalog } from './agent-session-option-catalog-types'

export const OPENCODE_SESSION_OPTION_CATALOG: AgentSessionOptionCatalog = {
  supportsWorkerLaunchPreferences: true,
  // Provider/model IDs belong to the execution host's OpenCode configuration, not a static list.
  models: [],
  modelApply: {
    launchArgs: (value) => ['--model', String(value)],
    agentArgsOverride: (tokens) => hasFlag(tokens, ['-m', '--model']),
    removeAgentArgs: (tokens) => removeAgentArgOption(tokens, ['-m', '--model'])
  }
}
