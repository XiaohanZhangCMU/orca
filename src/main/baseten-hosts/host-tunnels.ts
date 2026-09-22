import { createServer } from 'node:net'
import { z } from 'zod'
import { spawnProcess, type SpawnedProcess } from '../../shared/child-process/run-process'
import { decodePairingOffer, encodePairingOffer } from '../../shared/pairing'

export const hostAccessSchema = z.object({
  link: z.string(),
  kubectl: z.string(),
  kubeconfig: z.string(),
  namespace: z.string(),
  pod: z.string()
})
const tunnels = new Map<string, { child: SpawnedProcess; port: number; pod: string }>()
const pending = new Map<string, Promise<number>>()
const children = new Set<SpawnedProcess>()
let closing = false

async function availablePort(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('No local port available'))
        } else {
          resolve(address.port)
        }
      })
    })
  })
}
async function startTunnel(
  name: string,
  access: z.infer<typeof hostAccessSchema>
): Promise<number> {
  const existing = tunnels.get(name)
  if (
    existing?.child.exitCode === null &&
    existing.child.signalCode === null &&
    existing.pod === access.pod &&
    !existing.child.killed
  ) {
    return existing.port
  }
  if (existing) {
    existing.child.kill()
    tunnels.delete(name)
  }
  const port = await availablePort()
  if (closing) {
    throw new Error('Orca is closing. Reconnect after reopening the app.')
  }
  const child = spawnProcess({
    program: access.kubectl,
    args: [
      '--kubeconfig',
      access.kubeconfig,
      '-n',
      access.namespace,
      'port-forward',
      '--address=127.0.0.1',
      `pod/${access.pod}`,
      `${port}:6770`
    ],
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => fail(), 20_000)
    let settled = false
    const fail = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(new Error('Could not open a private tunnel. Check Kubernetes access, then reconnect.'))
    }
    child.on('error', fail)
    child.once('exit', fail)
    child.stdout.on('error', fail)
    child.stderr.on('error', fail)
    child.stderr.on('data', () => {})
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4096)
      if (!settled && output.includes(`Forwarding from 127.0.0.1:${port}`)) {
        settled = true
        clearTimeout(timer)
        resolve()
      }
    })
  })
  tunnels.set(name, { child, port, pod: access.pod })
  return port
}
export async function hostAccessLink(
  name: string,
  access: z.infer<typeof hostAccessSchema>
): Promise<string> {
  const offer = decodePairingOffer(access.link)
  if (offer.scope !== 'runtime' || offer.relay || offer.endpoint !== 'ws://127.0.0.1:6770') {
    throw new Error('Host returned an unexpected access link')
  }
  let task = pending.get(name)
  if (!task) {
    task = startTunnel(name, access)
    pending.set(name, task)
  }
  try {
    const port = await task
    return encodePairingOffer({ ...offer, endpoint: `ws://127.0.0.1:${port}` })
  } finally {
    if (pending.get(name) === task) {
      pending.delete(name)
    }
  }
}
export function closeHostTunnels(): void {
  closing = true
  for (const child of children) {
    child.kill()
  }
  children.clear()
  tunnels.clear()
}

export function closeHostTunnel(name: string): void {
  const tunnel = tunnels.get(name)
  if (tunnel) {
    tunnel.child.kill()
    children.delete(tunnel.child)
    tunnels.delete(name)
  }
}
