import { z } from 'zod'

export const repositorySchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]+$/),
  slug: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  branch: z.string().min(1)
})
export const downloadSchema = z.object({
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  member: z.string().optional()
})
export const podPlanSchema = z.object({
  instance: z.string().uuid(),
  name: z.string(),
  repositories: z.array(repositorySchema),
  source: z.object({
    commit: z.string(),
    branch: z.string(),
    patch: z.string(),
    files: z.record(z.string(), z.string()),
    digest: z.string()
  }),
  packageManager: z.string().regex(/^pnpm@\d+\.\d+\.\d+$/),
  openCodeConfig: z.string(),
  gitIdentity: z.object({ name: z.string(), email: z.string() }),
  kubeconfigName: z.string().regex(/^[\w-]+\.yaml$/),
  allowUnverified: z.array(z.string()),
  tools: z.object({
    npm: z.array(z.string()),
    downloads: z.record(z.string(), downloadSchema),
    python: z.array(z.string())
  })
})
export const podPacketSchema = podPlanSchema.extend({
  files: z.record(z.string(), z.string()),
  env: z.record(z.string(), z.string()),
  bootstrap: z.string(),
  services: z.string(),
  verifier: z.string(),
  storageProbe: z.string(),
  controller: z.string()
})
export type PodPacket = z.infer<typeof podPacketSchema>
export type PodPlan = z.infer<typeof podPlanSchema>
