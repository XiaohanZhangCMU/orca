import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as NodeOs from 'node:os'
import { clusterConfigSchema } from '../src/cluster-config'
import { writeReceipt, stateDirectory } from '../src/cluster-state'
import { inventory, registrations } from '../src/desktop-inventory'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../../src/shared/pairing'

const mocks = vi.hoisted(() => ({
  home: '',
  kube: vi.fn(),
  saved: vi.fn(),
  legacy: vi.fn(),
  access: vi.fn()
}))
vi.mock('node:os', async (original) => ({
  ...(await original<typeof NodeOs>()),
  homedir: () => mocks.home
}))
vi.mock('../src/cluster-process', () => ({ kubectl: mocks.kube }))
vi.mock('../src/desktop-legacy-hosts', () => ({
  savedHosts: mocks.saved,
  legacyHost: mocks.legacy,
  savedAccess: mocks.access
}))
const instance = 'd98da145-8f28-481f-82ce-5dd5c095fa80'
let stopped = false
let podsPresent = true
function receipt(name: string) {
  const config = clusterConfigSchema.parse({ name })
  writeReceipt(config, {
    config,
    deploymentUid: 'deployment-uid',
    plan: {
      instance,
      name,
      repositories: [],
      source: { commit: '', branch: '', patch: '', files: {}, digest: '' },
      packageManager: 'pnpm@12.0.0',
      openCodeConfig: '',
      gitIdentity: { name: '', email: '' },
      kubeconfigName: 'fixture.yaml',
      allowUnverified: [],
      tools: { npm: [], downloads: {}, python: [] }
    }
  })
  return config
}
beforeEach(() => {
  mocks.home = mkdtempSync(join(tmpdir(), 'orca-inventory-test-'))
  stopped = false
  podsPresent = true
  vi.clearAllMocks()
  mocks.saved.mockReturnValue([])
  mocks.access.mockImplementation(() => {
    throw new Error('No saved link')
  })
  mocks.kube.mockImplementation(async (_config, args: string[]) => {
    if (args[0] === 'get' && args[1] === 'deployment') {
      return JSON.stringify({
        metadata: {
          uid: 'deployment-uid',
          labels: { 'orca.dev/instance': instance },
          annotations: stopped ? { 'orca.dev/released-at': 'fixture-time' } : {}
        },
        spec: { replicas: stopped ? 0 : 1 }
      })
    }
    if (args[0] === 'get' && args[1] === 'pods') {
      return JSON.stringify({
        items: podsPresent
          ? [
              {
                metadata: { name: 'fixture-pod' },
                status: { containerStatuses: [{ name: 'orca', state: { running: {} } }] }
              }
            ]
          : []
      })
    }
    return JSON.stringify(
      args.includes('status')
        ? { runtimeId: 'runtime-id', ready: true }
        : { state: 'complete', phase: 'Ready' }
    )
  })
})
afterEach(() => rmSync(mocks.home, { recursive: true, force: true }))

it('does not let a partial progress file hide the host list', async () => {
  const config = receipt('orca-first')
  receipt('orca-second')
  writeFileSync(join(stateDirectory(config), 'ui-progress.json'), '{partial')
  expect((await inventory()).map((host) => host.state)).toEqual(['ready', 'ready'])
})
it('requires cluster evidence of pod absence before calling a release complete', async () => {
  receipt('orca-test')
  stopped = true
  expect(await inventory()).toMatchObject([{ state: 'releasing' }])
  podsPresent = false
  expect(await inventory()).toMatchObject([{ state: 'released' }])
  expect(mocks.kube.mock.calls.some(([, args]) => args[0] === 'exec')).toBe(false)
})
it('never interprets a cluster error as a completed release', async () => {
  receipt('orca-test')
  mocks.kube.mockRejectedValue(new Error('Cluster offline'))
  expect(await inventory()).toMatchObject([{ state: 'unverifiable' }])
})
it('merges legacy registrations without duplicating or downgrading managed hosts', async () => {
  receipt('orca-test')
  mocks.saved.mockReturnValue(['orca-test', 'legacy-host'])
  mocks.legacy.mockResolvedValue({
    name: 'legacy-host',
    management: 'legacy',
    state: 'unverifiable'
  })
  expect(await inventory()).toMatchObject([
    { name: 'legacy-host' },
    { name: 'orca-test', management: 'installer', instance }
  ])
  expect(mocks.legacy).toHaveBeenCalledTimes(1)
})

it('discovers stable registration keys locally without probing Kubernetes or returning grants', () => {
  receipt('orca-test')
  mocks.saved.mockReturnValue(['orca-test', 'legacy-host'])
  const publicKeyB64 = Buffer.alloc(32, 1).toString('base64')
  mocks.access.mockReturnValue(
    encodePairingOffer({
      v: PAIRING_OFFER_VERSION,
      scope: 'runtime',
      endpoint: 'ws://127.0.0.1:6770',
      publicKeyB64,
      deviceToken: 'never-return-this-grant'
    })
  )
  const rows = registrations('/fixture/source')
  expect(rows).toEqual([
    { name: 'orca-test', management: 'installer', instance, publicKeyB64 },
    { name: 'legacy-host', management: 'legacy', publicKeyB64 }
  ])
  expect(JSON.stringify(rows)).not.toContain('never-return-this-grant')
  expect(mocks.kube).not.toHaveBeenCalled()
})

it('retains a valid installer receipt without requiring a saved inventory link', () => {
  receipt('orca-test')
  expect(registrations('/fixture/source')).toEqual([
    { name: 'orca-test', management: 'installer', instance }
  ])
  expect(mocks.kube).not.toHaveBeenCalled()
})
