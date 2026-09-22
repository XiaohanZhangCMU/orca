import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { discoverModelsLocal } from '../text-generation/commit-message-model-discovery'

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  discover: vi.fn<typeof discoverModelsLocal>(),
  spawn: vi.fn()
}))
vi.mock('../text-generation/commit-message-agent-environment', () => ({
  prepareLocalCommitMessageAgentEnv: mocks.environment
}))
vi.mock('../text-generation/commit-message-model-discovery', () => ({
  discoverModelsLocal: mocks.discover
}))
vi.mock('../text-generation/source-control-agent-launch', () => ({
  spawnSourceControlAgent: mocks.spawn
}))

import { discoverFolderOpenCodeModels } from './manager-team-model-discovery'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.environment.mockResolvedValue({ ok: true, env: { PATH: 'fixture' } })
  mocks.discover.mockResolvedValue({ success: false, error: 'Fixture' })
})

describe('folder OpenCode model discovery', () => {
  it('reuses bounded discovery with the host’s override, environment and folder cwd', async () => {
    await discoverFolderOpenCodeModels('/host/folder', 'ocskip', 'linux')
    expect(mocks.environment).toHaveBeenCalledExactlyOnceWith('opencode', undefined, {
      runtime: 'host'
    })
    expect(mocks.discover).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        agentId: 'opencode',
        env: { PATH: 'fixture' },
        agentCommandOverride: 'ocskip',
        options: { cwd: '/host/folder', wslDistro: undefined }
      })
    )
    mocks.discover.mock.calls[0][0].spawnAgent({
      binary: 'ocskip',
      args: ['models'],
      cwd: '/host/folder',
      stdinMode: 'ignore',
      useCwdForNative: false
    })
    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith({
      binary: 'ocskip',
      args: ['models'],
      cwd: '/host/folder',
      stdinMode: 'ignore',
      useCwdForNative: true
    })
  })

  it('keeps WSL discovery in the named distro, never the native Windows CLI', async () => {
    const cwd = '\\\\wsl.localhost\\Ubuntu\\home\\workspace'
    await discoverFolderOpenCodeModels(cwd, undefined, 'win32')
    expect(mocks.environment).toHaveBeenCalledWith('opencode', undefined, {
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({ options: { cwd, wslDistro: 'Ubuntu' } })
    )
  })

  it('does not treat a POSIX directory named wsl$ as a Windows distro', async () => {
    await discoverFolderOpenCodeModels('//wsl$/Ubuntu/workspace', undefined, 'linux')
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({ options: { cwd: '//wsl$/Ubuntu/workspace', wslDistro: undefined } })
    )
  })

  it('does not probe after environment preparation fails', async () => {
    mocks.environment.mockResolvedValue({ ok: false, error: 'Unavailable host environment' })
    expect(await discoverFolderOpenCodeModels('/host/folder')).toEqual({
      success: false,
      error: 'Unavailable host environment'
    })
    expect(mocks.discover).not.toHaveBeenCalled()
  })
})
