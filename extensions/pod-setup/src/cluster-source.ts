import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { checkedProcess } from './cluster-process'
import { dreamteamRepositories, type ClusterConfig, type RepositoryPlan } from './cluster-config'

export type SourceOverlay = {
  commit: string
  branch: string
  patch: string
  files: Record<string, string>
  digest: string
}
export async function captureSource(
  source: string,
  secretValues: string[]
): Promise<SourceOverlay> {
  const git = (args: string[]) =>
    checkedProcess(
      { program: 'git', args: ['-C', source, ...args], maxOutputBytes: 32 * 1024 * 1024 },
      'source snapshot'
    )
  const commit = (await git(['rev-parse', 'HEAD'])).trim()
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const patch = await git(['diff', '--binary', 'HEAD'])
  const names = (await git(['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean)
  const files: Record<string, string> = {}
  for (const name of names) {
    if (!/^(?:extensions|src|config|docs|tests|\.github)\//.test(name)) {
      continue
    }
    if (
      name
        .split('/')
        .some(
          (part) => part === '..' || part === 'node_modules' || part === '.env' || part === '.git'
        )
    ) {
      throw new Error('Unexpected source snapshot path')
    }
    const file = join(source, name)
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) {
      throw new Error(`Unsupported source artifact: ${name}`)
    }
    files[name] = readFileSync(file).toString('base64')
  }
  for (const secret of secretValues.filter((value) => value.length >= 16)) {
    if (
      patch.includes(secret) ||
      Object.values(files).some((value) => Buffer.from(value, 'base64').includes(secret))
    ) {
      throw new Error('A credential value appeared in the source snapshot; refusing to ship it')
    }
  }
  const digest = createHash('sha256').update(JSON.stringify({ commit, patch, files })).digest('hex')
  return { commit, branch, patch, files, digest }
}

export async function resolveRepositories(
  config: ClusterConfig,
  githubToken: string
): Promise<RepositoryPlan[]> {
  const repos = dreamteamRepositories(
    readFileSync(join(config.dreamteam, 'src/dreamteam/deck/workersetup.py'), 'utf8')
  )
  const query = `{ ${repos
    .map((repo, index) => {
      const [owner, name] = repo.slug.split('/')
      return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { defaultBranchRef { name target { oid } } }`
    })
    .join(' ')} }`
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) {
    throw new Error(`Git repository access check failed: HTTP ${response.status}`)
  }
  const shape = z.object({
    data: z.record(
      z.string(),
      z.object({
        defaultBranchRef: z.object({
          name: z.string(),
          target: z.object({ oid: z.string().regex(/^[a-f0-9]{40}$/) })
        })
      })
    ),
    errors: z.undefined().optional()
  })
  const result = shape.safeParse(await response.json())
  if (!result.success) {
    throw new Error('GitHub did not confirm access to every repository')
  }
  return repos.map((repo, index) => ({
    ...repo,
    branch: result.data.data[`r${index}`].defaultBranchRef.name,
    commit: result.data.data[`r${index}`].defaultBranchRef.target.oid
  }))
}

export function dreamteamOpenCodeConfig(dreamteam: string): string {
  const source = readFileSync(join(dreamteam, 'src/dreamteam/deck/workersetup.py'), 'utf8')
  const value = source.match(/^OPENCODE_CONFIG = """([\s\S]*?)^"""/m)?.[1]
  if (!value) {
    throw new Error('Dreamteam OpenCode configuration was not recognized')
  }
  JSON.parse(value)
  return value.replaceAll('{env:BASETEN_API_KEY}', '{env:BASETEN_INFERENCE_API_KEY}')
}

export function sourcePackageManager(source: string): string {
  const pkg = z
    .object({
      packageManager: z
        .string()
        .regex(/^pnpm@\d+\.\d+\.\d+(?:\+sha(?:224|256|384|512)\.[a-f0-9]+)?$/)
    })
    .parse(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')))
  return pkg.packageManager.split('+')[0]
}

export function localPython(dreamteam: string): string {
  const binary = join(
    dreamteam,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  )
  if (!existsSync(binary)) {
    throw new Error('Dreamteam Python environment is missing; run its documented bootstrap first')
  }
  return binary
}
