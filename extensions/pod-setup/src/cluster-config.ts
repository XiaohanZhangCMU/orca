import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { z } from 'zod'

const dnsName = z.string().regex(/^[a-z][a-z0-9-]{1,50}[a-z0-9]$/)
export const clusterConfigSchema = z
  .object({
    name: dnsName.default('xiaohan-orca-cpu'),
    namespace: dnsName.default('ori-rcano-testing'),
    kubeconfig: z.string().default('~/.kube/ori-dfw-prod-1-token.yaml'),
    kubectl: z.string().default('kubectl'),
    dreamteam: z.string().default('~/Codes/dreamteam'),
    source: z.string().default('.'),
    image: z
      .string()
      .regex(/^node:24[\w.-]*-bookworm@sha256:[a-f0-9]{64}$/)
      .default(
        'node:24-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4'
      ),
    storageClass: z.string().default('storageclass-wekafs-fs-api'),
    storage: z
      .string()
      .regex(/^\d+Gi$/)
      .default('250Gi'),
    persistent: z.boolean().default(true),
    cpuRequest: z
      .string()
      .regex(/^\d+(?:m)?$/)
      .default('2'),
    memoryRequest: z
      .string()
      .regex(/^\d+Gi$/)
      .default('8Gi'),
    cpuLimit: z.string().regex(/^\d+$/).default('16'),
    memoryLimit: z
      .string()
      .regex(/^\d+Gi$/)
      .default('96Gi'),
    promptFile: z.string().optional(),
    allowUnverified: z.array(z.string()).default([])
  })
  .strict()

export type ClusterConfig = z.infer<typeof clusterConfigSchema>
export function expandLocalPath(path: string): string {
  return resolve(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
}
export function readClusterConfig(file?: string): ClusterConfig {
  const config = clusterConfigSchema.parse(file ? JSON.parse(readFileSync(file, 'utf8')) : {})
  for (const key of ['kubeconfig', 'dreamteam', 'source'] as const) {
    config[key] = expandLocalPath(config[key])
  }
  if (config.promptFile) {
    config.promptFile = expandLocalPath(config.promptFile)
  }
  return config
}

export type RepositoryPlan = { name: string; slug: string; commit?: string; branch?: string }
export function dreamteamRepositories(source: string): RepositoryPlan[] {
  const block = source.match(/^REPOS: dict\[str, str\] = \{([\s\S]*?)^\}/m)?.[1]
  if (!block) {
    throw new Error('Dreamteam repository catalog was not recognized')
  }
  const repos = [
    ...block.matchAll(/^\s*'([A-Za-z0-9_-]+)': '([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)',?\s*$/gm)
  ].map((match) => ({ name: match[1], slug: match[2] }))
  if (
    !repos.length ||
    repos.length > 30 ||
    new Set(repos.map((repo) => repo.name)).size !== repos.length
  ) {
    throw new Error('Invalid Dreamteam repository catalog')
  }
  return [
    ...repos.filter((repo) => repo.name !== 'orca'),
    { name: 'orca', slug: 'XiaohanZhangCMU/orca' }
  ]
}
