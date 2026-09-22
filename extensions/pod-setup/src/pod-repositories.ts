import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { PodPlan } from './pod-packet'
import { checkedProcess } from './cluster-process'
import { podEnvironment, podHome, podState } from './pod-environment'
import { installPrivateFile } from './pod-private-files'

export async function cloneRepositories(plan: PodPlan): Promise<void> {
  const env = podEnvironment(true)
  const git = (args: string[], cwd = podHome, input?: string) =>
    checkedProcess(
      {
        program: 'git',
        args,
        cwd,
        env,
        input,
        timeoutMs: 900_000,
        maxOutputBytes: 4 * 1024 * 1024
      },
      'repository operation'
    )
  for (const [field, value] of Object.entries(plan.gitIdentity)) {
    if (value) {
      await git(['config', '--global', `user.${field}`, value])
    }
  }
  await git([
    'config',
    '--global',
    'credential.https://github.com.helper',
    '!gh auth git-credential'
  ])
  const codes = join(podHome, 'Codes')
  mkdirSync(codes, { recursive: true, mode: 0o700 })
  for (const repo of plan.repositories) {
    console.log(`repo:${repo.name}`)
    const destination = join(codes, repo.name)
    const url = `https://github.com/${repo.slug}.git`
    const commit = repo.name === 'orca' ? plan.source.commit : repo.commit
    if (existsSync(destination)) {
      if ((await git(['remote', 'get-url', 'origin'], destination)).trim() !== url) {
        throw new Error(`Existing repository ${repo.name} is not the expected origin`)
      }
      continue
    }
    const stage = mkdtempSync(join(codes, `.clone-${repo.name}-`))
    await git(['init', '--quiet'], stage)
    await git(['remote', 'add', 'origin', url], stage)
    await git(['-c', 'gc.auto=0', 'fetch', '--depth=1', 'origin', commit], stage)
    await git(['checkout', '-b', 'pod-bootstrap', 'FETCH_HEAD'], stage)
    if ((await git(['rev-parse', 'HEAD'], stage)).trim() !== commit) {
      throw new Error('Fetched commit does not match the plan')
    }
    if (repo.name === 'orca') {
      const { patch, files } = plan.source
      const digest = createHash('sha256')
        .update(JSON.stringify({ commit, patch, files }))
        .digest('hex')
      if (digest !== plan.source.digest) {
        throw new Error('Orca source overlay digest mismatch')
      }
      if (patch) {
        await git(['apply', '--check', '-'], stage, patch)
        await git(['apply', '-'], stage, patch)
      }
      for (const [name, bytes] of Object.entries(files)) {
        if (installPrivateFile(stage, name, Buffer.from(bytes, 'base64')) === 'preserved') {
          throw new Error('Source overlay would overwrite a file')
        }
      }
      writeFileSync(join(stage, '.git/orca-source.json'), JSON.stringify({ digest, commit }), {
        mode: 0o600,
        flag: 'wx'
      })
    }
    renameSync(stage, destination)
  }
  const actual = await Promise.all(
    plan.repositories.map(async (repo) => ({
      ...repo,
      actualCommit: (await git(['rev-parse', 'HEAD'], join(codes, repo.name))).trim()
    }))
  )
  writeFileSync(join(podState, 'repositories.json'), JSON.stringify(actual, null, 2), {
    mode: 0o600
  })
  const overlay = JSON.parse(readFileSync(join(codes, 'orca/.git/orca-source.json'), 'utf8'))
  if (overlay.digest !== plan.source.digest) {
    throw new Error('Existing Orca source differs; no reset or overwrite attempted')
  }
}
