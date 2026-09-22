import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ClusterConfig } from './cluster-config'
import { collectCredentials } from './cluster-credentials'
import { checkCodexCredential, checkHttpCredentials } from './credential-probes'
import { checkStorage, credentialBlockers } from './storage-checks'
import {
  captureSource,
  dreamteamOpenCodeConfig,
  localPython,
  resolveRepositories,
  sourcePackageManager
} from './cluster-source'
import { resolveTools } from './cluster-tool-plan'
import { checkedProcess, kubectl } from './cluster-process'
import { clusterResources } from './cluster-manifests'
import { podPlanSchema } from './pod-packet'

export async function preflight(config: ClusterConfig, instance = randomUUID()) {
  console.log('Checking selected credentials with read-only requests…')
  const bundle = collectCredentials(config.dreamteam)
  const checks = [
    ...(await checkHttpCredentials(bundle)),
    checkCodexCredential(bundle),
    ...(await checkStorage(
      bundle,
      localPython(config.dreamteam),
      join(config.source, 'extensions/pod-setup/src/storage-credential-probe.py')
    ))
  ]
  for (const check of checks) {
    console.log(
      `${check.service}: ${check.status}${config.allowUnverified.includes(check.service) ? ' (explicitly allowed)' : ''}`
    )
  }
  if (
    !bundle.env.GH_TOKEN ||
    checks.find((check) => check.service === 'github')?.status !== 'verified'
  ) {
    throw new Error('Verified GitHub access is required to clone the repositories')
  }
  const source = await captureSource(config.source, [
    ...Object.values(bundle.env),
    ...Object.values(bundle.candidates)
      .flat()
      .map((candidate) => candidate.value)
  ])
  const repositories = await resolveRepositories(config, bundle.env.GH_TOKEN)
  const packageManager = sourcePackageManager(config.source)
  const identity = async (key: string) =>
    (
      await checkedProcess(
        { program: 'git', args: ['-C', config.source, 'config', '--get', `user.${key}`] },
        `Git ${key}`
      )
    ).trim()
  const plan = podPlanSchema.parse({
    instance,
    name: config.name,
    repositories,
    source,
    packageManager,
    openCodeConfig: dreamteamOpenCodeConfig(config.dreamteam),
    gitIdentity: { name: await identity('name'), email: await identity('email') },
    kubeconfigName: basename(config.kubeconfig),
    allowUnverified: config.allowUnverified,
    tools: await resolveTools(packageManager)
  })
  if (!bundle.files[`.kube/${plan.kubeconfigName}`]) {
    throw new Error('The chosen kubeconfig is not in the portable token-auth allowlist')
  }
  const resources = clusterResources(config, instance)
  for (const resource of resources) {
    await kubectl(
      config,
      ['create', '--dry-run=server', '-f', '-', '-o', 'name'],
      JSON.stringify(resource)
    )
  }
  console.log(
    `Admission dry-run passed: ${config.namespace}/${config.name}, ${config.storage} ${config.persistent ? 'persistent' : 'ephemeral'}, UID 1001, no GPU`
  )
  console.log(`Repository access verified: ${repositories.map((repo) => repo.name).join(', ')}`)
  const blockers = credentialBlockers(checks, config.allowUnverified)
  return { plan, bundle, checks, resources, blockers }
}

export function drivingPrompt(config: ClusterConfig): string {
  const promptFile = config.promptFile ?? process.env.RUN_PROMPT_FILE
  const prompt = promptFile ? readFileSync(promptFile, 'utf8') : process.env.RUN_PROMPT
  if (!prompt?.trim()) {
    throw new Error(
      'Set RUN_PROMPT or config.promptFile to record the driving request before creating resources'
    )
  }
  return prompt
}
