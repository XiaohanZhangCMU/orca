import { realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { agentSchema } from './contracts'
import { managerTeamDefinitionSchema } from '../../../src/shared/manager-team-contract'
import { prepareSession, publishReport, loadSession, recentVersions } from './report-store'
import { readJson } from './scoped-files'
import { createOrcaCall, resolveOrcaExecutable } from './orca-process'
import { launchManager, messageManager } from './launch-manager'

const help = `Orca Manager — supervised ICs and in-app HTML reports

Build: node extensions/manager/build.mjs
Run on the execution host, from an Orca-registered workspace:

  node /path/to/orca-manager.cjs start --goal "Your objective" --workers 3
  node /path/to/orca-manager.cjs prepare --goal "Your objective" --workers 3
  node /path/to/orca-manager.cjs launch --run /path/to/run
  node /path/to/orca-manager.cjs publish --run /path/to/run --input report-draft.json
  node /path/to/orca-manager.cjs show --run /path/to/run
  node /path/to/orca-manager.cjs message --run /path/to/run --text "Your decision"
  node /path/to/orca-manager.cjs request-stop --run /path/to/run

Options: --workspace <root> (default cwd), --orca <CLI path> (default orca),
         --manager codex|claude, --worker codex|claude, --workers 1..8 (default 3).
prepare writes instructions/reports without starting agents. start prepares then launches.
Open the printed report.html using Orca's file preview (not the source editor).
request-stop asks the manager to stop its own workers; it is NOT a confirmed kill.
No provider permission-bypass flags, automatic mutation retries, or cloud uploads.
`

const flagsByCommand: Record<string, string[]> = {
  prepare: [
    'goal',
    'workers',
    'workspace',
    'orca',
    'manager',
    'worker',
    'team',
    'request-id',
    'workspace-id',
    'runtime-id',
    'publisher-node'
  ],
  start: ['goal', 'workers', 'workspace', 'orca', 'manager', 'worker'],
  launch: ['run'],
  publish: ['run', 'input'],
  show: ['run'],
  message: ['run', 'text'],
  'request-stop': ['run']
}

export async function main(args: string[]): Promise<unknown> {
  const [command, ...rest] = args
  if (!command || command === '--help' || command === 'help') {
    return { help }
  }
  const allowed = flagsByCommand[command]
  if (!allowed) {
    throw new Error(`Unknown command: ${command}. Use --help.`)
  }
  const options: Record<string, { type: 'string' }> = {}
  for (const flag of allowed) {
    options[flag] = { type: 'string' }
  }
  const { values } = parseArgs({ args: rest, options, strict: true, allowPositionals: false })
  const required = (name: string): string => {
    const value = values[name]
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`--${name} is required.`)
    }
    return value
  }
  if (command === 'prepare' || command === 'start') {
    const team = values.team
      ? managerTeamDefinitionSchema.parse(JSON.parse(values.team))
      : undefined
    const workspace = await realpath(resolve(values.workspace ?? process.cwd()))
    const orca = await resolveOrcaExecutable(values.orca ?? 'orca')
    const run = await prepareSession(
      {
        workspace,
        objective: team?.objective ?? required('goal'),
        workers: team?.workers.length ?? Number(values.workers ?? 3),
        managerAgent: team?.manager ?? agentSchema.parse(values.manager ?? 'codex'),
        workerAgent: agentSchema.parse(values.worker ?? values.manager ?? 'codex'),
        ...(team ? { workerProfiles: team.workers } : {}),
        ...(values['publisher-node'] ? { publisherNode: values['publisher-node'] } : {}),
        ...(values['workspace-id']
          ? {
              hostBinding: {
                workspaceId: values['workspace-id'],
                runtimeId: required('runtime-id')
              }
            }
          : {}),
        orca,
        publisher: await realpath(process.argv[1])
      },
      values['request-id']
    )
    try {
      const launch =
        command === 'start' ? await launchManager(run, createOrcaCall(orca, workspace)) : undefined
      return {
        run,
        report: join(run, 'report.html'),
        prompt: join(run, 'manager-prompt.md'),
        ...(launch ? { launch } : {}),
        next: 'Open report.html in Orca using the HTML preview action. Reports refresh while work is ongoing.'
      }
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nPrepared run retained at ${run}.`
      )
    }
  }
  const run = await realpath(resolve(required('run')))
  const session = await loadSession(run)
  if (command === 'publish') {
    return publishReport(run, await readJson(resolve(required('input'))))
  }
  if (command === 'show') {
    const launch = await readJson(join(run, 'launch.json')).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    })
    return {
      session,
      launch,
      latestReport: (await recentVersions(run)).at(-1),
      report: join(run, 'report.html'),
      note: 'Last published assessment; not live agent status.'
    }
  }
  const call = createOrcaCall(session.orca, session.workspace)
  if (command === 'launch') {
    return launchManager(run, call)
  }
  const message =
    command === 'request-stop'
      ? 'The user requests a graceful stop of this manager run. Stop dispatching new work, stop only your owned active Orca Dispatches using the orchestration recovery/cleanup contract, and publish a final report of completed work and remaining blockers. Lost contact is unverifiable, not proof of exit. Do not affect other runs.'
      : required('text')
  return {
    requested: true,
    receipt: await messageManager(run, message, call),
    note: 'Delivery receipt only; this does not prove the manager read it or workers stopped.'
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(
        JSON.stringify(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          null,
          2
        )
      )
      process.exitCode = 1
    })
}
