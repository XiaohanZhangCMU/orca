import { z } from 'zod'
import { selectCredential, type CredentialBundle } from './cluster-credentials'

export type CredentialCheck = {
  service: string
  status: 'verified' | 'missing' | 'rejected' | 'unverifiable' | 'present-only'
  source?: string
  detail: string
}
type Probe = { url: string; init: (key: string) => RequestInit; schema: z.ZodType }
const bearer = (key: string) => ({ headers: { Authorization: `Bearer ${key}` } })
const graphql = (authorization: string) => ({
  method: 'POST',
  headers: { Authorization: authorization, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ viewer { id } }' })
})
const listSchema = z.object({ data: z.array(z.unknown()) })
const probes: Record<string, Probe> = {
  github: {
    url: 'https://api.github.com/user',
    init: bearer,
    schema: z.object({ login: z.string(), id: z.number() })
  },
  linear: {
    url: 'https://api.linear.app/graphql',
    init: graphql,
    schema: z.object({
      data: z.object({ viewer: z.object({ id: z.string() }) }),
      errors: z.undefined().optional()
    })
  },
  notion: {
    url: 'https://api.notion.com/v1/users/me',
    init: (key) => ({
      headers: { Authorization: `Bearer ${key}`, 'Notion-Version': '2022-06-28' }
    }),
    schema: z.object({ object: z.literal('user'), id: z.string() })
  },
  huggingface: {
    url: 'https://huggingface.co/api/whoami-v2',
    init: bearer,
    schema: z.object({ name: z.string() })
  },
  wandb: {
    url: 'https://api.wandb.ai/graphql',
    init: (key) => graphql(`Basic ${Buffer.from(`api:${key}`).toString('base64')}`),
    schema: z.object({
      data: z.object({ viewer: z.object({ id: z.string() }) }),
      errors: z.undefined().optional()
    })
  },
  tinker: {
    url: 'https://tinker.thinkingmachines.dev/services/tinker-prod/api/v1/get_server_capabilities',
    init: (key) => ({ headers: { 'X-API-Key': key } }),
    schema: z.object({ supported_models: z.array(z.unknown()) })
  },
  baseten: {
    url: 'https://api.baseten.co/v1/models',
    init: (key) => ({ headers: { Authorization: `Api-Key ${key}` } }),
    schema: z.object({ models: z.array(z.unknown()) })
  },
  'baseten-inference': {
    url: 'https://inference.baseten.co/v1/models',
    init: bearer,
    schema: listSchema
  },
  rancher: {
    url: 'https://rancher.infra.basetensors.com/v3/users?me=true',
    init: bearer,
    schema: z.object({ data: z.array(z.unknown()).min(1) })
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    init: (key) => ({ headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }),
    schema: listSchema
  },
  openai: { url: 'https://api.openai.com/v1/models', init: bearer, schema: listSchema }
}

export async function checkHttpCredentials(
  bundle: CredentialBundle,
  fetcher: typeof fetch = fetch
): Promise<CredentialCheck[]> {
  const results: CredentialCheck[] = []
  // Bounded service batches avoid overwhelming gateways and local network proxies.
  const entries = Object.entries(probes)
  for (let offset = 0; offset < entries.length; offset += 3) {
    const checks = await Promise.all(
      entries.slice(offset, offset + 3).map(async ([service, probe]): Promise<CredentialCheck> => {
        const candidates = bundle.candidates[service] ?? []
        if (!candidates.length) {
          return { service, status: 'missing', detail: 'No configured credential source' }
        }
        let last: CredentialCheck = { service, status: 'unverifiable', detail: 'No response' }
        for (const candidate of candidates.slice(0, 5)) {
          try {
            const response = await fetcher(probe.url, {
              ...probe.init(candidate.value),
              redirect: 'error',
              signal: AbortSignal.timeout(15_000)
            })
            if (!response.ok) {
              await response.body?.cancel()
              last = {
                service,
                source: candidate.source,
                status: [401, 403].includes(response.status) ? 'rejected' : 'unverifiable',
                detail: `HTTP ${response.status}; no response body logged`
              }
              continue
            }
            const bytes = await response.text()
            if (
              bytes.length > 4 * 1024 * 1024 ||
              !probe.schema.safeParse(JSON.parse(bytes)).success
            ) {
              last = {
                service,
                source: candidate.source,
                status: 'unverifiable',
                detail: 'Unexpected authenticated response shape'
              }
              continue
            }
            selectCredential(bundle, service, candidate)
            return {
              service,
              status: 'verified',
              source: candidate.source,
              detail: 'Authenticated read-only API check; no inference or training requested'
            }
          } catch {
            last = {
              service,
              source: candidate.source,
              status: 'unverifiable',
              detail: 'Network, TLS, timeout, or response validation failure'
            }
          }
        }
        return last
      })
    )
    results.push(...checks)
  }
  return results
}

export function checkCodexCredential(bundle: CredentialBundle): CredentialCheck {
  const service = 'codex-login'
  const source = '~/.codex/auth.json'
  const text = bundle.files['.codex/auth.json']
  if (!text) {
    return { service, source, status: 'missing', detail: 'Use codex login on the new pod' }
  }
  try {
    const parsed = z
      .object({
        OPENAI_API_KEY: z.string().nullish(),
        tokens: z.object({ access_token: z.string() }).nullish()
      })
      .parse(JSON.parse(text))
    if (parsed.tokens?.access_token) {
      const claims = z
        .object({ exp: z.number() })
        .parse(
          JSON.parse(
            Buffer.from(parsed.tokens.access_token.split('.')[1], 'base64url').toString('utf8')
          )
        )
      if (claims.exp * 1000 < Date.now()) {
        return {
          service,
          source,
          status: 'unverifiable',
          detail: 'Access token expired; refresh/login required, not attempted on the laptop'
        }
      }
    }
    return {
      service,
      source,
      status: 'present-only',
      detail: 'Portable login present; not refreshed or tested with a paid agent request'
    }
  } catch {
    return { service, source, status: 'unverifiable', detail: 'Login format was not recognized' }
  }
}
