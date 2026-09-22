import { existsSync, readFileSync, openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { decodePairingOffer, encodePairingOffer } from '../../../src/shared/pairing'
import type { BasetenPhone } from '../../../src/shared/baseten-hosts'
import { readPodPlan, podHome } from './pod-environment'
import { installPrivateFile } from './pod-private-files'
import { checkedProcess } from './cluster-process'
import { processIdentity, hostStatus } from './host-control'
import { readHostConfig } from './host-config'
import { phoneConfigSchema, tailnetIp } from './phone-contract'

const root = join(podHome, '.local/share/orca-tailnet-proxy')
const state = join(podHome, '.local/state/orca-tailnet')
const configPath = join(root, 'phone.json')
function readTail(file: string): string {
  if (!existsSync(file)) {
    return ''
  }
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(64000)
    const size = fstatSync(fd).size
    const length = readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length))
    return buffer.subarray(0, length).toString('utf8')
  } finally {
    closeSync(fd)
  }
}
async function start() {
  const config = phoneConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')))
  await checkedProcess(
    {
      program: process.execPath,
      args: [
        join(root, 'tailnet-launch.cjs'),
        '--proxy',
        join(root, 'orca-tailnet-proxy'),
        '--hostname',
        config.hostname,
        '--allow',
        config.allowedIps.join(',')
      ]
    },
    'Start private Tailscale proxy'
  )
}
async function status(): Promise<BasetenPhone> {
  if (!existsSync(join(state, 'proxy-pid.json'))) {
    return {
      state: 'not-enabled',
      message: 'Enable private phone access, then authorize this host in Tailscale.'
    }
  }
  const receipt = z
    .object({ pid: z.number(), startTicks: z.string(), binary: z.string() })
    .parse(JSON.parse(readFileSync(join(state, 'proxy-pid.json'), 'utf8')))
  const identity = processIdentity(receipt.pid)
  if (
    identity.uid !== 1001 ||
    identity.startTicks !== receipt.startTicks ||
    identity.args[0] !== receipt.binary ||
    identity.state === 'Z'
  ) {
    throw new Error('Proxy identity is unverifiable')
  }
  const readySchema = z.object({ pid: z.number(), ips: z.array(z.string()) })
  const ready = readTail(join(state, 'ready.jsonl'))
    .trim()
    .split('\n')
    .toReversed()
    .flatMap((line) => {
      try {
        const parsed = readySchema.safeParse(JSON.parse(line))
        return parsed.success ? [parsed.data] : []
      } catch {
        return []
      }
    })
    .find((row) => row.pid === receipt.pid)
  if (!ready) {
    const urls = readTail(join(state, 'proxy.log')).match(
      /https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/g
    )
    return {
      state: 'authorizing',
      authUrl: urls?.at(-1),
      message: 'Authorize this pod in the same Tailscale network as your phone. Then refresh.'
    }
  }
  const ip = ready.ips.find((value) => tailnetIp.safeParse(value).success)
  if (!ip) {
    throw new Error('No private Tailscale IPv4 address')
  }
  const host = readHostConfig(join(podHome, '.local/share/orca-pod-host'))
  const offerFile = join(host.profile, 'baseten-phone.json')
  if (!existsSync(offerFile)) {
    return {
      state: 'update-required',
      message:
        'This host predates UI phone pairing. A host update is required; no running sessions were restarted.'
    }
  }
  const saved = z
    .object({
      runtimeId: z.string(),
      offer: z.object({ available: z.boolean(), pairingUrl: z.string().optional() })
    })
    .parse(JSON.parse(readFileSync(offerFile, 'utf8')))
  const live = await hostStatus(host)
  if (!live.ready || live.runtimeId !== saved.runtimeId || !saved.offer.pairingUrl) {
    throw new Error('Host pairing identity is unverifiable')
  }
  const offer = decodePairingOffer(saved.offer.pairingUrl)
  if (offer.scope !== 'mobile' || offer.relay || offer.endpoint !== 'ws://127.0.0.1:6770') {
    throw new Error('Invalid mobile grant')
  }
  const endpoint = `ws://${ip}:6770`
  return {
    state: 'ready',
    endpoint,
    link: encodePairingOffer({ ...offer, endpoint }),
    message:
      'Ready to pair. Keep Tailscale enabled on your phone, open Orca Mobile, and scan this code. A QR code is not confirmation that the phone has connected.'
  }
}

async function main() {
  const plan = readPodPlan()
  const command = process.argv[2]
  if (command === 'status') {
    return status()
  }
  if (command === 'install') {
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk
      if (input.length > 120_000_000) {
        throw new Error('Packet too large')
      }
    }
    const packet = z
      .object({ binary: z.string(), launcher: z.string(), config: phoneConfigSchema })
      .strict()
      .parse(JSON.parse(input))
    if (packet.config.hostname !== plan.name) {
      throw new Error('Host identity mismatch')
    }
    for (const [file, value, mode] of [
      ['orca-tailnet-proxy', Buffer.from(packet.binary, 'base64'), 0o700],
      ['tailnet-launch.cjs', Buffer.from(packet.launcher, 'base64'), 0o600],
      ['phone.json', Buffer.from(JSON.stringify(packet.config)), 0o600]
    ] as const) {
      if (
        installPrivateFile(podHome, `.local/share/orca-tailnet-proxy/${file}`, value, mode) ===
        'preserved'
      ) {
        throw new Error('Existing phone setup differs; no live proxy was changed')
      }
    }
  } else if (command !== 'start') {
    throw new Error('Invalid phone operation')
  }
  await start()
  return { ok: true }
}
main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch(() => {
    console.log(
      JSON.stringify({
        state: 'unverifiable',
        message:
          'Phone access is unverifiable. Check the host and Tailscale authorization. Existing sessions were not changed.'
      })
    )
    if (process.argv[2] !== 'status') {
      process.exitCode = 1
    }
  })
