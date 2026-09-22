import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { PodPlan } from './pod-packet'
import { checkedProcess } from './cluster-process'
import { podEnvironment, podHome, podState } from './pod-environment'
import { installPrivateFile } from './pod-private-files'
import { requireNativeBinary } from './runtime-files'

export async function installTools(plan: PodPlan): Promise<void> {
  const marker = join(podState, 'tools.json')
  if (existsSync(marker)) {
    if (readFileSync(marker, 'utf8') !== JSON.stringify(plan.tools)) {
      throw new Error('Installed tools differ; no upgrade attempted')
    }
    return
  }
  const env = podEnvironment()
  const toolchain = join(podHome, '.local/share/orca-toolchain')
  mkdirSync(toolchain, { recursive: true, mode: 0o700 })
  await checkedProcess(
    {
      program: 'npm',
      args: [
        'install',
        '--prefix',
        toolchain,
        '--no-audit',
        '--no-fund',
        '--fetch-retries=5',
        ...plan.tools.npm
      ],
      env,
      timeoutMs: 900_000
    },
    'pinned npm tool installation'
  )
  for (const [name, asset] of Object.entries(plan.tools.downloads)) {
    if (
      !['gh', 'uv', 'kubectl'].includes(name) ||
      !/^https:\/\/(github.com\/(cli\/cli|astral-sh\/uv)\/releases\/download\/|dl.k8s.io\/release\/)/.test(
        asset.url
      )
    ) {
      throw new Error('Unrecognized tool download')
    }
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) {
      throw new Error(`${name} download failed: HTTP ${response.status}`)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (
      bytes.length > 200 * 1024 * 1024 ||
      createHash('sha256').update(bytes).digest('hex') !== asset.sha256
    ) {
      throw new Error(`${name} checksum mismatch`)
    }
    let binary = bytes
    if (asset.member) {
      if (asset.member.startsWith('/') || asset.member.split('/').includes('..')) {
        throw new Error('Invalid release archive member')
      }
      const stage = mkdtempSync(join(podState, 'download-'))
      const archive = join(stage, 'release.tgz')
      writeFileSync(archive, bytes, { mode: 0o600, flag: 'wx' })
      await checkedProcess(
        { program: 'tar', args: ['-xzf', archive, '-C', stage, asset.member], env },
        `${name} extraction`
      )
      binary = readFileSync(join(stage, asset.member))
    }
    if (installPrivateFile(podHome, `.local/bin/${name}`, binary, 0o700) === 'preserved') {
      throw new Error(`Existing ${name} differs; no replacement attempted`)
    }
  }
  const python = join(podHome, '.local/share/orca-python')
  if (!existsSync(join(python, 'pyvenv.cfg'))) {
    await checkedProcess(
      {
        program: join(podHome, '.local/bin/uv'),
        args: ['venv', '--python', '3.12', python],
        env,
        timeoutMs: 300_000
      },
      'Python environment'
    )
  }
  await checkedProcess(
    {
      program: join(podHome, '.local/bin/uv'),
      args: ['pip', 'install', '--python', join(python, 'bin/python'), ...plan.tools.python],
      env,
      timeoutMs: 600_000
    },
    'Python tools'
  )
  installPrivateFile(
    podHome,
    '.local/bin/uvx',
    '#!/bin/sh\nexec "$HOME/.local/bin/uv" tool run "$@"\n',
    0o700
  )
  writeFileSync(marker, JSON.stringify(plan.tools), { mode: 0o600, flag: 'wx' })
}

export function nativeAgent(name: 'claude' | 'opencode'): string {
  const modules = join(podHome, '.local/share/orca-toolchain/node_modules')
  const candidates =
    name === 'claude'
      ? [
          '@anthropic-ai/claude-code-linux-x64/claude',
          '@anthropic-ai/claude-code-linux-x64/bin/claude',
          '@anthropic-ai/claude-code/bin/claude.exe'
        ]
      : [
          'opencode-linux-x64/bin/opencode',
          'opencode-linux-x64-baseline/bin/opencode',
          'opencode-ai/bin/opencode.exe'
        ]
  for (const relative of candidates) {
    const path = join(modules, relative)
    if (!existsSync(path)) {
      continue
    }
    try {
      requireNativeBinary(path)
      return path
    } catch {
      /* Try the next package layout. */
    }
  }
  throw new Error(`Native ${name} binary not found in its installed platform package`)
}
