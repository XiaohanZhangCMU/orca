import { z } from 'zod'
import { managerWorkerSchema } from '../../../../shared/manager-team-contract'
import type { CatalogModel } from '../../../../shared/agent-session-option-catalog'

export type ManagerModelOption = Pick<CatalogModel, 'id' | 'label'>

const discoverySchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    models: z.array(z.object({ id: z.string() })),
    catalogOrigin: z.string().optional()
  }),
  z.object({ success: z.literal(false), error: z.string() })
])

export function readManagerOpenCodeModels(reply: unknown): ManagerModelOption[] {
  const result = discoverySchema.parse(reply)
  if (!result.success) {
    throw new Error(result.error)
  }
  if (result.catalogOrigin !== 'probe') {
    throw new Error(
      'This host did not return a live OpenCode model list. Update its Orca server and retry.'
    )
  }
  // Matches Dreamteam's worker/packages/terminal/src/tmux.ts modelsFor provider filter.
  const ids = [...new Set(result.models.map(({ id }) => id))]
    .filter((id) => /^(baseten|baseten-[a-z0-9]+)\//.test(id))
    .filter(
      (model) => managerWorkerSchema.safeParse({ name: 'IC', provider: 'opencode', model }).success
    )
    .sort()
  const tails = ids.map((id) => id.split('/').at(-1) ?? id)
  const tailCounts = new Map<string, number>()
  for (const tail of tails) {
    tailCounts.set(tail, (tailCounts.get(tail) ?? 0) + 1)
  }
  const labels = ids.map((id, index) =>
    (tailCounts.get(tails[index]) ?? 0) > 1 ? `${tails[index]} (${id.split('/')[0]})` : tails[index]
  )
  const labelCounts = new Map<string, number>()
  for (const label of labels) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }
  return ids.map((id, index) => ({
    id,
    label: (labelCounts.get(labels[index]) ?? 0) > 1 ? id : labels[index]
  }))
}
