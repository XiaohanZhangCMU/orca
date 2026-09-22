import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import { hostAccessLink, closeHostTunnels } from '../../../src/main/baseten-hosts/host-tunnels'
import { hostPod } from '../src/desktop-inventory'
import { kubectl } from '../src/cluster-process'

async function main() {
  const name = process.argv[2]
  if (!name) {
    throw new Error('Pass the name of an existing, receipted host; this test never creates pods.')
  }
  const profile = mkdtempSync(join(tmpdir(), 'orca-host-access-test-'))
  try {
    const { config, pod } = await hostPod(name)
    const link = await kubectl(config, [
      'exec',
      pod,
      '-c',
      'orca',
      '--',
      '/home/orca/.local/bin/orca-host',
      'pairing'
    ])
    const access = await hostAccessLink(name, {
      link: link.trim(),
      kubectl: config.kubectl,
      kubeconfig: config.kubeconfig,
      namespace: config.namespace,
      pod
    })
    const client = new RuntimeClient(profile, 30_000, access, null)
    const status = (await client.call<{ runtimeId: string; graphStatus: string }>('status.get'))
      .result
    const repos = (await client.call<{ repos: { path: string }[] }>('repo.list')).result
    const folders = (
      await client.call<{ folderWorkspaces: { folderPath: string }[] }>('folderWorkspace.list')
    ).result
    if (
      status.graphStatus !== 'ready' ||
      repos.repos.length < 8 ||
      !folders.folderWorkspaces.some((folder) => folder.folderPath === '/home/orca/Codes/workspace')
    ) {
      throw new Error('The host did not report the expected ready workspace and repositories')
    }
    console.log(
      JSON.stringify({
        host: name,
        runtimeId: status.runtimeId,
        encryptedRpc: 'verified',
        repositories: repos.repos.length,
        folderWorkspace: 'verified'
      })
    )
  } finally {
    closeHostTunnels()
    rmSync(profile, { recursive: true, force: true })
  }
}
main().catch(() => {
  console.error('Host access smoke check failed; no remote work was changed. Inspect host status.')
  process.exitCode = 1
})
