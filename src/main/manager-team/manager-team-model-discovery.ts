import { parseWslUncPath } from '../../shared/wsl-paths'
import { prepareLocalCommitMessageAgentEnv } from '../text-generation/commit-message-agent-environment'
import { discoverModelsLocal } from '../text-generation/commit-message-model-discovery'
import { commandBackslashMode } from '../text-generation/commit-message-text-generation'
import { spawnSourceControlAgent } from '../text-generation/source-control-agent-launch'

export async function discoverFolderOpenCodeModels(
  workspace: string,
  agentCommandOverride?: string,
  platform: NodeJS.Platform = process.platform
) {
  const wslDistro = platform === 'win32' ? parseWslUncPath(workspace)?.distro : undefined
  const environment = await prepareLocalCommitMessageAgentEnv(
    'opencode',
    undefined,
    wslDistro ? { runtime: 'wsl', wslDistro } : { runtime: 'host' }
  )
  if (!environment.ok) {
    return { success: false as const, error: environment.error }
  }
  return discoverModelsLocal({
    agentId: 'opencode',
    env: environment.env,
    agentCommandOverride,
    options: { cwd: workspace, wslDistro },
    backslash: commandBackslashMode({ kind: 'local', cwd: workspace, wslDistro }, platform),
    // Folder-local OpenCode configuration must be read on its owning host.
    spawnAgent: (input) => spawnSourceControlAgent({ ...input, useCwdForNative: true })
  })
}
