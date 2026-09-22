import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { basetenSetupSchema } from '../../../src/shared/baseten-hosts'
import { clusterConfigSchema, expandLocalPath } from './cluster-config'
import { preflight } from './cluster-preflight'
import { launchCluster } from './cluster-launch'
import { stateDirectory } from './cluster-state'
import { hostPod, inventory, isRegisteredHost, registrations } from './desktop-inventory'
import { kubectl } from './cluster-process'
import { enablePhone, phoneStatus } from './desktop-phone'
import { savedAccess, savedPhone } from './desktop-legacy-hosts'
import { releaseHost } from './desktop-release'

const requestSchema = z
  .object({
    command: z.enum([
      'list',
      'registrations',
      'check',
      'create',
      'access',
      'phone',
      'enable-phone',
      'release'
    ]),
    setup: basetenSetupSchema.optional(),
    name: z.string().optional(),
    allowedIps: z.array(z.string()).max(16).optional(),
    source: z.string(),
    instance: z.string().uuid().optional(),
    confirmation: z.string().optional()
  })
  .strict()

async function main() {
  process.umask(0o077)
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 64000) {
      throw new Error('Invalid request')
    }
  }
  const request = requestSchema.parse(JSON.parse(input))
  // Only the result is sent to the desktop; child diagnostics never enter the renderer.
  console.log = () => {}
  if (request.command === 'registrations') {
    return registrations(request.source)
  }
  if (request.command === 'list') {
    return inventory(request.source)
  }
  if (request.command === 'release') {
    return releaseHost(request.name ?? '', request.instance ?? '', request.confirmation ?? '')
  }
  if (request.command === 'phone') {
    const name = request.name ?? ''
    const saved = savedPhone(request.source, name)
    if (saved) {
      return saved
    }
    if (!isRegisteredHost(name)) {
      return {
        state: 'unverifiable',
        message:
          'No saved mobile pairing link for this legacy host. Generate one on that host; desktop access links cannot pair a phone.'
      }
    }
    return phoneStatus(name, request.source)
  }
  if (request.command === 'enable-phone') {
    return enablePhone(request.name ?? '', request.allowedIps ?? [], request.source)
  }
  if (request.command === 'access') {
    if (!isRegisteredHost(request.name ?? '')) {
      return { link: savedAccess(request.source, request.name ?? ''), existing: true }
    }
    const { config, pod } = await hostPod(request.name ?? '')
    const link = await kubectl(config, [
      'exec',
      pod,
      '-c',
      'orca',
      '--',
      '/home/orca/.local/bin/orca-host',
      'pairing'
    ])
    return {
      link: link.trim(),
      kubectl: config.kubectl,
      kubeconfig: config.kubeconfig,
      namespace: config.namespace,
      pod
    }
  }
  const setup = basetenSetupSchema.parse(request.setup)
  const config = clusterConfigSchema.parse({
    name: setup.name,
    namespace: setup.namespace,
    source: expandLocalPath(setup.source),
    dreamteam: expandLocalPath(setup.dreamteam),
    kubeconfig: expandLocalPath(setup.kubeconfig),
    storage: `${setup.storageGi}Gi`,
    allowUnverified: ['notion']
  })
  if (request.command === 'check') {
    const result = await preflight(config)
    return {
      checks: result.checks.map(({ service, status }) => ({
        service,
        status,
        optional: service === 'notion'
      })),
      repositories: result.plan.repositories.map(({ name }) => name),
      blocked: result.blockers.length > 0
    }
  }
  const directory = stateDirectory(config)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  config.promptFile = join(directory, 'ui-prompt.txt')
  writeFileSync(config.promptFile, setup.prompt, { flag: 'wx', mode: 0o600 })
  const report = (phase: string, state: 'setting-up' | 'ready' | 'failed' = 'setting-up') => {
    const temporary = join(directory, `ui-progress-${randomUUID()}.json`)
    writeFileSync(temporary, JSON.stringify({ phase, state }), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, join(directory, 'ui-progress.json'))
  }
  try {
    report('Checking credentials and cluster admission')
    await launchCluster(config, (phase) => report(phase))
    report('Orca is ready', 'ready')
    return { ok: true }
  } catch (error) {
    report('Setup did not finish. Resources and existing sessions were retained.', 'failed')
    throw error
  }
}

main()
  .then((result) => process.stdout.write(JSON.stringify({ ok: true, result: result ?? null })))
  .catch((error) => {
    const message =
      error instanceof Error && !(error instanceof z.ZodError)
        ? error.message
        : 'Invalid setup data or host response'
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error:
          message.includes('://') || message.length > 350
            ? 'Setup failed. Check the local prerequisites and host status.'
            : message
      })
    )
    process.exitCode = 1
  })
