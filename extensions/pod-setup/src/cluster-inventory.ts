import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import type { ClusterConfig } from './cluster-config'
import { readReceipt, runningPod, stateDirectory } from './cluster-state'
import { checkedProcess, kubectl } from './cluster-process'
import { tunnelPairingLink } from './cluster-tunnel'
import { readInventoryFields, writeLocalInventory } from './local-inventory'

export async function exportClusterInventory(config: ClusterConfig, localPort: number) {
  await checkedProcess(
    { program: 'git', args: ['check-ignore', '-q', '.env'], cwd: config.source },
    '.env ignore check'
  )
  const tracked = await checkedProcess(
    { program: 'git', args: ['ls-files', '--', '.env'], cwd: config.source },
    '.env tracking check'
  )
  if (tracked.trim()) {
    throw new Error('Refusing to write credentials into tracked .env')
  }
  const receipt = readReceipt(config)
  if (!receipt) {
    throw new Error('No ownership receipt for this pod')
  }
  const pod = await runningPod(config, receipt)
  if (!pod) {
    throw new Error('Pod contact is unverifiable; existing inventory was preserved')
  }
  const link = await kubectl(config, [
    'exec',
    pod,
    '-c',
    'orca',
    '--',
    '/home/orca/.local/bin/orca-host',
    'pairing'
  ])
  const quote = (value: string) => {
    const path = process.platform === 'win32' ? value.replaceAll('\\', '/') : value
    if (/["$`\\\r\n]/.test(path)) {
      throw new Error('Unsupported command argument in inventory')
    }
    return `"${path}"`
  }
  const kube = `${quote(config.kubectl)} --kubeconfig ${quote(config.kubeconfig)} -n ${quote(config.namespace)}`
  const make = `cd ${quote(config.source)} && RUN_PROMPT_FILE=${quote(join(receipt.runDirectory ?? '', 'prompt.txt'))} make -f extensions/pod-setup/Makefile`
  const savedConfig = join(stateDirectory(config), 'launch-config.json')
  writeFileSync(savedConfig, JSON.stringify(config, null, 2), { mode: 0o600 })
  const path = join(config.source, '.env')
  writeLocalInventory(path, config.name, {
    PHONE_STATUS: 'pending: dedicated Tailscale device authorization and mobile-scoped pairing',
    PHONE_INSTRUCTIONS:
      'Phone must run Tailscale in the same tailnet. Pair directly to this pod using its own mobile-scoped link; never scan the laptop loopback link. Physical phone validation is a separate step.',
    ...readInventoryFields(path, config.name),
    DEPLOYMENT: config.name,
    POD: pod,
    NAMESPACE: config.namespace,
    KUBECONFIG: config.kubeconfig,
    PVC: `${config.name}-home`,
    STORAGE: config.storage,
    USER: 'orca',
    UID: '1001',
    HOME: '/home/orca',
    IMAGE: config.image,
    REPOSITORIES: receipt.plan.repositories.map((repo) => repo.name).join(','),
    SOURCE_COMMIT: receipt.plan.source.commit,
    SOURCE_OVERLAY_SHA256: receipt.plan.source.digest,
    RUN_DIRECTORY: receipt.runDirectory ?? '',
    EXEC: `${kube} exec -it deployment/${config.name} -c orca -- /bin/bash -l`,
    SETUP: `${make} up CONFIG=${quote(savedConfig)} LOCAL_PORT=${localPort}`,
    VERIFY: `${make} verify CONFIG=${quote(savedConfig)} LOCAL_PORT=${localPort}`,
    TUNNEL: `${kube} port-forward --address=127.0.0.1 deployment/${config.name} ${localPort}:6770`,
    LAPTOP_ENDPOINT: `ws://127.0.0.1:${localPort}`,
    LAPTOP_PAIRING_LINK: tunnelPairingLink(link, localPort),
    LAPTOP_INSTRUCTIONS:
      'Keep TUNNEL running. Settings > Remote Orca Servers > Connect to a host > Add Server. Paste LAPTOP_PAIRING_LINK; under Advanced enable I am using an SSH tunnel. Select this host as Active Server.',
    NOTION: 'missing; explicitly waived',
    UPDATED_AT: new Date().toISOString()
  })
  console.log(`Private inventory updated: ${path} (${config.name}); pairing credentials withheld`)
}
