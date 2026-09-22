import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const hostConfigSchema = z.object({
  version: z.literal(1),
  user: z.string().regex(/^[a-z_][a-z0-9_-]{0,30}$/),
  uid: z.number().int().positive(),
  gid: z.number().int().positive(),
  home: z.string(),
  root: z.string(),
  profile: z.string(),
  workspace: z.string(),
  port: z.number().int().min(1024).max(65535),
  hashes: z.record(z.string(), z.string()),
  source: z.string(),
  installedAt: z.string()
})

export type HostConfig = z.infer<typeof hostConfigSchema>

export function readHostConfig(root: string): HostConfig {
  const config = hostConfigSchema.parse(JSON.parse(readFileSync(join(root, 'setup.json'), 'utf8')))
  if (config.root !== root || config.profile !== join(config.home, '.orca')) {
    throw new Error('Host installation paths do not match its receipt')
  }
  return config
}

export function requireLinux(platform = process.platform): void {
  if (platform !== 'linux') {
    throw new Error('This setup runs inside a Linux pod only')
  }
}

export function validateUser(user: string): void {
  if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(user) || user === 'root') {
    throw new Error('Choose a non-root Linux account name')
  }
}

export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be an integer from 1024 through 65535')
  }
}
