import { z } from 'zod'
import { managerWorkerSchema } from '../../../src/shared/manager-team-contract'

export const agentSchema = z.enum(['codex', 'claude'])
const text = z.string().trim().min(1).max(20_000)
export const reportDraftSchema = z
  .object({
    status: z.enum(['planning', 'working', 'needs-input', 'completed', 'failed']),
    summary: text,
    tasks: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(300),
            outcome: z.enum([
              'planned',
              'working',
              'completed',
              'failed',
              'blocked',
              'unverifiable'
            ]),
            summary: text,
            taskId: z.string().max(200).optional(),
            dispatchId: z.string().max(200).optional(),
            evidence: z.array(z.string().max(2000)).max(30).default([])
          })
          .strict()
      )
      .max(100)
      .default([]),
    decisions: z.array(text).max(30).default([]),
    nextSteps: z.array(text).max(30).default([])
  })
  .strict()

export const sessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    workspace: z.string().min(1),
    objective: text,
    workers: z.number().int().min(1).max(8),
    managerAgent: agentSchema,
    workerAgent: agentSchema,
    workerProfiles: z.array(managerWorkerSchema).min(1).max(8).optional(),
    hostBinding: z
      .object({ workspaceId: z.string().min(1), runtimeId: z.string().min(1) })
      .optional(),
    publisherNode: z.string().min(1).optional(),
    orca: z.string().min(1),
    publisher: z.string().min(1)
  })
  .strict()
  .refine(
    (session) => !session.workerProfiles || session.workerProfiles.length === session.workers,
    {
      message: 'Worker count must match the configured roster.'
    }
  )

export const reportVersionSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    publishedAt: z.iso.datetime(),
    report: reportDraftSchema
  })
  .strict()

export type ManagerSession = z.infer<typeof sessionSchema>
export type ReportDraft = z.infer<typeof reportDraftSchema>
export type ReportVersion = z.infer<typeof reportVersionSchema>
