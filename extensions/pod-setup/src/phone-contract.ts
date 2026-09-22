import { z } from 'zod'

export const tailnetIp = z.string().refine((value) => {
  const parts = value.split('.').map(Number)
  return (
    /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) &&
    parts[1] >= 64 &&
    parts[1] <= 127 &&
    parts.join('.') === value &&
    parts.every((n) => n >= 0 && n <= 255)
  )
}, 'Use an exact Tailscale IPv4 address (100.64.0.0/10)')
export const phoneConfigSchema = z
  .object({
    hostname: z.string().regex(/^[a-z][a-z0-9-]{1,50}[a-z0-9]$/),
    allowedIps: z.array(tailnetIp).min(1).max(16)
  })
  .strict()
