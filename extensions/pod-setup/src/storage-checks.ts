import { z } from 'zod'
import { checkedProcess } from './cluster-process'
import type { CredentialBundle } from './cluster-credentials'
import type { CredentialCheck } from './credential-probes'

export async function checkStorage(
  bundle: CredentialBundle,
  python: string,
  probe: string
): Promise<CredentialCheck[]> {
  const text = await checkedProcess(
    {
      program: python,
      args: [probe],
      input: JSON.stringify({
        wasabi: bundle.files['.wasabi/access_key'] ?? '',
        aws: bundle.files['.aws/credentials'] ?? ''
      }),
      timeoutMs: 60_000
    },
    'storage credential probe'
  )
  return z
    .array(
      z.object({
        service: z.string(),
        status: z.enum(['verified', 'missing', 'unverifiable']),
        detail: z.string()
      })
    )
    .parse(JSON.parse(text))
}
export function credentialBlockers(checks: CredentialCheck[], allowed: string[]) {
  return checks.filter(
    (check) =>
      check.service !== 'codex-login' &&
      check.status !== 'verified' &&
      !allowed.includes(check.service)
  )
}
