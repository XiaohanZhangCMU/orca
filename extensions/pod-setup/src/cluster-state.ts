import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { ClusterConfig } from './cluster-config'
import { podPlanSchema } from './pod-packet'
import { kubectl } from './cluster-process'

export const receiptSchema = z.object({
  config: z.unknown(),
  plan: podPlanSchema,
  pvcUid: z.string().optional(),
  deploymentUid: z.string().optional(),
  runDirectory: z.string().optional()
})
export type ClusterReceipt = z.infer<typeof receiptSchema>
export function stateDirectory(config: ClusterConfig) {
  return join(homedir(), '.local/state/orca-pods', config.name)
}
export function readReceipt(config: ClusterConfig): ClusterReceipt | null {
  const file = join(stateDirectory(config), 'receipt.json')
  if (!existsSync(file)) {
    return null
  }
  const receipt = receiptSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  if (JSON.stringify(receipt.config) !== JSON.stringify(config)) {
    throw new Error('Configuration differs from the existing receipt; use a new workload name')
  }
  return receipt
}
export function writeReceipt(config: ClusterConfig, receipt: ClusterReceipt) {
  const directory = stateDirectory(config)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (lstatSync(directory).isSymbolicLink()) {
    throw new Error('Unsafe local receipt directory')
  }
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
}
export async function ownedObject(
  config: ClusterConfig,
  kind: string,
  name: string,
  instance: string,
  uid?: string
) {
  const text = await kubectl(config, ['get', kind, name, '--ignore-not-found', '-o', 'json'])
  if (!text.trim()) {
    if (uid) {
      throw new Error(`Previously recorded ${kind} is absent; refusing automatic recreation`)
    }
    return null
  }
  const object = z
    .object({
      metadata: z.object({
        uid: z.string(),
        labels: z.record(z.string(), z.string()).optional(),
        annotations: z.record(z.string(), z.string()).optional()
      }),
      spec: z.object({ replicas: z.number().optional() }).optional()
    })
    .parse(JSON.parse(text))
  if (
    !uid ||
    object.metadata.uid !== uid ||
    object.metadata.labels?.['orca.dev/instance'] !== instance
  ) {
    throw new Error(`Refusing existing ${kind}/${name} without matching ownership receipt`)
  }
  return object
}
export async function runningPod(
  config: ClusterConfig,
  receipt: ClusterReceipt
): Promise<string | null> {
  const deployment = await ownedObject(
    config,
    'deployment',
    config.name,
    receipt.plan.instance,
    receipt.deploymentUid
  )
  if (deployment?.spec?.replicas === 0) {
    return null
  }
  const result = z
    .object({
      items: z.array(
        z.object({
          metadata: z.object({ name: z.string(), deletionTimestamp: z.string().optional() }),
          status: z
            .object({
              phase: z.string().optional(),
              containerStatuses: z
                .array(
                  z.object({
                    name: z.string(),
                    state: z.object({ running: z.unknown().optional() })
                  })
                )
                .optional()
            })
            .optional()
        })
      )
    })
    .parse(
      JSON.parse(
        await kubectl(config, [
          'get',
          'pods',
          '-l',
          `orca.dev/instance=${receipt.plan.instance}`,
          '-o',
          'json'
        ])
      )
    )
  const pods = result.items.filter((pod) => !pod.metadata.deletionTimestamp)
  if (pods.length > 1) {
    throw new Error('Multiple matching pods; refusing to choose an execution host')
  }
  return pods[0]?.status?.containerStatuses?.some(
    (container) => container.name === 'orca' && container.state.running
  )
    ? pods[0].metadata.name
    : null
}
