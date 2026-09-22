import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { runProcess } from '../../shared/child-process/run-process'
import {
  basetenSetupSchema,
  type BasetenSetup,
  type BasetenHost,
  type BasetenHostsApi,
  type BasetenHostRegistration
} from '../../shared/baseten-hosts'
import { hostAccessLink, hostAccessSchema, closeHostTunnel } from './host-tunnels'
import { encodeMobilePairingQr } from '../runtime/mobile-pairing-qr'
import { decodePairingOffer } from '../../shared/pairing'

const hostSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  storage: z.string(),
  phase: z.string(),
  state: z.enum(['setting-up', 'ready', 'unverifiable', 'failed', 'releasing', 'released']),
  runtimeId: z.string().optional(),
  management: z.enum(['installer', 'legacy']).optional(),
  instance: z.string().uuid().optional()
})
const phoneSchema = z.object({
  state: z.enum(['not-enabled', 'authorizing', 'ready', 'unverifiable', 'update-required']),
  authUrl: z.string().optional(),
  link: z.string().optional(),
  endpoint: z.string().optional(),
  message: z.string()
})
const checkSchema = z.object({
  checks: z.array(z.object({ service: z.string(), status: z.string(), optional: z.boolean() })),
  repositories: z.array(z.string()),
  blocked: z.boolean()
})
const builds = new Map<string, Promise<void>>()
const tickets = new Map<string, { setup: BasetenSetup; expires: number }>()
const jobs = new Map<string, BasetenHost>()
let source: string | undefined
let inventoryTask: Promise<BasetenHost[]> | null = null
function sourceRoot(): string {
  const developmentRoot = process.env.ORCA_DEV_REPO_ROOT ?? app.getAppPath()
  return (
    source ??
    (!app.isPackaged && existsSync(join(developmentRoot, 'extensions/pod-setup/build.mjs'))
      ? developmentRoot
      : join(homedir(), 'Codes', 'orca'))
  )
}
function childEnv() {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', ORCA_BACKGROUND_LAUNCH: '1' }
}

async function build(root: string): Promise<void> {
  if (!existsSync(join(root, 'extensions/pod-setup/build.mjs'))) {
    throw new Error(
      'Choose your Orca fork checkout in Advanced setup. Install its dependencies before using host setup.'
    )
  }
  let task = builds.get(root)
  if (!task) {
    task = runProcess({
      program: process.execPath,
      args: [join(root, 'extensions/pod-setup/build.mjs')],
      cwd: root,
      env: childEnv(),
      timeoutMs: 120_000
    }).then((result) => {
      if (result.code !== 0) {
        throw new Error(
          'Could not build the pod setup tools. Check that this Orca checkout has its dependencies installed.'
        )
      }
    })
    builds.set(root, task)
    task.catch(() => builds.delete(root))
  }
  await task
}
async function worker<T>(
  command: string,
  schema: z.ZodType<T>,
  extra: Record<string, unknown> = {},
  timeoutMs = 180_000
): Promise<T> {
  const root = sourceRoot()
  await build(root)
  const result = await runProcess({
    program: process.execPath,
    args: [join(root, 'out/pod-setup/desktop.cjs')],
    cwd: root,
    env: childEnv(),
    input: JSON.stringify({ command, source: root, ...extra }),
    timeoutMs,
    maxOutputBytes: 1024 * 1024
  })
  if (result.timedOut || result.outputTruncated) {
    throw new Error(
      'The host operation did not finish. Refresh its status before retrying; existing work was retained.'
    )
  }
  const response = z
    .object({ ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() })
    .safeParse(
      (() => {
        try {
          return JSON.parse(result.stdout)
        } catch {
          return null
        }
      })()
    )
  if (!response.success) {
    throw new Error(
      'The host setup tool did not return a valid response. Check local prerequisites.'
    )
  }
  if (!response.data.ok || result.code !== 0) {
    throw new Error(response.data.error ?? 'Host operation failed')
  }
  return schema.parse(response.data.result)
}

export const basetenHostService: Omit<BasetenHostsApi, 'connect'> & {
  registrations(): Promise<BasetenHostRegistration[]>
} = {
  registrations() {
    return worker(
      'registrations',
      z.array(
        hostSchema
          .pick({ name: true, management: true, instance: true })
          .extend({ publicKeyB64: z.string().optional() })
      )
    )
  },
  async defaults() {
    return {
      name: `orca-cpu-${new Date().toISOString().slice(5, 10).replace('-', '')}`,
      namespace: 'ori-rcano-testing',
      source: sourceRoot(),
      dreamteam: join(homedir(), 'Codes/dreamteam'),
      kubeconfig: join(homedir(), '.kube/ori-dfw-prod-1-token.yaml'),
      storageGi: 250,
      prompt:
        'Create a non-root Orca CPU host with persistent home storage, the Dreamteam repositories, and the allowlisted local credentials. Enable desktop access and private phone pairing.'
    }
  },
  async list() {
    if (!inventoryTask) {
      inventoryTask = worker('list', z.array(hostSchema)).finally(() => {
        inventoryTask = null
      })
    }
    const hosts = await inventoryTask
    for (const job of jobs.values()) {
      if (!hosts.some((host) => host.name === job.name)) {
        hosts.push(job)
      }
    }
    return hosts
  },
  async check(input) {
    const setup = basetenSetupSchema.parse(input)
    setup.source = resolve(
      setup.source.startsWith('~/') ? join(homedir(), setup.source.slice(2)) : setup.source
    )
    for (const [ticket, checked] of tickets) {
      if (checked.expires < Date.now()) {
        tickets.delete(ticket)
      }
    }
    if (process.platform === 'win32') {
      throw new Error(
        'The current Baseten ledger and credential tools require macOS or Linux. This does not affect connecting to existing Orca servers.'
      )
    }
    source = setup.source
    builds.delete(source)
    const result = await worker('check', checkSchema, { setup }, 600_000)
    const ticket = result.blocked ? null : randomUUID()
    if (ticket) {
      tickets.set(ticket, { setup, expires: Date.now() + 15 * 60_000 })
    }
    return { ticket, checks: result.checks, repositories: result.repositories }
  },
  async create(ticket, consent) {
    const checked = tickets.get(ticket)
    if (!checked || checked.expires < Date.now() || consent !== true) {
      throw new Error(
        'Check this setup again and confirm credential transfer before creating a host.'
      )
    }
    if (jobs.has(checked.setup.name)) {
      throw new Error(
        'This host already has a setup attempt. Refresh and inspect it before retrying.'
      )
    }
    tickets.delete(ticket)
    source = checked.setup.source
    const job: BasetenHost = {
      name: checked.setup.name,
      namespace: checked.setup.namespace,
      storage: `${checked.setup.storageGi}Gi`,
      state: 'setting-up',
      phase: 'Checking credentials and preparing the pod'
    }
    jobs.set(job.name, job)
    void worker('create', z.object({ ok: z.boolean() }), { setup: checked.setup }, 70 * 60_000)
      .then(() => {
        jobs.delete(job.name)
      })
      .catch((error: unknown) => {
        job.state = 'failed'
        job.phase =
          error instanceof Error ? error.message : 'Setup did not finish. Resources were retained.'
      })
  },
  async access(name) {
    const access = await worker(
      'access',
      z.union([hostAccessSchema, z.object({ existing: z.literal(true), link: z.string() })]),
      { name }
    )
    if ('existing' in access) {
      return { link: access.link }
    }
    return { link: await hostAccessLink(name, access) }
  },
  async phone(name) {
    const phone = await worker('phone', phoneSchema, { name })
    if (phone.authUrl && new URL(phone.authUrl).origin !== 'https://login.tailscale.com') {
      throw new Error('Unexpected Tailscale authorization address')
    }
    if (!phone.link) {
      return phone
    }
    if (decodePairingOffer(phone.link).scope !== 'mobile') {
      throw new Error('This is not a mobile-scoped pairing link.')
    }
    const qr = await encodeMobilePairingQr(phone.link)
    if (!qr.ok) {
      throw new Error('Could not render the phone QR code. Refresh and try again.')
    }
    return { ...phone, qrDataUrl: qr.qrDataUrl }
  },
  async enablePhone(name, allowedIps) {
    await worker('enable-phone', z.null(), { name, allowedIps }, 15 * 60_000)
  },
  async release(name, instance, confirmation) {
    if (jobs.get(name)?.state === 'setting-up') {
      throw new Error('Setup is still active. Wait for it to finish before releasing this host.')
    }
    if (confirmation !== name) {
      throw new Error('Type the exact host name to release it.')
    }
    await worker('release', z.null(), { name, instance, confirmation })
    closeHostTunnel(name)
  }
}
