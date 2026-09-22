import { runProcess, type ProcessSpec } from '../../../src/shared/child-process/run-process'
import type { ClusterConfig } from './cluster-config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function checkedProcess(spec: ProcessSpec, label: string): Promise<string> {
  const result = await runProcess({ timeoutMs: 30_000, maxOutputBytes: 4 * 1024 * 1024, ...spec })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    if (
      process.platform === 'linux' &&
      process.getuid?.() === 1001 &&
      process.env.ORCA_POD_SETUP_DIAGNOSTICS === '1'
    ) {
      const directory = '/home/orca/.local/state/orca-cluster/diagnostics'
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      writeFileSync(
        join(directory, `${randomUUID()}.log`),
        `${label}\n${result.stdout}\n${result.stderr}`,
        { mode: 0o600, flag: 'wx' }
      )
    }
    // Child stderr may contain tokens, remote URLs, or credential-bearing configuration.
    throw new Error(
      `${label} failed (exit=${result.code}, timeout=${result.timedOut}, truncated=${Boolean(result.outputTruncated)}); output withheld`
    )
  }
  return result.stdout
}

export function kubectl(
  config: ClusterConfig,
  args: string[],
  input?: string,
  timeoutMs = 30_000
): Promise<string> {
  return checkedProcess(
    {
      program: config.kubectl,
      args: [
        '--kubeconfig',
        config.kubeconfig,
        `--request-timeout=${args[0] === 'exec' ? '0' : '20s'}`,
        '-n',
        config.namespace,
        ...args
      ],
      input,
      timeoutMs
    },
    `kubectl ${args[0]}`
  )
}
