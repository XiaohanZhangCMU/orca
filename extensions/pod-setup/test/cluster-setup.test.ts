import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clusterConfigSchema, dreamteamRepositories } from '../src/cluster-config'
import { clusterResources } from '../src/cluster-manifests'
import { installPrivateFile } from '../src/pod-private-files'
import { iniSections, selectCredential, type CredentialBundle } from '../src/cluster-credentials'
import { checkHttpCredentials, checkCodexCredential } from '../src/credential-probes'
import { credentialBlockers } from '../src/storage-checks'
import { sourcePackageManager } from '../src/cluster-source'
import { tunnelPairingLink } from '../src/cluster-tunnel'
import { decodePairingOffer, encodePairingOffer } from '../../../src/shared/pairing'

const directories: string[] = []
function temporary() {
  const path = mkdtempSync(join(tmpdir(), 'orca-pod-test-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})
function emptyBundle(): CredentialBundle {
  return { files: {}, env: {}, sources: [], candidates: {} }
}

describe('new CPU workstation', () => {
  it('defaults to a persistent 250Gi home and a digest-pinned image', () => {
    const config = clusterConfigSchema.parse({})
    expect(config.storage).toBe('250Gi')
    expect(config.persistent).toBe(true)
    expect(config.image).toMatch(/@sha256:[a-f0-9]{64}$/)
  })
  it('has no public service, token mount, or privileged application container', () => {
    const resources = clusterResources(clusterConfigSchema.parse({}), 'instance')
    expect(resources.map((resource) => resource.kind)).toEqual([
      'PersistentVolumeClaim',
      'Deployment'
    ])
    const serialized = JSON.stringify(resources)
    expect(serialized).toContain('"runAsUser":1001')
    expect(serialized).toContain('"automountServiceAccountToken":false')
    expect(serialized).not.toContain('nvidia.com/gpu')
    expect(serialized).not.toContain('GH_TOKEN')
    expect(serialized).not.toContain('xiaohan-cpu-dev')
  })
  it('does not parse executable Python when reading Dreamteam repository names', () => {
    expect(
      dreamteamRepositories(
        "REPOS: dict[str, str] = {\n    'trainers': 'basetenlabs/trainers',\n}\n"
      )
    ).toEqual([
      { name: 'trainers', slug: 'basetenlabs/trainers' },
      { name: 'orca', slug: 'XiaohanZhangCMU/orca' }
    ])
    expect(() => dreamteamRepositories('REPOS = dangerous()')).toThrow()
  })
  it('accepts the packageManager integrity suffix but pins the install version', () => {
    const root = temporary()
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@12.0.0+sha512.abcd' })
    )
    expect(sourcePackageManager(root)).toBe('pnpm@12.0.0')
  })
})

describe.skipIf(process.platform === 'win32')('private file installation', () => {
  it('uses private permissions, accepts identical reruns, and preserves different files', () => {
    const root = temporary()
    expect(installPrivateFile(root, '.config/linear/api_key', 'original')).toBe('created')
    expect(installPrivateFile(root, '.config/linear/api_key', 'original')).toBe('unchanged')
    expect(installPrivateFile(root, '.config/linear/api_key', 'different')).toBe('preserved')
    expect(readFileSync(join(root, '.config/linear/api_key'), 'utf8')).toBe('original')
    if (process.platform !== 'win32') {
      expect(statSync(join(root, '.config/linear/api_key')).mode & 0o777).toBe(0o600)
    }
  })
  it.each(['../escape', '/tmp/escape', '.config/../escape', 'a\\b', 'a//b'])(
    'refuses unsafe destination %s',
    (name) => {
      expect(() => installPrivateFile(temporary(), name, 'secret')).toThrow()
    }
  )
  it.skipIf(process.platform === 'win32')('refuses symlink parents and symlink homes', () => {
    const root = temporary()
    const elsewhere = temporary()
    symlinkSync(elsewhere, join(root, 'link'))
    expect(() => installPrivateFile(root, 'link/secret', 'secret')).toThrow()
    expect(() => installPrivateFile(join(root, 'link'), 'secret', 'secret')).toThrow()
  })
})

describe('separate laptop tunnel', () => {
  const offer = {
    v: 2 as const,
    endpoint: 'ws://127.0.0.1:6770',
    deviceToken: 'fixture-token',
    publicKeyB64: 'fixture-key',
    scope: 'runtime' as const
  }
  it('keeps host identity and credentials while selecting the new local port', () => {
    expect(decodePairingOffer(tunnelPairingLink(encodePairingOffer(offer), 6771))).toEqual({
      ...offer,
      endpoint: 'ws://127.0.0.1:6771'
    })
  })
  it('refuses non-loopback or mobile offers', () => {
    expect(() =>
      tunnelPairingLink(encodePairingOffer({ ...offer, endpoint: 'ws://example.test:6770' }), 6771)
    ).toThrow()
    expect(() =>
      tunnelPairingLink(encodePairingOffer({ ...offer, scope: 'mobile' }), 6771)
    ).toThrow()
  })
  it('keeps management and inference credentials separate', () => {
    const bundle = emptyBundle()
    selectCredential(bundle, 'baseten', { source: 'fixture', value: 'management' })
    selectCredential(bundle, 'baseten-inference', { source: 'fixture', value: 'inference' })
    expect(bundle.env.BASETEN_API_KEY).toBe('management')
    expect(bundle.env.BASETEN_INFERENCE_API_KEY).toBe('inference')
  })
})

describe('credential preflight', () => {
  it('only writes the selected HF token, not a multiline token source', () => {
    const bundle = emptyBundle()
    selectCredential(bundle, 'huggingface', { source: 'fixture', value: 'hf_selected' })
    expect(bundle.files['.hf_access_token']).toBe('hf_selected\n')
    expect(bundle.env.HF_TOKEN).toBe('hf_selected')
  })
  it('reads quoted truss and AWS INI values', () => {
    expect(iniSections('[baseten]\napi_key = "example"\n').baseten.api_key).toBe('example')
  })
  it('treats HTTP 200 GraphQL errors as unverified and never logs response secrets', async () => {
    const bundle = emptyBundle()
    bundle.candidates.linear = [{ source: 'fixture', value: 'credential-value' }]
    const fetcher: typeof fetch = async (_url, init) => {
      expect(init?.redirect).toBe('error')
      return new Response(JSON.stringify({ errors: [{ message: 'credential-value' }] }))
    }
    const checks = await checkHttpCredentials(bundle, fetcher)
    expect(checks.find((check) => check.service === 'linear')?.status).toBe('unverifiable')
    expect(JSON.stringify(checks)).not.toContain('credential-value')
  })
  it('blocks missing services except ones explicitly waived; Codex presence is advisory', () => {
    expect(
      credentialBlockers(
        [
          { service: 'notion', status: 'missing', detail: '' },
          { service: 'github', status: 'rejected', detail: '' },
          { service: 'codex-login', status: 'present-only', detail: '' }
        ],
        ['notion']
      ).map((check) => check.service)
    ).toEqual(['github'])
    expect(checkCodexCredential(emptyBundle()).status).toBe('missing')
  })
})
