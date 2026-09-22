import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { clusterConfigSchema } from './cluster-config'
import { receiptSchema, runningPod, stateDirectory, ownedObject } from './cluster-state'
import { kubectl } from './cluster-process'
import { legacyHost, savedHosts, savedAccess } from './desktop-legacy-hosts'
import { parsePairingCode } from '../../../src/shared/pairing'
import type { BasetenHost, BasetenHostRegistration } from '../../../src/shared/baseten-hosts'

export function registeredHost(name: string) {
  if (!/^[a-z][a-z0-9-]{1,50}[a-z0-9]$/.test(name)) {
    throw new Error('Invalid host name')
  }
  const receipt = receiptSchema.parse(
    JSON.parse(
      readFileSync(join(homedir(), '.local/state/orca-pods', name, 'receipt.json'), 'utf8')
    )
  )
  const config = clusterConfigSchema.parse(receipt.config)
  if (config.name !== name) {
    throw new Error('Host receipt identity mismatch')
  }
  return { receipt, config }
}

export async function hostPod(name: string) {
  const host = registeredHost(name)
  const pod = await runningPod(host.config, host.receipt)
  if (!pod) {
    throw new Error('Host is unverifiable. Check cluster access and refresh; no pod was recreated.')
  }
  return { ...host, pod }
}

export function isRegisteredHost(name: string): boolean {
  return (
    /^[a-z][a-z0-9-]{1,50}[a-z0-9]$/.test(name) &&
    existsSync(join(homedir(), '.local/state/orca-pods', name, 'receipt.json'))
  )
}

async function inspectHost(name: string): Promise<BasetenHost | null> {
  let host
  try {
    host = registeredHost(name)
  } catch {
    return null
  }
  const row: BasetenHost = {
    name: host.config.name,
    namespace: host.config.namespace,
    storage: host.config.storage,
    management: 'installer',
    instance: host.receipt.plan.instance,
    state: 'unverifiable',
    phase: 'Execution status is unverifiable'
  }
  const progressFile = join(stateDirectory(host.config), 'ui-progress.json')
  try {
    const progress = z
      .object({
        state: z.enum(['setting-up', 'ready', 'failed', 'unverifiable']),
        phase: z.string()
      })
      .parse(JSON.parse(readFileSync(progressFile, 'utf8')))
    Object.assign(row, progress)
  } catch {
    /* A missing or partial local progress file must not hide other hosts. */
  }
  try {
    const deployment = await ownedObject(
      host.config,
      'deployment',
      host.config.name,
      host.receipt.plan.instance,
      host.receipt.deploymentUid
    )
    if (
      deployment?.spec?.replicas === 0 &&
      deployment.metadata.annotations?.['orca.dev/released-at']
    ) {
      const pods = z
        .object({ items: z.array(z.unknown()) })
        .parse(
          JSON.parse(
            await kubectl(host.config, [
              'get',
              'pods',
              '-l',
              `orca.dev/instance=${host.receipt.plan.instance}`,
              '-o',
              'json'
            ])
          )
        )
      row.state = pods.items.length ? 'releasing' : 'released'
      row.phase = pods.items.length
        ? 'Waiting for the cluster to terminate this host’s pods.'
        : 'Compute released. Deployment and persistent disk retained; storage charges may continue.'
      return row
    }
    const pod = await runningPod(host.config, host.receipt)
    if (!pod) {
      if (row.state !== 'setting-up' && row.state !== 'failed') {
        row.state = 'unverifiable'
        row.phase = 'Pod execution is unverifiable; no workload was recreated.'
      }
      return row
    }
    const output = await kubectl(
      host.config,
      [
        'exec',
        pod,
        '-c',
        'orca',
        '--',
        'node',
        '-e',
        "const fs=require('fs');const p='/home/orca/.local/state/orca-cluster/progress.json';process.stdout.write(fs.existsSync(p)?fs.readFileSync(p):'{}')"
      ],
      undefined,
      8000
    )
    const progress = z
      .object({ state: z.string().optional(), phase: z.string().optional() })
      .parse(JSON.parse(output))
    if (progress.state) {
      row.state =
        progress.state === 'complete'
          ? 'ready'
          : progress.state === 'failed'
            ? 'failed'
            : 'setting-up'
      row.phase = progress.phase ?? 'Setting up'
    }
    if (row.state === 'ready') {
      const status = z
        .object({ runtimeId: z.string(), ready: z.boolean() })
        .parse(
          JSON.parse(
            await kubectl(
              host.config,
              ['exec', pod, '-c', 'orca', '--', '/home/orca/.local/bin/orca-host', 'status'],
              undefined,
              8000
            )
          )
        )
      row.runtimeId = status.runtimeId
      if (!status.ready) {
        row.state = 'unverifiable'
      }
    }
  } catch {
    row.state = 'unverifiable'
    row.phase = 'Cannot verify this host. Refresh after reconnecting to the cluster.'
  }
  return row
}

function registeredNames(): string[] {
  const root = join(homedir(), '.local/state/orca-pods')
  return existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : []
}

// Local registration discovers candidates; connecting still authenticates the live host key.
export function registrations(source: string): BasetenHostRegistration[] {
  const names = new Set([...registeredNames(), ...savedHosts(source)])
  const rows: BasetenHostRegistration[] = []
  for (const name of names) {
    let row: BasetenHostRegistration
    try {
      const host = isRegisteredHost(name) ? registeredHost(name) : null
      row = host
        ? { name, management: 'installer', instance: host.receipt.plan.instance }
        : { name, management: 'legacy' }
    } catch {
      continue
    }
    try {
      row.publicKeyB64 = parsePairingCode(savedAccess(source, name))?.publicKeyB64
    } catch {
      // A missing saved link must not hide an installer-owned host.
    }
    rows.push(row)
  }
  return rows
}

export async function inventory(source = process.cwd()): Promise<BasetenHost[]> {
  const names = registeredNames()
  const tasks = [
    ...names.map((name) => () => inspectHost(name)),
    ...savedHosts(source)
      .filter((name) => !isRegisteredHost(name))
      .map((name) => () => legacyHost(source, name))
  ]
  const rows: BasetenHost[] = []
  async function drain() {
    for (let task = tasks.shift(); task; task = tasks.shift()) {
      const row = await task()
      if (row) {
        rows.push(row)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, drain))
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}
