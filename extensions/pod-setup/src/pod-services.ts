import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkedProcess } from './cluster-process'
import { readHostConfig } from './host-config'
import { hostStatus, startHost } from './host-control'
import { podEnvironment, podHome, readPodPlan } from './pod-environment'

async function main() {
  const plan = readPodPlan()
  Object.assign(process.env, podEnvironment(true), {
    KUBECONFIG: join(podHome, '.kube', plan.kubeconfigName)
  })
  const config = readHostConfig(join(podHome, '.local/share/orca-pod-host'))
  await startHost(config)
  if (existsSync(join(podHome, '.local/share/orca-tailnet-proxy/phone.json'))) {
    await checkedProcess(
      {
        program: process.execPath,
        args: [join(podHome, '.local/share/orca-tailnet-proxy/pod-phone.cjs'), 'start']
      },
      'Resume private phone access'
    ).catch(() => {
      console.error(
        'Private phone access could not resume; Orca remains available through its desktop tunnel.'
      )
    })
  }
  console.log(JSON.stringify(await hostStatus(config)))
}
main().catch(() => {
  console.error('Orca startup failed; inspect the private server log')
  process.exitCode = 1
})
