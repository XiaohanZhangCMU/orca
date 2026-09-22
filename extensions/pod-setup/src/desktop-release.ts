import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { kubectl } from './cluster-process'
import { ownedObject } from './cluster-state'
import { registeredHost } from './desktop-inventory'

export const releaseAnnotation = 'orca.dev/released-at'
export const deploymentReleaseSchema = z.object({
  metadata: z.object({
    uid: z.string(),
    resourceVersion: z.string(),
    labels: z.record(z.string(), z.string()),
    annotations: z.record(z.string(), z.string()).optional()
  }),
  spec: z.object({ replicas: z.number().int().nonnegative() })
})

export function releasePatch(
  deployment: z.infer<typeof deploymentReleaseSchema>,
  uid: string,
  instance: string
) {
  if (
    deployment.metadata.uid !== uid ||
    deployment.metadata.labels['orca.dev/instance'] !== instance
  ) {
    throw new Error('Host ownership changed. Nothing was released.')
  }
  return [
    { op: 'test', path: '/metadata/uid', value: uid },
    { op: 'test', path: '/metadata/resourceVersion', value: deployment.metadata.resourceVersion },
    { op: 'test', path: '/metadata/labels/orca.dev~1instance', value: instance },
    { op: 'replace', path: '/spec/replicas', value: 0 },
    {
      op: 'add',
      path: '/metadata/annotations',
      value: { ...deployment.metadata.annotations, [releaseAnnotation]: new Date().toISOString() }
    }
  ]
}

export async function releaseHost(name: string, instance: string, confirmation: string) {
  if (confirmation !== name) {
    throw new Error('Type the exact host name to release it.')
  }
  const { config, receipt } = registeredHost(name)
  if (receipt.plan.instance !== instance || !receipt.deploymentUid || !receipt.runDirectory) {
    throw new Error('No matching installer ownership and run receipt. Nothing was released.')
  }
  const ledger = readFileSync(join(homedir(), 'runs/JOBS.md'), 'utf8')
  const readme = readFileSync(join(receipt.runDirectory, 'README.md'), 'utf8')
  const prompt = readFileSync(join(receipt.runDirectory, 'prompt.txt'), 'utf8')
  if (!ledger.includes(instance) || !readme.includes(instance) || !prompt.trim()) {
    throw new Error('Run attribution is unverifiable. Nothing was released.')
  }
  if (config.persistent) {
    await ownedObject(config, 'pvc', `${name}-home`, instance, receipt.pvcUid)
  }
  const deployment = deploymentReleaseSchema.parse(
    JSON.parse(await kubectl(config, ['get', 'deployment', name, '-o', 'json']))
  )
  // Atomic identity/version tests prevent a replacement deployment from being stopped.
  await kubectl(config, [
    'patch',
    'deployment',
    name,
    '--type=json',
    '-p',
    JSON.stringify(releasePatch(deployment, receipt.deploymentUid, instance))
  ])
}
