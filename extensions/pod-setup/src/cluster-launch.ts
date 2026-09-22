import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClusterConfig } from './cluster-config'
import { checkedProcess, kubectl } from './cluster-process'
import { drivingPrompt, preflight } from './cluster-preflight'
import {
  ownedObject,
  readReceipt,
  runningPod,
  stateDirectory,
  writeReceipt,
  type ClusterReceipt
} from './cluster-state'
import { podPacketSchema } from './pod-packet'
import { collectCredentials } from './cluster-credentials'
import { checkHttpCredentials } from './credential-probes'
import { credentialBlockers } from './storage-checks'
import { clusterResources } from './cluster-manifests'

const remoteState = '/home/orca/.local/state/orca-cluster'

async function recordLaunch(config: ClusterConfig, receipt: ClusterReceipt, prompt: string) {
  if (receipt.runDirectory) {
    return
  }
  const local = stateDirectory(config)
  const manifest = join(local, 'resources.json')
  const launchConfig = join(local, 'launch-config.json')
  writeFileSync(launchConfig, JSON.stringify(config, null, 2), { mode: 0o600 })
  writeFileSync(
    manifest,
    JSON.stringify(clusterResources(config, receipt.plan.instance), null, 2),
    { mode: 0o600 }
  )
  const skill = join(config.dreamteam, 'vertical/shared/harness/baseten_skills')
  const directory = (
    await checkedProcess(
      {
        program: 'bash',
        args: [
          join(skill, 'record_run.sh'),
          'k8s-cpu',
          config.name,
          receipt.plan.instance,
          `${config.namespace}/${config.name}`,
          'Non-root Orca CPU workstation'
        ],
        env: {
          ...process.env,
          RUN_PROMPT: prompt,
          RUN_PROMPT_FILE: '',
          RUN_SKIP_DB_RECORD: '1',
          IMAGE: config.image,
          GPU_COUNT: '0',
          ACCELERATOR: 'CPU',
          NODE_COUNT: '1',
          RUN_HARDWARE: `CPU-only; ${config.cpuRequest} CPU/${config.memoryRequest} requested; ${config.cpuLimit} CPU/${config.memoryLimit} limit; ${config.storage} persistent home`,
          RUN_FOLDER_SCRIPTS: join(config.source, 'out/pod-setup'),
          RUN_FOLDER_CONFIGS: manifest,
          RUN_SKILL_DIR: skill,
          RUN_CMD: `make -f extensions/pod-setup/Makefile up CONFIG='${launchConfig.replaceAll("'", "'\\''")}'`
        },
        timeoutMs: 60_000
      },
      'run ledger'
    )
  )
    .trim()
    .split('\n')
    .at(-1)
  if (!directory || !existsSync(join(directory, 'prompt.txt'))) {
    throw new Error('Canonical run ledger was not confirmed; resources retained for inspection')
  }
  appendFileSync(
    join(directory, 'README.md'),
    `\n## Actual pod source pins\n\n${receipt.plan.repositories.map((repo) => `- ${repo.name}: ${repo.name === 'orca' ? receipt.plan.source.branch : repo.branch} @ ${repo.name === 'orca' ? receipt.plan.source.commit : repo.commit}`).join('\n')}\n\nOrca working-tree overlay SHA256: ${receipt.plan.source.digest}. The canonical ledger's local trainers/loops snapshot above is reference only; the pod uses these pinned commits.\n`
  )
  writeFileSync(
    join(directory, 'configs/source-overlay.json'),
    JSON.stringify(receipt.plan.source),
    { mode: 0o600 }
  )
  writeFileSync(join(directory, 'configs/pod-plan.json'), JSON.stringify(receipt.plan, null, 2), {
    mode: 0o600
  })
  writeFileSync(join(directory, 'configs/launch-config.json'), JSON.stringify(config, null, 2), {
    mode: 0o600
  })
  receipt.runDirectory = directory
  writeReceipt(config, receipt)
  console.log(`Run recorded: ${directory}`)
}

export async function launchCluster(
  config: ClusterConfig,
  report: (phase: string) => void = () => {}
) {
  const prompt = drivingPrompt(config)
  let receipt = readReceipt(config)
  let bundle
  if (!receipt) {
    const checked = await preflight(config)
    if (checked.blockers.length) {
      throw new Error(
        `Credential preflight blocked: ${checked.blockers.map((row) => row.service).join(', ')}`
      )
    }
    receipt = { config, plan: checked.plan }
    bundle = checked.bundle
    await ownedObject(config, 'deployment', config.name, receipt.plan.instance)
    if (config.persistent) {
      await ownedObject(config, 'pvc', `${config.name}-home`, receipt.plan.instance)
    }
    writeReceipt(config, receipt)
  }
  for (const resource of clusterResources(config, receipt.plan.instance)) {
    report('Creating the persistent volume and non-root CPU pod')
    const key = resource.kind === 'PersistentVolumeClaim' ? 'pvcUid' : 'deploymentUid'
    if (
      !(await ownedObject(
        config,
        resource.kind,
        resource.metadata.name,
        receipt.plan.instance,
        receipt[key]
      ))
    ) {
      const created = JSON.parse(
        await kubectl(config, ['create', '-f', '-', '-o', 'json'], JSON.stringify(resource))
      )
      receipt[key] = created.metadata.uid
      writeReceipt(config, receipt)
    }
  }
  await recordLaunch(config, receipt, prompt)
  let pod = await runningPod(config, receipt)
  for (let attempt = 0; !pod && attempt < 90; attempt++) {
    console.log('Waiting for the new pod container and persistent volume…')
    report('Waiting for the pod container and persistent volume')
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    pod = await runningPod(config, receipt)
  }
  if (!pod) {
    throw new Error(
      'New pod is not running yet; resources were retained. Inspect status before retrying'
    )
  }
  const complete = await kubectl(config, [
    'exec',
    pod,
    '-c',
    'orca',
    '--',
    'node',
    '-e',
    `const fs=require('fs');const p='${remoteState}/progress.json';console.log(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'{}')`
  ])
  if (JSON.parse(complete).state === 'complete') {
    console.log(`Already ready: ${pod}`)
    return
  }
  if (!bundle) {
    bundle = collectCredentials(config.dreamteam)
    const checks = await checkHttpCredentials(bundle)
    if (credentialBlockers(checks, config.allowUnverified).length) {
      throw new Error('Credential preflight failed during resume')
    }
  }
  const built = (name: string) =>
    readFileSync(join(config.source, 'out/pod-setup', name)).toString('base64')
  const packet = podPacketSchema.parse({
    ...receipt.plan,
    files: bundle.files,
    env: bundle.env,
    bootstrap: built('pod-bootstrap.cjs'),
    services: built('pod-services.cjs'),
    verifier: built('pod-verify.cjs'),
    controller: built('pod-setup.cjs'),
    storageProbe: readFileSync(
      join(config.source, 'extensions/pod-setup/src/storage-credential-probe.py')
    ).toString('base64')
  })
  const receiver = built('pod-transfer.cjs')
  report('Transferring the allowlisted credentials and pinned setup')
  const upload = `const fs=require('fs');if(process.getuid()!==1001)throw Error('Wrong user');let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{const d='${remoteState}';fs.mkdirSync(d,{recursive:true,mode:448});const p=d+'/transfer.cjs';const b=Buffer.from(data,'base64');if(fs.existsSync(p)){if(!fs.readFileSync(p).equals(b))throw Error('Receiver differs')}else fs.writeFileSync(p,b,{flag:'wx',mode:384});})`
  await kubectl(config, ['exec', '-i', pod, '-c', 'orca', '--', 'node', '-e', upload], receiver)
  const transfer = await kubectl(
    config,
    ['exec', '-i', pod, '-c', 'orca', '--', 'node', `${remoteState}/transfer.cjs`],
    JSON.stringify(packet),
    120_000
  )
  console.log(`Private transfer: ${transfer.trim()}`)
  await kubectl(config, [
    'exec',
    pod,
    '-c',
    'orca',
    '--',
    'node',
    `${remoteState}/bootstrap.cjs`,
    'start'
  ])
  console.log(`Bootstrap started on ${pod}; it survives laptop disconnects.`)
  let last = ''
  for (let attempt = 0; attempt < 360; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    const progress = JSON.parse(
      await kubectl(config, [
        'exec',
        pod,
        '-c',
        'orca',
        '--',
        'node',
        '-e',
        `console.log(require('fs').readFileSync('${remoteState}/progress.json','utf8'))`
      ])
    )
    if (progress.phase !== last || attempt % 5 === 0) {
      report(String(progress.phase))
      console.log(progress.phase)
      last = progress.phase
    }
    if (progress.state === 'failed') {
      throw new Error(
        'Pod bootstrap failed; use status and inspect its private bootstrap log. No existing sessions were stopped'
      )
    }
    if (progress.state === 'complete') {
      console.log(`Ready: ${pod}. Run make -f extensions/pod-setup/Makefile verify or shell.`)
      return
    }
  }
  throw new Error('Bootstrap is still running; use status. It has not been stopped')
}
