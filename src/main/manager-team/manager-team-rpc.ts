import { join } from 'node:path'
import { z } from 'zod'
import { defineMethod, type RpcContext } from '../runtime/rpc/core'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import {
  managerTeamPrepareSchema,
  managerTeamModelsSchema,
  managerTeamRunSchema,
  type ManagerTeamRun
} from '../../shared/manager-team-contract'
import { callManager, resolveManagerAssets } from './manager-team-process'
import { discoverFolderOpenCodeModels } from './manager-team-model-discovery'

async function resolveScope(params: Pick<ManagerTeamRun, 'worktreeId'>, { runtime }: RpcContext) {
  const scope = await runtime.showTerminalWorkspaceLaunchScope(`id:${params.worktreeId}`)
  if (scope.id === FLOATING_TERMINAL_WORKTREE_ID || (!scope.repo && !scope.folderWorkspace)) {
    throw new Error('Open a folder workspace or Git worktree before creating a team.')
  }
  const host = scope.folderWorkspace?.executionHostId ?? scope.repo?.executionHostId
  if (scope.connectionId || (host && host !== 'local')) {
    throw new Error(
      'Create this team through the paired Orca runtime on its execution host. Direct SSH teams are not supported; no local fallback was attempted.'
    )
  }
  return scope
}

const preparedSchema = z.object({ run: z.string(), report: z.string() })
const shownSchema = z.object({
  report: z.string(),
  launch: z
    .object({ stage: z.string(), terminal: z.string().optional(), error: z.string().optional() })
    .nullable()
})

export const MANAGER_TEAM_METHODS = [
  defineMethod({
    name: 'managerTeam.models',
    params: managerTeamModelsSchema,
    handler: async (params, context) => {
      const scope = await resolveScope(params, context)
      return scope.folderWorkspace
        ? discoverFolderOpenCodeModels(
            scope.path,
            context.runtime.getClientSettings().agentCmdOverrides?.opencode
          )
        : context.runtime.discoverRuntimeCommitMessageModels(`id:${scope.id}`, 'opencode')
    }
  }),
  defineMethod({
    name: 'managerTeam.prepare',
    params: managerTeamPrepareSchema,
    handler: async (params, context) => {
      const { path: workspace } = await resolveScope(params, context)
      const { publisher, orca } = await resolveManagerAssets()
      const prepared = preparedSchema.parse(
        await callManager(publisher, workspace, [
          'prepare',
          '--workspace',
          workspace,
          '--orca',
          orca,
          '--request-id',
          params.requestId,
          '--team',
          JSON.stringify(params.team),
          '--workspace-id',
          params.worktreeId,
          '--runtime-id',
          context.runtime.getRuntimeId(),
          '--publisher-node',
          'node'
        ])
      )
      return { ...prepared, stage: 'prepared' }
    }
  }),
  defineMethod({
    name: 'managerTeam.launch',
    params: managerTeamRunSchema,
    handler: async (params, context) => {
      const { path: workspace } = await resolveScope(params, context)
      const run = join(workspace, '.orca-manager', 'runs', params.requestId)
      const { publisher } = await resolveManagerAssets()
      await callManager(publisher, workspace, ['launch', '--run', run])
      return readReceipt(publisher, workspace, run)
    }
  }),
  defineMethod({
    name: 'managerTeam.inspect',
    params: managerTeamRunSchema,
    handler: async (params, context) => {
      const { path: workspace } = await resolveScope(params, context)
      const run = join(workspace, '.orca-manager', 'runs', params.requestId)
      const { publisher } = await resolveManagerAssets()
      return readReceipt(publisher, workspace, run)
    }
  })
]

async function readReceipt(publisher: string, workspace: string, run: string) {
  const receipt = shownSchema.parse(await callManager(publisher, workspace, ['show', '--run', run]))
  return { run, report: receipt.report, stage: 'prepared', ...receipt.launch }
}
