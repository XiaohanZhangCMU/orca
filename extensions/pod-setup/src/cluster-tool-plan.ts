import { z } from 'zod'
import type { PodPlan } from './pod-packet'

async function json(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
  if (!response.ok) {
    throw new Error(`Public tool metadata unavailable: HTTP ${response.status}`)
  }
  return response.json()
}

export async function resolveTools(packageManager: string): Promise<PodPlan['tools']> {
  const npm = await Promise.all(
    ['@anthropic-ai/claude-code', 'opencode-ai', '@openai/codex'].map(async (name) => {
      const { version } = z
        .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) })
        .parse(await json(`https://registry.npmjs.org/${name}/latest`))
      return `${name}@${version}`
    })
  )
  const downloads: PodPlan['tools']['downloads'] = {}
  for (const [name, repo, suffix] of [
    ['gh', 'cli/cli', '_linux_amd64.tar.gz'],
    ['uv', 'astral-sh/uv', 'x86_64-unknown-linux-gnu.tar.gz']
  ]) {
    const release = z
      .object({
        assets: z.array(
          z.object({
            name: z.string(),
            browser_download_url: z.string(),
            digest: z.string().nullish()
          })
        )
      })
      .parse(await json(`https://api.github.com/repos/${repo}/releases/latest`))
    const asset = release.assets.find((asset) => asset.name.endsWith(suffix))
    if (
      !asset?.digest?.match(/^sha256:[a-f0-9]{64}$/) ||
      !asset.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`)
    ) {
      throw new Error(`No verified release asset for ${name}`)
    }
    downloads[name] = {
      url: asset.browser_download_url,
      sha256: asset.digest.slice(7),
      member: `${asset.name.replace('.tar.gz', '')}/${name === 'gh' ? 'bin/gh' : 'uv'}`
    }
  }
  const url = 'https://dl.k8s.io/release/v1.36.1/bin/linux/amd64/kubectl'
  const checksum = await fetch(`${url}.sha256`, { signal: AbortSignal.timeout(20_000) })
  if (!checksum.ok) {
    throw new Error('kubectl checksum unavailable')
  }
  downloads.kubectl = {
    url,
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse((await checksum.text()).trim())
  }
  const python = await Promise.all(
    ['boto3', 'truss', 'tinker', 'wandb', 'huggingface-hub'].map(async (name) => {
      const { info } = z
        .object({ info: z.object({ version: z.string().regex(/^[\d.]+$/) }) })
        .parse(await json(`https://pypi.org/pypi/${name}/json`))
      return `${name}==${info.version}`
    })
  )
  return { npm: [packageManager, ...npm], downloads, python }
}
