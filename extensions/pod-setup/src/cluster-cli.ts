import { parseArgs } from 'node:util'
import { readClusterConfig } from './cluster-config'
import { preflight } from './cluster-preflight'
import { launchCluster } from './cluster-launch'
import { readReceipt, runningPod } from './cluster-state'
import { kubectl } from './cluster-process'
import { spawnProcess } from '../../../src/shared/child-process/run-process'
import { tunnelPairingLink } from './cluster-tunnel'
import { validatePort } from './host-config'
import { exportClusterInventory } from './cluster-inventory'

async function main() {
  process.umask(0o077)
  const args = parseArgs({
    allowPositionals: true,
    options: { config: { type: 'string' }, 'local-port': { type: 'string', default: '6771' } }
  })
  const localPort = Number(args.values['local-port'])
  validatePort(localPort)
  const command = args.positionals[0]
  if (
    args.positionals.length !== 1 ||
    !['dry-run', 'up', 'status', 'verify', 'shell', 'connect', 'pairing', 'export-env'].includes(
      command
    )
  ) {
    throw new Error(
      'Usage: cluster.cjs dry-run|up|status|verify|shell|connect|pairing|export-env [--config path]'
    )
  }
  const config = readClusterConfig(args.values.config)
  if (command === 'dry-run') {
    const result = await preflight(config)
    console.log(
      `Dry run only: no cluster resources created; ${result.blockers.length} blocking credential checks`
    )
    if (result.blockers.length) {
      process.exitCode = 1
    }
    return
  }
  if (command === 'up') {
    await launchCluster(config)
    return
  }
  if (command === 'export-env') {
    await exportClusterInventory(config, localPort)
    return
  }
  const receipt = readReceipt(config)
  if (!receipt) {
    throw new Error('No local ownership receipt; use up with a fresh workload name first')
  }
  const pod = await runningPod(config, receipt)
  if (!pod) {
    console.log('Pod container is not currently running; execution status is unverifiable')
    process.exitCode = 1
    return
  }
  if (command === 'status') {
    const progress = await kubectl(config, [
      'exec',
      pod,
      '-c',
      'orca',
      '--',
      'node',
      '-e',
      "const fs=require('fs');const p='/home/orca/.local/state/orca-cluster/progress.json';console.log(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'{}')"
    ])
    console.log(
      JSON.stringify(
        {
          pod,
          namespace: config.namespace,
          storage: config.storage,
          runDirectory: receipt.runDirectory,
          progress: JSON.parse(progress)
        },
        null,
        2
      )
    )
    return
  }
  if (command === 'verify') {
    console.log(
      await kubectl(
        config,
        [
          'exec',
          pod,
          '-c',
          'orca',
          '--',
          'node',
          '/home/orca/.local/state/orca-cluster/verify.cjs'
        ],
        undefined,
        180_000
      )
    )
    return
  }
  if (command === 'pairing') {
    const link = await kubectl(config, [
      'exec',
      pod,
      '-c',
      'orca',
      '--',
      '/home/orca/.local/bin/orca-host',
      'pairing'
    ])
    console.error(
      `Private link for the loopback tunnel on port ${localPort}; do not share or commit it.`
    )
    console.log(tunnelPairingLink(link, localPort))
    return
  }
  const operation =
    command === 'connect'
      ? ['port-forward', '--address=127.0.0.1', `pod/${pod}`, `${localPort}:6770`]
      : ['exec', '-it', pod, '-c', 'orca', '--', '/bin/bash', '-l']
  const child = spawnProcess({
    program: config.kubectl,
    args: ['--kubeconfig', config.kubeconfig, '-n', config.namespace, ...operation],
    stdio: 'inherit'
  })
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      process.exitCode = code ?? 1
      resolve()
    })
  })
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Cluster operation failed')
  process.exitCode = 1
})
