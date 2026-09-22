import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { installHost } from './install-host'
import { readHostConfig } from './host-config'
import {
  assertHostUser,
  hostStatus,
  initializeWorkspace,
  printPairing,
  startHost
} from './host-control'
import { shellQuote } from './runtime-files'

const usage = `Linux pod bootstrap (Node 24; root or the existing dedicated account):
  pod-setup.cjs install --source /checkout --claude /native/claude --opencode /native/opencode
    [--node /path/to/node24] [--user orca] [--port 6770]
    [--ssh-public-key /path/to/laptop.pub] [--dry-run] [--start]

After installation, as the configured non-root user:
  orca-host start           Start, or check the existing process; never restarts it.
  orca-host status          Check actual runtime graph readiness.
  orca-host init-workspace  Optionally register the default folder workspace.
  orca-host pairing         Print the private pairing link explicitly.

Prerequisites: built Linux out/orcad and native dependencies in --source;
standalone Linux Node 24, Claude, and OpenCode binaries. No credentials are copied.
`

async function main() {
  const parsed = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      source: { type: 'string' },
      node: { type: 'string' },
      claude: { type: 'string' },
      opencode: { type: 'string' },
      user: { type: 'string', default: 'orca' },
      port: { type: 'string', default: '6770' },
      'ssh-public-key': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      start: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }
    }
  })
  if (parsed.values.help) {
    console.log(usage)
    return
  }
  const command = parsed.positionals[0]
  if (parsed.positionals.length !== 1) {
    throw new Error(usage)
  }
  if (command === 'install') {
    const values = parsed.values
    if (!values.source || !values.claude || !values.opencode) {
      throw new Error(usage)
    }
    const config = await installHost({
      source: resolve(values.source),
      node: resolve(values.node ?? process.execPath),
      claude: resolve(values.claude),
      opencode: resolve(values.opencode),
      user: values.user,
      port: Number(values.port),
      publicKey: values['ssh-public-key'],
      dryRun: values['dry-run'],
      controller: resolve(process.argv[1])
    })
    if (!config) {
      return
    }
    console.log(
      JSON.stringify({
        installed: config.root,
        user: config.user,
        profile: config.profile,
        workspace: config.workspace,
        port: config.port,
        credentialsCopied: false
      })
    )
    if (values.start) {
      const result = await runProcess({
        program:
          process.getuid?.() === config.uid ? join(config.root, 'bin', 'orca-host') : 'runuser',
        args:
          process.getuid?.() === config.uid
            ? ['start']
            : [
                '--login',
                config.user,
                '--command',
                `${shellQuote(join(config.root, 'bin', 'orca-host'))} start`
              ],
        timeoutMs: 110_000,
        maxOutputBytes: 16_000
      })
      if (result.code !== 0 || result.timedOut || result.outputTruncated) {
        throw new Error(
          `start failed; inspect the user's private server log. ${result.stderr.trim()}`
        )
      }
      console.log(result.stdout.trim())
    }
    return
  }
  const config = readHostConfig(dirname(resolve(process.argv[1])))
  assertHostUser(config)
  if (command === 'start') {
    await startHost(config)
  } else if (command === 'status') {
    console.log(JSON.stringify(await hostStatus(config)))
  } else if (command === 'pairing') {
    await printPairing(config)
  } else if (command === 'init-workspace') {
    await initializeWorkspace(config)
  } else {
    throw new Error(usage)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Pod setup failed')
  process.exitCode = 1
})
