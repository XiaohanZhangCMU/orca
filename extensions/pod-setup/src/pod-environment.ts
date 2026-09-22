import { readFileSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { podPlanSchema } from './pod-packet'

export const podHome = '/home/orca'
export const podState = join(podHome, '.local/state/orca-cluster')
export function readPodPlan() {
  if (process.platform !== 'linux' || process.getuid?.() !== 1001 || process.arch !== 'x64') {
    throw new Error('Expected the dedicated Linux x64 pod user')
  }
  process.umask(0o077)
  const stat = lstatSync(podHome)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 1001) {
    throw new Error('Unexpected pod home ownership')
  }
  const plan = podPlanSchema.parse(JSON.parse(readFileSync(join(podState, 'plan.json'), 'utf8')))
  if (
    JSON.parse(readFileSync(join(podHome, '.orca-cluster-owner.json'), 'utf8')).instance !==
    plan.instance
  ) {
    throw new Error('Pod volume identity mismatch')
  }
  return plan
}
export function podEnvironment(credentials = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: podHome,
    USER: 'orca',
    LOGNAME: 'orca',
    SHELL: '/bin/bash',
    LANG: 'C.UTF-8',
    PATH: `${podHome}/.local/bin:${podHome}/.local/share/orca-toolchain/node_modules/.bin:${podHome}/.local/share/orca-python/bin:/usr/local/bin:/usr/bin:/bin`,
    ORCA_BACKGROUND_LAUNCH: '1',
    GIT_TERMINAL_PROMPT: '0',
    CI: '1',
    OPENCODE_CONFIG: `${podHome}/.config/opencode/opencode.json`
  }
  if (credentials) {
    Object.assign(
      env,
      z
        .record(z.string(), z.string())
        .parse(JSON.parse(readFileSync(`${podHome}/.config/orca-pod/credentials.json`, 'utf8')))
    )
  }
  return env
}
