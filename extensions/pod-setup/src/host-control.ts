import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { spawnProcess } from '../../../src/shared/child-process/run-process'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import type { RuntimeStatus } from '../../../src/shared/runtime-types'
import { z } from 'zod'
import { requireLinux, type HostConfig } from './host-config'

const launchSchema = z.object({
  pid: z.number().int().positive(),
  startTicks: z.string(),
  readiness: z.string().regex(/^ready-[a-zA-Z0-9-]+\.jsonl$/)
})
const readySchema = z.object({
  type: z.literal('orca_server_ready'),
  runtimeId: z.string(),
  boundEndpoint: z.string(),
  health: z.object({
    pid: z.number(),
    terminalDaemon: z.object({ state: z.string(), ownsFreshSessions: z.boolean() })
  }),
  pairing: z.object({ available: z.boolean(), url: z.string().optional() })
})

function client(config: HostConfig): RuntimeClient {
  return new RuntimeClient(config.profile, 20_000, null, null)
}

export function processIdentity(pid: number) {
  const directory = join('/proc', String(pid))
  const fields = readFileSync(join(directory, 'stat'), 'utf8').split(') ')[1].split(' ')
  return {
    uid: statSync(directory).uid,
    state: fields[0],
    startTicks: fields[19],
    args: readFileSync(join(directory, 'cmdline'), 'utf8').split('\0')
  }
}

function readReady(path: string) {
  const lines = readFileSync(path, 'utf8').split('\n')
  for (const line of lines) {
    if (!line.startsWith('{')) {
      continue
    }
    try {
      const parsed = readySchema.safeParse(JSON.parse(line))
      if (parsed.success) {
        return parsed.data
      }
    } catch {
      /* Wait for a complete readiness line. */
    }
  }
  return null
}

export function assertHostUser(config: HostConfig): void {
  requireLinux()
  if (process.getuid?.() !== config.uid || process.getuid() === 0) {
    throw new Error(`Run orca-host as ${config.user}, not root`)
  }
  process.umask(0o077)
}

async function assertPortFree(port: number): Promise<void> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () =>
      probe.close((error) => (error ? reject(error) : resolve()))
    )
  })
}

export async function hostStatus(config: HostConfig) {
  const { result } = await client(config).call<RuntimeStatus>('status.get')
  return {
    runtimeId: result.runtimeId,
    graph: result.graphStatus,
    ready: result.graphStatus === 'ready'
  }
}

export async function startHost(config: HostConfig): Promise<void> {
  assertHostUser(config)
  const logs = join(config.home, '.local', 'state', 'orca-pod-host')
  mkdirSync(logs, { recursive: true, mode: 0o700 })
  const lock = join(logs, 'start.lock')
  mkdirSync(lock, { mode: 0o700 })
  try {
    const receiptPath = join(logs, 'pid.json')
    if (existsSync(receiptPath)) {
      const receipt = launchSchema.parse(JSON.parse(readFileSync(receiptPath, 'utf8')))
      if (existsSync(join('/proc', String(receipt.pid), 'stat'))) {
        const identity = processIdentity(receipt.pid)
        if (identity.startTicks !== receipt.startTicks) {
          throw new Error('Recorded PID was reused; inspect before starting')
        }
        if (identity.state !== 'Z') {
          if (identity.uid !== config.uid || identity.args[1] !== join(config.root, 'orcad.js')) {
            throw new Error('Recorded server identity does not match')
          }
          const status = await hostStatus(config)
          if (!status.ready) {
            throw new Error('Existing server is not ready; no duplicate or restart attempted')
          }
          console.log(JSON.stringify({ ...status, pid: receipt.pid, alreadyRunning: true }))
          return
        }
      }
      renameSync(receiptPath, join(logs, `pid-${randomUUID()}.json`))
    }
    await assertPortFree(config.port)
    const readiness = `ready-${randomUUID()}.jsonl`
    const out = openSync(join(logs, readiness), 'wx', 0o600)
    const err = openSync(join(logs, 'server.log'), 'a', 0o600)
    let child
    try {
      child = spawnProcess({
        program: join(config.root, 'bin', 'node'),
        args: [
          join(config.root, 'orcad.js'),
          '--bind',
          '127.0.0.1',
          '--port',
          String(config.port),
          '--pairing-address',
          `ws://127.0.0.1:${config.port}`,
          '--with-mobile-pairing',
          '--json'
        ],
        cwd: config.home,
        env: {
          ...process.env,
          PATH: `${join(config.root, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
          ORCA_USER_DATA: config.profile,
          ORCA_USER_DATA_PATH: config.profile,
          ORCA_BACKGROUND_LAUNCH: '1'
        },
        detached: true,
        stdio: ['ignore', out, err]
      })
    } finally {
      closeSync(out)
      closeSync(err)
    }
    let spawnError = false
    child.on('error', () => {
      spawnError = true
    })
    child.unref()
    if (!child.pid) {
      throw new Error('Could not start server')
    }
    const identity = processIdentity(child.pid)
    writeFileSync(
      receiptPath,
      JSON.stringify({ pid: child.pid, startTicks: identity.startTicks, readiness }),
      { flag: 'wx', mode: 0o600 }
    )
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (
        spawnError ||
        !existsSync(join('/proc', String(child.pid), 'stat')) ||
        processIdentity(child.pid).state === 'Z'
      ) {
        throw new Error('Server exited before readiness; inspect server.log')
      }
      const ready = readReady(join(logs, readiness))
      if (ready) {
        if (
          ready.health.pid !== child.pid ||
          ready.boundEndpoint !== `ws://127.0.0.1:${config.port}` ||
          ready.health.terminalDaemon.state !== 'live' ||
          !ready.health.terminalDaemon.ownsFreshSessions
        ) {
          throw new Error(
            'Server endpoint or daemon readiness did not match; inspect before retrying'
          )
        }
        const status = await hostStatus(config)
        if (!status.ready || status.runtimeId !== ready.runtimeId) {
          throw new Error('RPC answered, but terminal graph is not ready; rebuild the server')
        }
        console.log(
          JSON.stringify({
            ...status,
            pid: child.pid,
            endpoint: ready.boundEndpoint,
            pairingCommand: 'orca-host pairing'
          })
        )
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('Server readiness is unverifiable; inspect the launch receipt before retrying')
  } finally {
    rmdirSync(lock)
  }
}

export async function printPairing(config: HostConfig): Promise<void> {
  assertHostUser(config)
  const logs = join(config.home, '.local', 'state', 'orca-pod-host')
  const receipt = launchSchema.parse(JSON.parse(readFileSync(join(logs, 'pid.json'), 'utf8')))
  const ready = readReady(join(logs, receipt.readiness))
  const status = await hostStatus(config)
  if (
    !status.ready ||
    ready?.runtimeId !== status.runtimeId ||
    !ready.pairing.available ||
    !ready.pairing.url
  ) {
    throw new Error('No current pairing offer; do not use a stale link')
  }
  console.error('Private pairing link: do not share it or commit it.')
  console.log(ready.pairing.url)
}

export async function initializeWorkspace(config: HostConfig): Promise<void> {
  assertHostUser(config)
  const runtime = client(config)
  const parentPath = join(config.home, 'Codes')
  const { result: groups } = await runtime.call<{ groups: { id: string; parentPath: string }[] }>(
    'projectGroup.list'
  )
  let group = groups.groups.find((item) => item.parentPath === parentPath)
  if (!group) {
    group = (
      await runtime.call<{ group: { id: string; parentPath: string } }>('projectGroup.create', {
        name: 'Non-root workspaces',
        parentPath,
        createdFrom: 'manual'
      })
    ).result.group
  }
  const { result: folders } = await runtime.call<{
    folderWorkspaces: { id: string; folderPath: string }[]
  }>('folderWorkspace.list')
  let folder = folders.folderWorkspaces.find((item) => item.folderPath === config.workspace)
  if (!folder) {
    folder = (
      await runtime.call<{ folderWorkspace: { id: string; folderPath: string } }>(
        'folderWorkspace.create',
        { projectGroupId: group.id, name: 'Workspace', folderPath: config.workspace }
      )
    ).result.folderWorkspace
  }
  console.log(JSON.stringify({ workspace: folder.folderPath, worktreeId: `folder:${folder.id}` }))
}
