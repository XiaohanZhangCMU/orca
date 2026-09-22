import { z } from 'zod'
import type { PublicKnownRuntimeEnvironment } from './runtime-environments'

export const basetenSetupSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]{1,50}[a-z0-9]$/),
    namespace: z.string().regex(/^[a-z][a-z0-9-]{1,50}[a-z0-9]$/),
    source: z.string().min(1).max(1024),
    dreamteam: z.string().min(1).max(1024),
    kubeconfig: z.string().min(1).max(1024),
    storageGi: z.number().int().min(250).max(4096),
    prompt: z.string().trim().min(1).max(20000)
  })
  .strict()
export type BasetenSetup = z.infer<typeof basetenSetupSchema>
export type BasetenCheck = { service: string; status: string; optional: boolean }
export type BasetenPreflight = {
  ticket: string | null
  checks: BasetenCheck[]
  repositories: string[]
}
export type BasetenHost = {
  name: string
  namespace: string
  storage: string
  phase: string
  state: 'setting-up' | 'ready' | 'unverifiable' | 'failed' | 'releasing' | 'released'
  runtimeId?: string
  management?: 'installer' | 'legacy'
  instance?: string
  environmentId?: string
  reconnecting?: boolean
}
export type BasetenHostRegistration = Pick<BasetenHost, 'name' | 'management' | 'instance'> & {
  publicKeyB64?: string
}
export type BasetenPhone = {
  state: 'not-enabled' | 'authorizing' | 'ready' | 'unverifiable' | 'update-required'
  authUrl?: string
  link?: string
  qrDataUrl?: string
  endpoint?: string
  message: string
}
export type BasetenHostsApi = {
  defaults(): Promise<BasetenSetup>
  list(): Promise<BasetenHost[]>
  check(setup: BasetenSetup): Promise<BasetenPreflight>
  create(ticket: string, consent: boolean): Promise<void>
  access(name: string): Promise<{ link: string }>
  connect(name: string): Promise<{ environment: PublicKnownRuntimeEnvironment }>
  phone(name: string): Promise<BasetenPhone>
  enablePhone(name: string, allowedIps: string[]): Promise<void>
  release(name: string, instance: string, confirmation: string): Promise<void>
}
