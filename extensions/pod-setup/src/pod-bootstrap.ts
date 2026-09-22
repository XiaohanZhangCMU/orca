import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { spawnProcess } from '../../../src/shared/child-process/run-process'
import { checkedProcess } from './cluster-process'
import { processIdentity } from './host-control'
import { installHost } from './install-host'
import { podEnvironment, podHome, podState, readPodPlan } from './pod-environment'
import { installTools, nativeAgent } from './pod-tool-install'
import { cloneRepositories } from './pod-repositories'
import { installPrivateFile } from './pod-private-files'

function progress(phase: string, state = 'running') {
  writeFileSync(
    join(podState, 'progress.json'),
    JSON.stringify({ phase, state, updatedAt: new Date().toISOString() }),
    { mode: 0o600 }
  )
  console.log(phase)
}
async function bootstrap() {
  const plan = readPodPlan()
  process.env.ORCA_POD_SETUP_DIAGNOSTICS = '1'
  const lock = join(podState, 'bootstrap.lock')
  mkdirSync(lock, { mode: 0o700 })
  try {
    progress('Installing pinned tools')
    await installTools(plan)
    progress('Cloning pinned repositories')
    await cloneRepositories(plan)
    const source = join(podHome, 'Codes/orca')
    const env = podEnvironment()
    const built = join(podState, 'built.json')
    if (!existsSync(built)) {
      progress('Installing Orca dependencies')
      await checkedProcess(
        {
          program: 'pnpm',
          args: ['install', '--frozen-lockfile', '--ignore-scripts', '--network-concurrency=4'],
          cwd: source,
          env,
          timeoutMs: 1_800_000
        },
        'Orca dependency install'
      )
      progress('Building the Linux Orca server')
      await checkedProcess(
        { program: 'pnpm', args: ['build:server'], cwd: source, env, timeoutMs: 1_800_000 },
        'Orca Linux build'
      )
      writeFileSync(built, JSON.stringify({ digest: plan.source.digest }), {
        flag: 'wx',
        mode: 0o600
      })
    }
    progress('Installing the non-root Orca host')
    await installHost({
      source,
      node: '/usr/local/bin/node',
      claude: nativeAgent('claude'),
      opencode: nativeAgent('opencode'),
      user: 'orca',
      port: 6770,
      dryRun: false,
      controller: join(podState, 'pod-setup.cjs')
    })
    progress('Starting Orca')
    await checkedProcess(
      {
        program: process.execPath,
        args: [join(podState, 'services.cjs')],
        env: podEnvironment(true),
        timeoutMs: 300_000
      },
      'Orca startup'
    )
    installPrivateFile(
      podHome,
      '.local/state/orca-cluster/launch.cjs',
      `require(${JSON.stringify(join(podState, 'services.cjs'))})\n`
    )
    progress('Verifying credentials from the pod')
    const result = await checkedProcess(
      {
        program: process.execPath,
        args: [join(podState, 'verify.cjs')],
        env: podEnvironment(true),
        timeoutMs: 180_000
      },
      'remote verification'
    )
    writeFileSync(join(podState, 'verification.json'), result, { mode: 0o600 })
    progress('Ready', 'complete')
  } finally {
    rmdirSync(lock)
  }
}

async function start() {
  readPodPlan()
  const receiptFile = join(podState, 'bootstrap-pid.json')
  if (existsSync(receiptFile)) {
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'))
    if (existsSync(`/proc/${receipt.pid}/stat`)) {
      const identity = processIdentity(receipt.pid)
      if (identity.startTicks !== receipt.startTicks || identity.uid !== 1001) {
        throw new Error('Bootstrap process identity is unverifiable')
      }
      if (identity.state !== 'Z') {
        console.log(JSON.stringify({ state: 'live', pid: receipt.pid }))
        return
      }
    }
  }
  const out = openSync(join(podState, 'bootstrap.log'), 'a', 0o600)
  try {
    const child = spawnProcess({
      program: process.execPath,
      args: [process.argv[1], 'run'],
      cwd: podHome,
      env: podEnvironment(),
      detached: true,
      stdio: ['ignore', out, out]
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    if (!child.pid) {
      throw new Error('Bootstrap did not start')
    }
    const identity = processIdentity(child.pid)
    writeFileSync(
      receiptFile,
      JSON.stringify({ pid: child.pid, startTicks: identity.startTicks }),
      { mode: 0o600 }
    )
    child.unref()
    console.log(JSON.stringify({ state: 'live', pid: child.pid }))
  } finally {
    closeSync(out)
  }
}
;(process.argv[2] === 'start' ? start() : bootstrap()).catch((error) => {
  const message = error instanceof Error ? error.message : 'Bootstrap failed'
  progress(message, 'failed')
  console.error(message)
  process.exitCode = 1
})
