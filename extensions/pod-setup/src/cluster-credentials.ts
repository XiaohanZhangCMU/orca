import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseDotenv } from 'dotenv'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

export type CredentialCandidate = { source: string; value: string }
export type CredentialBundle = {
  files: Record<string, string>
  env: Record<string, string>
  candidates: Record<string, CredentialCandidate[]>
  sources: { path: string; bytes: number }[]
}
const portableFiles = [
  '.wasabi/access_key',
  '.aws/credentials',
  '.trussrc',
  '.rancher/api_key',
  '.config/baseten/parsed_api_token',
  '.config/baseten/xiaohan_api_token',
  '.config/baseten/multi_lora_api_token',
  '.config/baseten/fde_smoke_token',
  '.config/baseten/trussrc_xiaohan',
  '.config/tinker/api_key',
  '.config/linear/api_key',
  '.config/notion/api_key',
  '.codex/auth.json'
]
const environmentNames = [
  'LINEAR_API_KEY',
  'NOTION_API_KEY',
  'NOTION_TOKEN_WORK',
  'HF_TOKEN',
  'WANDB_API_KEY',
  'WANDB_API_KEY_WORK',
  'TINKER_API_KEY',
  'BASETEN_API_KEY',
  'BASETEN_INFERENCE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'DAHAN_RUNS_DATABASE_URL',
  'NEON_API_KEY'
]

export function privateSource(path: string): string | null {
  if (!existsSync(path)) {
    return null
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
    throw new Error(`Credential source must be a regular file under 1 MiB: ${path}`)
  }
  return readFileSync(path, 'utf8')
}

export function iniSections(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {}
  let section = ''
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([\w -]+)\]\s*$/)
    if (heading) {
      section = heading[1]
      sections[section] ??= {}
      continue
    }
    const match = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/)
    if (match && section) {
      sections[section][match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return sections
}

export function collectCredentials(dreamteam: string, home = homedir()): CredentialBundle {
  const bundle: CredentialBundle = { files: {}, env: {}, candidates: {}, sources: [] }
  const dotenv = parseDotenv(privateSource(join(dreamteam, '.env')) ?? '')
  for (const name of environmentNames) {
    const value = process.env[name] || dotenv[name]
    if (value && !/^(?:your[-_ ]|placeholder|changeme|xxx)/i.test(value)) {
      bundle.env[name] = value
    }
  }
  const read = (relative: string) => privateSource(join(home, relative))
  for (const relative of portableFiles) {
    const value = read(relative)
    if (value?.trim()) {
      bundle.files[relative] = value
    }
  }
  const kubeDir = join(home, '.kube')
  if (existsSync(kubeDir)) {
    for (const name of readdirSync(kubeDir).filter((name) => /^[\w-]+-token\.yaml$/.test(name))) {
      const value = read(`.kube/${name}`)
      if (!value) {
        continue
      }
      const parsed = z
        .object({
          users: z.array(z.object({ user: z.record(z.string(), z.unknown()) })),
          clusters: z.array(z.object({ cluster: z.record(z.string(), z.unknown()) }))
        })
        .parse(parseYaml(value))
      if (
        parsed.users.some(
          (user) => user.user.exec || user.user['client-key'] || user.user['client-certificate']
        ) ||
        parsed.clusters.some((cluster) => cluster.cluster['certificate-authority'])
      ) {
        throw new Error(`Kubeconfig is not portable token auth: ${name}`)
      }
      bundle.files[`.kube/${name}`] = value
    }
  }
  const candidates = (service: string, entries: (CredentialCandidate | null)[]) => {
    const seen = new Set<string>()
    bundle.candidates[service] = entries.filter((entry): entry is CredentialCandidate => {
      if (!entry?.value.trim() || seen.has(entry.value.trim())) {
        return false
      }
      entry.value = entry.value.trim()
      seen.add(entry.value)
      return true
    })
  }
  const file = (relative: string): CredentialCandidate | null => {
    const value = read(relative)?.trim()
    return value ? { source: `~/${relative}`, value } : null
  }
  const env = (name: string): CredentialCandidate | null =>
    bundle.env[name] ? { source: `environment:${name}`, value: bundle.env[name] } : null
  candidates('github', [file('.github_token'), env('GH_TOKEN'), env('GITHUB_TOKEN')])
  candidates('linear', [file('.config/linear/api_key'), env('LINEAR_API_KEY')])
  candidates('notion', [
    file('.config/notion/api_key'),
    env('NOTION_API_KEY'),
    env('NOTION_TOKEN_WORK')
  ])
  candidates('wandb', [file('.wandb_token'), env('WANDB_API_KEY'), env('WANDB_API_KEY_WORK')])
  candidates('tinker', [file('.config/tinker/api_key'), env('TINKER_API_KEY')])
  candidates('anthropic', [file('.anthropic_api_key'), env('ANTHROPIC_API_KEY')])
  candidates('openai', [file('.openai_api_key'), env('OPENAI_API_KEY')])
  candidates('rancher', [file('.rancher/api_key')])
  candidates('huggingface', [
    env('HF_TOKEN'),
    ...[...new Set((read('.hf_access_token') ?? '').match(/\bhf_[A-Za-z0-9]+\b/g) ?? [])].map(
      (value, index) => ({ source: `~/.hf_access_token candidate ${index + 1}`, value })
    )
  ])
  const truss = iniSections(bundle.files['.trussrc'] ?? '').baseten
  candidates('baseten', [
    truss?.api_key ? { source: '~/.trussrc [baseten]', value: truss.api_key } : null,
    env('BASETEN_API_KEY')
  ])
  candidates('baseten-inference', [
    file('.config/baseten/parsed_api_token'),
    env('BASETEN_INFERENCE_API_KEY'),
    env('BASETEN_API_KEY')
  ])
  bundle.sources = Object.entries(bundle.files).map(([path, value]) => ({
    path,
    bytes: Buffer.byteLength(value)
  }))
  return bundle
}

const canonical: Record<string, { env: string; file?: string }> = {
  github: { env: 'GH_TOKEN', file: '.github_token' },
  linear: { env: 'LINEAR_API_KEY', file: '.config/linear/api_key' },
  notion: { env: 'NOTION_API_KEY', file: '.config/notion/api_key' },
  huggingface: { env: 'HF_TOKEN', file: '.hf_access_token' },
  wandb: { env: 'WANDB_API_KEY', file: '.wandb_token' },
  tinker: { env: 'TINKER_API_KEY', file: '.config/tinker/api_key' },
  anthropic: { env: 'ANTHROPIC_API_KEY', file: '.anthropic_api_key' },
  openai: { env: 'OPENAI_API_KEY' },
  baseten: { env: 'BASETEN_API_KEY' },
  'baseten-inference': {
    env: 'BASETEN_INFERENCE_API_KEY',
    file: '.config/baseten/parsed_api_token'
  }
}
export function selectCredential(
  bundle: CredentialBundle,
  service: string,
  candidate: CredentialCandidate
): void {
  const target = canonical[service]
  if (!target) {
    return
  }
  bundle.env[target.env] = candidate.value
  if (target.file) {
    bundle.files[target.file] = `${candidate.value}\n`
  }
  if (service === 'github') {
    bundle.env.GITHUB_TOKEN = candidate.value
  }
  if (service === 'huggingface') {
    bundle.files['.cache/huggingface/token'] = candidate.value
  }
  if (service === 'notion') {
    bundle.env.NOTION_TOKEN_WORK = candidate.value
  }
  if (service === 'baseten-inference') {
    bundle.env.BASETEN_INFERENCE_API_KEY = candidate.value
  }
}
