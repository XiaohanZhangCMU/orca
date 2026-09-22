import { open, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { loadSession } from './report-store'
import type { ManagerSession } from './contracts'
import { atomicWrite, readJson } from './scoped-files'
import { OrcaCommandError, type OrcaCall } from './orca-process'

const statusSchema = z.object({
  target: z.object({ kind: z.literal('local') }),
  runtime: z.object({
    reachable: z.literal(true),
    runtimeId: z.string().min(1),
    capabilities: z.array(z.string()).optional()
  })
})
const workspaceSchema = z.object({
  worktree: z.object({
    id: z.string().min(1),
    repoId: z.string().min(1),
    path: z.string(),
    hostId: z.string().nullish(),
    runtimeOwnerEnvironmentId: z.string().nullish()
  })
})
const repoSchema = z.object({
  repo: z.object({ connectionId: z.string().nullish(), executionHostId: z.string().nullish() })
})
const terminalSchema = z.object({
  terminal: z.object({
    handle: z.string().min(1),
    worktreeId: z.string().min(1),
    executionHostId: z.string().optional()
  })
})
const waitSchema = z.object({ wait: z.object({ satisfied: z.literal(true) }) })
const launchedSchema = z.object({
  terminal: z.string().min(1),
  runtimeId: z.string().min(1),
  workspaceId: z.string().min(1)
})
const sendSchema = z.object({
  send: z.object({
    handle: z.string(),
    accepted: z.literal(true),
    prompt: z.object({ stages: z.array(z.string()) })
  })
})

function verifySubmission(receipt: unknown, terminal: string): void {
  const result = sendSchema.safeParse(receipt)
  if (!result.success || result.data.send.handle !== terminal) {
    throw new OrcaCommandError(
      'Prompt acceptance is unverifiable. Inspect the receipt before retrying.',
      receipt
    )
  }
}

export async function verifyLocalWorkspace(
  call: OrcaCall,
  workspace: string,
  hostBinding?: ManagerSession['hostBinding']
): Promise<{ runtimeId: string; workspaceId: string }> {
  const status = statusSchema.safeParse(await call(['status']))
  if (!status.success) {
    throw new Error(
      'Run this command on the execution host, connected to its local Orca runtime. Remote/default environments are not supported by the launcher.'
    )
  }
  if (
    !['terminal.prompt-delivery.v1', 'orchestration.contract.v1'].every((capability) =>
      status.data.runtime.capabilities?.includes(capability)
    )
  ) {
    throw new Error(
      'Update the execution host: verified prompt delivery and orchestration contracts are required. No terminal was created.'
    )
  }
  if (hostBinding) {
    if (status.data.runtime.runtimeId !== hostBinding.runtimeId) {
      throw new Error('The owning runtime changed. Inspect this run before launching.')
    }
    return { runtimeId: hostBinding.runtimeId, workspaceId: hostBinding.workspaceId }
  }
  const { worktree } = workspaceSchema.parse(
    await call(['worktree', 'show', '--worktree', `path:${workspace}`])
  )
  const { repo } = repoSchema.parse(await call(['repo', 'show', '--repo', `id:${worktree.repoId}`]))
  if (
    worktree.runtimeOwnerEnvironmentId ||
    (worktree.hostId && worktree.hostId !== 'local') ||
    repo.connectionId ||
    (repo.executionHostId && repo.executionHostId !== 'local')
  ) {
    throw new Error(
      'This workspace is owned by another host. Run the manager command on that host; no local fallback was attempted.'
    )
  }
  if ((await realpath(worktree.path)) !== workspace) {
    throw new Error('Orca selected a different workspace. Pass the registered workspace root.')
  }
  return { runtimeId: status.data.runtime.runtimeId, workspaceId: worktree.id }
}

export async function launchManager(runDir: string, call: OrcaCall): Promise<unknown> {
  const session = await loadSession(runDir)
  const identity = await verifyLocalWorkspace(call, session.workspace, session.hostBinding)
  const path = join(runDir, 'launch.json')
  const claim = await open(path, 'wx', 0o600).catch(() => {
    throw new Error(
      'This run already has a launch receipt. Inspect it; launching again could duplicate a live manager.'
    )
  })
  let stage = 'creating-terminal'
  let terminal: string | undefined
  try {
    await claim.writeFile(
      JSON.stringify({ stage, ...identity, at: new Date().toISOString() }, null, 2)
    )
    await claim.sync()
  } finally {
    await claim.close()
  }
  try {
    const created = terminalSchema.parse(
      await call([
        'terminal',
        'create',
        '--worktree',
        `id:${identity.workspaceId}`,
        '--title',
        'Manager',
        '--command',
        session.managerAgent
      ])
    )
    terminal = created.terminal.handle
    if (
      created.terminal.worktreeId !== identity.workspaceId ||
      (created.terminal.executionHostId && created.terminal.executionHostId !== 'local')
    ) {
      throw new Error(
        'Terminal execution ownership changed. Inspect the returned terminal; no prompt was sent.'
      )
    }
    stage = 'waiting-for-manager'
    await atomicWrite(path, JSON.stringify({ stage, ...identity, terminal }, null, 2))
    waitSchema.parse(
      await call(
        ['terminal', 'wait', '--terminal', terminal, '--for', 'tui-idle', '--timeout-ms', '60000'],
        75_000
      )
    )
    stage = 'submitting-prompt'
    await atomicWrite(path, JSON.stringify({ stage, ...identity, terminal }, null, 2))
    const prompt = await readFile(join(runDir, 'manager-prompt.md'), 'utf8')
    const submission = await call([
      'terminal',
      'send',
      '--terminal',
      terminal,
      '--text',
      prompt,
      '--enter',
      '--wait-submit',
      '5'
    ])
    verifySubmission(submission, terminal)
    const receipt = {
      stage: 'prompt-accepted',
      ...identity,
      terminal,
      submission,
      report: join(runDir, 'report.html')
    }
    await atomicWrite(path, JSON.stringify(receipt, null, 2))
    return receipt
  } catch (error) {
    await atomicWrite(
      path,
      JSON.stringify(
        {
          stage: 'unverifiable',
          failedStage: stage,
          ...identity,
          terminal,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof OrcaCommandError ? { receipt: error.receipt } : {})
        },
        null,
        2
      )
    )
    throw new Error(
      `Manager launch requires inspection; do not start a duplicate. Read ${path}. ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function messageManager(
  runDir: string,
  text: string,
  call: OrcaCall
): Promise<unknown> {
  const session = await loadSession(runDir)
  const identity = await verifyLocalWorkspace(call, session.workspace, session.hostBinding)
  const launch = launchedSchema.parse(await readJson(join(runDir, 'launch.json')))
  if (identity.runtimeId !== launch.runtimeId || identity.workspaceId !== launch.workspaceId) {
    throw new Error(
      'Manager runtime identity changed. Inspect and reattach in Orca before sending a message.'
    )
  }
  // Never type a user message into a shell left behind by an exited manager.
  waitSchema.parse(
    await call(
      [
        'terminal',
        'wait',
        '--terminal',
        launch.terminal,
        '--for',
        'tui-idle',
        '--timeout-ms',
        '60000'
      ],
      75_000
    )
  )
  const receipt = await call([
    'terminal',
    'send',
    '--terminal',
    launch.terminal,
    '--text',
    text,
    '--enter',
    '--wait-submit',
    '5'
  ])
  verifySubmission(receipt, launch.terminal)
  return receipt
}
