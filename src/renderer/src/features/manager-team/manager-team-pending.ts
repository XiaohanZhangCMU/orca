import { z } from 'zod'
import {
  managerTeamRunSchema,
  managerTeamDefinitionSchema
} from '../../../../shared/manager-team-contract'

const pendingSchema = z.object({
  run: managerTeamRunSchema,
  team: managerTeamDefinitionSchema,
  host: z.object({
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('local') }),
      z.object({ kind: z.literal('environment'), environmentId: z.string() })
    ]),
    label: z.string(),
    pairingRevision: z.number().optional()
  })
})
export type PendingManagerTeam = z.infer<typeof pendingSchema>
const key = (worktreeId: string) => `orca.manager-team.pending.v1:${worktreeId}`

export function readPendingTeam(worktreeId: string): PendingManagerTeam | null {
  const raw = localStorage.getItem(key(worktreeId))
  return raw ? pendingSchema.parse(JSON.parse(raw)) : null
}

export function savePendingTeam(pending: PendingManagerTeam): void {
  localStorage.setItem(key(pending.run.worktreeId), JSON.stringify(pending))
}

export function clearPendingTeam(worktreeId: string): void {
  localStorage.removeItem(key(worktreeId))
}
