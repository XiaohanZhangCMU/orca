import { join } from 'node:path'
import { collectCredentials } from './cluster-credentials'
import { checkCodexCredential, checkHttpCredentials } from './credential-probes'
import { checkStorage, credentialBlockers } from './storage-checks'
import { checkedProcess } from './cluster-process'
import { podEnvironment, podHome, podState, readPodPlan } from './pod-environment'
import { readHostConfig } from './host-config'
import { hostStatus } from './host-control'

async function main() {
  const plan = readPodPlan()
  Object.assign(process.env, podEnvironment(true))
  const bundle = collectCredentials(join(podHome, 'Codes/dreamteam'), podHome)
  const checks = [
    ...(await checkHttpCredentials(bundle)),
    checkCodexCredential(bundle),
    ...(await checkStorage(
      bundle,
      join(podHome, '.local/share/orca-python/bin/python'),
      join(podState, 'storage-credential-probe.py')
    ))
  ]
  const env = { ...podEnvironment(true), KUBECONFIG: join(podHome, '.kube', plan.kubeconfigName) }
  const tools: Record<string, string> = {}
  for (const program of [
    'git',
    'gh',
    'claude',
    'opencode',
    'codex',
    'uv',
    'truss',
    'wandb',
    'hf'
  ]) {
    tools[program] = (
      await checkedProcess({ program, args: ['--version'], env }, `${program} version`)
    )
      .trim()
      .slice(0, 200)
  }
  await checkedProcess(
    { program: 'gh', args: ['api', 'user', '--jq', '.id'], env },
    'GitHub CLI authentication'
  )
  const models = (
    await checkedProcess(
      { program: 'opencode', args: ['models', 'baseten-k3'], env, timeoutMs: 90_000 },
      'OpenCode model discovery'
    )
  )
    .split('\n')
    .filter((line) => line.startsWith('baseten-k3/'))
  if (!models.length) {
    throw new Error('OpenCode returned no configured Baseten models')
  }
  const access = (
    await checkedProcess(
      { program: 'kubectl', args: ['--request-timeout=15s', 'auth', 'can-i', 'get', 'pods'], env },
      'Kubernetes credential check'
    )
  ).trim()
  if (access !== 'yes') {
    throw new Error('Kubernetes pod access was not confirmed')
  }
  const host = await hostStatus(readHostConfig(join(podHome, '.local/share/orca-pod-host')))
  const blocked = credentialBlockers(checks, plan.allowUnverified)
  console.log(
    JSON.stringify(
      {
        uid: process.getuid?.(),
        host,
        checks,
        tools,
        models,
        kubernetes: access,
        blocked: blocked.map((check) => check.service)
      },
      null,
      2
    )
  )
  if (!host.ready || blocked.length) {
    process.exitCode = 1
  }
}
main().catch(() => {
  console.error('Pod verification failed; credential-bearing details withheld')
  process.exitCode = 1
})
