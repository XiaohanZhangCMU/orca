import { z } from 'zod'

export const managerProviderSchema = z.enum(['codex', 'claude'])
export const workerProviderSchema = z.enum(['codex', 'claude', 'cursor', 'opencode'])
export const managerWorkerSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    provider: workerProviderSchema,
    model: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/)
      .optional()
  })
  .refine(
    (worker) => worker.provider !== 'opencode' || !worker.model || /^[^/]+\/.+$/.test(worker.model),
    { path: ['model'], message: 'OpenCode model IDs must use provider/model format.' }
  )

export const managerTeamDefinitionSchema = z
  .object({
    objective: z.string().trim().min(1).max(20_000),
    manager: managerProviderSchema,
    workers: z.array(managerWorkerSchema).min(1).max(8)
  })
  .refine(
    (team) => new Set(team.workers.map((worker) => worker.name)).size === team.workers.length,
    {
      message: 'Give each worker a distinct name.'
    }
  )

export const managerTeamModelsSchema = z.object({ worktreeId: z.string().min(1) })
export const managerTeamRunSchema = managerTeamModelsSchema.extend({
  requestId: z.uuid()
})
export const managerTeamPrepareSchema = managerTeamRunSchema.extend({
  team: managerTeamDefinitionSchema
})

// Newer hosts may add stages; only prompt-accepted grants a successful-submission UI.
export const managerTeamReceiptSchema = z.object({
  run: z.string().min(1),
  report: z.string().min(1),
  stage: z.string(),
  terminal: z.string().optional(),
  error: z.string().optional()
})

export type ManagerTeamDefinition = z.infer<typeof managerTeamDefinitionSchema>
export type ManagerWorker = z.infer<typeof managerWorkerSchema>
export type ManagerTeamRun = z.infer<typeof managerTeamRunSchema>
export type ManagerTeamReceipt = z.infer<typeof managerTeamReceiptSchema>
