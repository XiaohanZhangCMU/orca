import { beforeEach, expect, it, vi } from 'vitest'
import { clusterConfigSchema } from '../src/cluster-config'
import { releaseHost, releasePatch } from '../src/desktop-release'

const mocks = vi.hoisted(() => ({ kube: vi.fn(), owned: vi.fn(), host: vi.fn(), read: vi.fn() }))
vi.mock('../src/cluster-process', () => ({ kubectl: mocks.kube }))
vi.mock('../src/cluster-state', () => ({ ownedObject: mocks.owned }))
vi.mock('../src/desktop-inventory', () => ({ registeredHost: mocks.host }))
vi.mock('node:fs', () => ({ readFileSync: mocks.read }))
const instance = 'd98da145-8f28-481f-82ce-5dd5c095fa80'
const config = clusterConfigSchema.parse({ name: 'orca-test' })
const deployment = {
  metadata: {
    uid: 'deployment-uid',
    resourceVersion: 'version-12',
    labels: { 'orca.dev/instance': instance },
    annotations: { existing: 'keep' }
  },
  spec: { replicas: 1 }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.host.mockReturnValue({
    config,
    receipt: {
      plan: { instance },
      deploymentUid: 'deployment-uid',
      pvcUid: 'pvc-uid',
      runDirectory: '/fixture/run'
    }
  })
  mocks.read.mockReturnValue(instance)
  mocks.kube.mockResolvedValue(JSON.stringify(deployment))
})

it('requires an exact typed name and the displayed installer instance', async () => {
  await expect(releaseHost('orca-test', instance, 'orca-other')).rejects.toThrow('exact host name')
  await expect(releaseHost('orca-test', 'different-instance', 'orca-test')).rejects.toThrow(
    'ownership'
  )
  expect(mocks.kube).not.toHaveBeenCalled()
})
it('requires canonical run attribution before contacting the cluster', async () => {
  mocks.read.mockReturnValue('unrelated run')
  await expect(releaseHost('orca-test', instance, 'orca-test')).rejects.toThrow('attribution')
  expect(mocks.kube).not.toHaveBeenCalled()
})
it('scales only the recorded deployment to zero and never deletes the disk', async () => {
  await releaseHost('orca-test', instance, 'orca-test')
  expect(mocks.owned).toHaveBeenCalledWith(config, 'pvc', 'orca-test-home', instance, 'pvc-uid')
  expect(mocks.kube).toHaveBeenCalledTimes(2)
  const args = mocks.kube.mock.calls[1][1]
  expect(args.slice(0, 5)).toEqual(['patch', 'deployment', 'orca-test', '--type=json', '-p'])
  expect(JSON.parse(args[5])).toEqual(
    expect.arrayContaining([
      { op: 'replace', path: '/spec/replicas', value: 0 },
      {
        op: 'add',
        path: '/metadata/annotations',
        value: { existing: 'keep', 'orca.dev/released-at': expect.any(String) }
      }
    ])
  )
  expect(args.join(' ')).not.toContain('delete')
})
it('fences the mutation against UID, instance, and concurrent resource changes', () => {
  const patch = releasePatch(deployment, 'deployment-uid', instance)
  expect(patch.slice(0, 3)).toEqual([
    { op: 'test', path: '/metadata/uid', value: 'deployment-uid' },
    { op: 'test', path: '/metadata/resourceVersion', value: 'version-12' },
    { op: 'test', path: '/metadata/labels/orca.dev~1instance', value: instance }
  ])
  expect(() => releasePatch(deployment, 'replaced-uid', instance)).toThrow('ownership changed')
  expect(() => releasePatch(deployment, 'deployment-uid', 'different-instance')).toThrow(
    'ownership changed'
  )
})
it('does not mutate when disk ownership or deployment identity is unverifiable', async () => {
  mocks.owned.mockRejectedValueOnce(new Error('Unverifiable PVC'))
  await expect(releaseHost('orca-test', instance, 'orca-test')).rejects.toThrow('Unverifiable PVC')
  expect(mocks.kube).not.toHaveBeenCalled()
  mocks.kube.mockResolvedValueOnce(
    JSON.stringify({ ...deployment, metadata: { ...deployment.metadata, uid: 'replaced' } })
  )
  await expect(releaseHost('orca-test', instance, 'orca-test')).rejects.toThrow('ownership changed')
  expect(mocks.kube).toHaveBeenCalledTimes(1)
})
