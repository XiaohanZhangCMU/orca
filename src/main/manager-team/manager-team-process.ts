import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { runProcess } from '../../shared/child-process/run-process'

export async function resolveManagerAssets(): Promise<{ publisher: string; orca: string }> {
  const root = getAppEnvironment()
    .getAppPath()
    .replace(/\.asar$/, '.asar.unpacked')
  for (const directory of [join(root, 'out', 'manager'), join(root, 'manager')]) {
    const publisher = join(directory, 'orca-manager.cjs')
    const orca = join(directory, 'orca.cjs')
    try {
      await Promise.all([access(publisher), access(orca)])
      return { publisher, orca }
    } catch {
      /* Try the Node-host layout. */
    }
  }
  throw new Error(
    'Manager assets are missing on this host. Build this fork with pnpm build:manager (desktop) or pnpm build:server (server).'
  )
}

export async function callManager(
  publisher: string,
  workspace: string,
  args: string[]
): Promise<unknown> {
  const env = { ...process.env }
  // An inherited client selection must never move host-owned work to another runtime.
  delete env.ORCA_ENVIRONMENT
  delete env.ORCA_PAIRING_CODE
  const result = await runProcess({
    program: process.execPath,
    args: [publisher, ...args],
    cwd: workspace,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_USER_DATA_PATH: getAppEnvironment().getPath('userData')
    },
    timeoutMs: 120_000,
    maxOutputBytes: 1024 * 1024
  })
  if (result.timedOut || result.outputTruncated) {
    throw new Error(
      'Manager launch is unverifiable. Inspect the saved run before starting another team.'
    )
  }
  if (result.code !== 0) {
    throw new Error(
      result.stderr.slice(0, 4000) || 'Manager command failed; inspect the saved run.'
    )
  }
  return JSON.parse(result.stdout)
}
