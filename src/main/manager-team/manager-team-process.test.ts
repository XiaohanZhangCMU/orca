import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({ run: vi.fn(), access: vi.fn(), appPath: '/source' }))
vi.mock('node:fs/promises', () => ({ access: mocks.access }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.run }))
vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({
    getAppPath: () => mocks.appPath,
    getPath: () => '/exact-profile'
  })
}))
import { callManager, resolveManagerAssets } from './manager-team-process'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.appPath = '/source'
})

describe('manager process boundary', () => {
  it.each(['/source', '/app/app.asar'])(
    'resolves source and unpacked packaged assets: %s',
    async (appPath) => {
      mocks.appPath = appPath
      mocks.access.mockResolvedValue(undefined)
      expect(await resolveManagerAssets()).toEqual({
        publisher: join(
          appPath.replace(/\.asar$/, '.asar.unpacked'),
          'out',
          'manager',
          'orca-manager.cjs'
        ),
        orca: join(appPath.replace(/\.asar$/, '.asar.unpacked'), 'out', 'manager', 'orca.cjs')
      })
    }
  )

  it('resolves a self-contained orcad deployment without a source tree', async () => {
    mocks.appPath = '/deployment'
    mocks.access.mockImplementation(async (path: string) => {
      if (path.includes(join('out', 'manager'))) {
        throw new Error('Missing')
      }
    })
    expect((await resolveManagerAssets()).publisher).toBe(
      join('/deployment', 'manager', 'orca-manager.cjs')
    )
  })

  it('pins the exact profile, clears remote selection, and uses argv without a shell', async () => {
    vi.stubEnv('ORCA_ENVIRONMENT', 'different-host')
    vi.stubEnv('ORCA_PAIRING_CODE', 'private-fixture')
    mocks.run.mockResolvedValue({ code: 0, stdout: '{"stage":"prepared"}', stderr: '' })
    try {
      expect(
        await callManager('/manager.cjs', '/workspace', [
          'prepare',
          '--goal',
          'text; not a shell command'
        ])
      ).toEqual({ stage: 'prepared' })
      const options = mocks.run.mock.calls[0][0]
      expect(options.program).toBe(process.execPath)
      expect(options.args).toEqual([
        '/manager.cjs',
        'prepare',
        '--goal',
        'text; not a shell command'
      ])
      expect(options.env.ORCA_USER_DATA_PATH).toBe('/exact-profile')
      expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1')
      expect(options.env.ORCA_BACKGROUND_LAUNCH).toBe('1')
      expect(options.env.ORCA_ENVIRONMENT).toBeUndefined()
      expect(options.env.ORCA_PAIRING_CODE).toBeUndefined()
      expect(options.shell).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('treats timeout as unverifiable without retrying', async () => {
    mocks.run.mockResolvedValue({ code: null, timedOut: true, stdout: '', stderr: '' })
    await expect(callManager('/manager.cjs', '/workspace', ['launch'])).rejects.toThrow(
      'unverifiable'
    )
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })
})
