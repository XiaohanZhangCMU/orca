import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { spawnProcess } from '../../../src/shared/child-process/run-process'
import { requireLinux, validatePort } from './host-config'
import { ensureDirectory, requireNativeBinary } from './runtime-files'
import { processIdentity } from './host-control'

const receiptSchema = z.object({
  pid: z.number().int().positive(),
  startTicks: z.string(),
  binary: z.string(),
  port: z.number(),
  allow: z.string(),
  hostname: z.string()
})

async function main() {
  const { values } = parseArgs({
    options: {
      proxy: { type: 'string' },
      allow: { type: 'string' },
      hostname: { type: 'string', default: 'k8s-cpu-orca' },
      port: { type: 'string', default: '6770' }
    }
  })
  requireLinux()
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (uid === undefined || gid === undefined || uid < 1000) {
    throw new Error('Run the tailnet proxy as the dedicated non-root Orca account')
  }
  if (!values.proxy || !values.allow || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(values.hostname)) {
    throw new Error(
      'Required: --proxy /path/to/Linux/binary --allow PHONE_IP,LAPTOP_IP [--hostname name] [--port 6770]'
    )
  }
  process.umask(0o077)
  const port = Number(values.port)
  validatePort(port)
  const binary = realpathSync(values.proxy)
  requireNativeBinary(binary)
  const directory = join(homedir(), '.local', 'state', 'orca-tailnet')
  ensureDirectory(directory, homedir(), uid, gid)
  const launchLock = join(directory, 'launch.lock')
  mkdirSync(launchLock, { mode: 0o700 })
  try {
    const receiptPath = join(directory, 'proxy-pid.json')
    if (existsSync(receiptPath)) {
      const receipt = receiptSchema.parse(JSON.parse(readFileSync(receiptPath, 'utf8')))
      if (existsSync(`/proc/${receipt.pid}/stat`)) {
        const identity = processIdentity(receipt.pid)
        if (identity.startTicks !== receipt.startTicks) {
          throw new Error('Recorded PID was reused; inspect it before launching')
        }
        if (identity.state !== 'Z') {
          if (
            identity.uid !== uid ||
            identity.args[0] !== binary ||
            receipt.binary !== binary ||
            receipt.port !== port ||
            receipt.allow !== values.allow ||
            receipt.hostname !== values.hostname
          ) {
            throw new Error('A different proxy owns this receipt; no restart attempted')
          }
          console.log(JSON.stringify({ pid: receipt.pid, alreadyRunning: true, directory }))
          return
        }
      }
      renameSync(receiptPath, join(directory, `proxy-pid-${randomUUID()}.json`))
    }
    const log = openSync(join(directory, 'proxy.log'), 'a', 0o600)
    const ready = openSync(join(directory, 'ready.jsonl'), 'a', 0o600)
    let child
    try {
      child = spawnProcess({
        program: binary,
        args: [
          '-hostname',
          values.hostname,
          '-state-dir',
          directory,
          '-port',
          String(port),
          '-allow',
          values.allow
        ],
        cwd: homedir(),
        env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
        detached: true,
        stdio: ['ignore', ready, log]
      })
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      child.unref()
    } finally {
      closeSync(log)
      closeSync(ready)
    }
    if (!child.pid) {
      throw new Error('Proxy did not start')
    }
    const identity = processIdentity(child.pid)
    const receipt = {
      pid: child.pid,
      startTicks: identity.startTicks,
      binary,
      port,
      allow: values.allow,
      hostname: values.hostname
    }
    writeFileSync(receiptPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
    console.log(
      JSON.stringify({
        ...receipt,
        directory,
        message:
          'Started; authorize the device using the login link in private proxy.log, then check ready.jsonl.'
      })
    )
  } finally {
    rmdirSync(launchLock)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Tailnet launch failed')
  process.exitCode = 1
})
