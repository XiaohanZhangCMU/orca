import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { hostPod } from './desktop-inventory'
import { checkedProcess, kubectl } from './cluster-process'
import { phoneConfigSchema } from './phone-contract'
import type { BasetenPhone } from '../../../src/shared/baseten-hosts'

const controller = '/home/orca/.local/share/orca-tailnet-proxy/pod-phone.cjs'
export async function enablePhone(name: string, allowedIps: string[], source: string) {
  const phoneConfig = phoneConfigSchema.parse({ hostname: name, allowedIps })
  const { config, pod } = await hostPod(name)
  const binary = join(source, 'out/pod-setup/orca-tailnet-proxy')
  if (!existsSync(binary)) {
    await checkedProcess(
      {
        program: 'go',
        args: ['build', '-trimpath', '-o', binary, '.'],
        cwd: join(source, 'extensions/pod-setup/tailnet-proxy'),
        env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
        timeoutMs: 600_000
      },
      'Build the private phone proxy (Go required on this laptop)'
    )
  }
  const bytes = readFileSync(binary)
  if (bytes.subarray(0, 4).toString('hex') !== '7f454c46') {
    throw new Error('Expected a Linux phone proxy binary')
  }
  const upload =
    "const fs=require('fs');if(process.getuid()!==1001)throw Error('Wrong user');let data='';process.stdin.on('data',c=>{data+=c;if(data.length>4000000)process.exit(1)});process.stdin.on('end',()=>{const p='/home/orca/.local/share/orca-tailnet-proxy';fs.mkdirSync(p,{recursive:true,mode:448});if(fs.lstatSync(p).isSymbolicLink())throw Error('Unsafe directory');const f=p+'/pod-phone.cjs',b=Buffer.from(data,'base64');if(fs.existsSync(f)){if(fs.lstatSync(f).isSymbolicLink()||!fs.readFileSync(f).equals(b))throw Error('Controller differs')}else fs.writeFileSync(f,b,{flag:'wx',mode:384})})"
  await kubectl(
    config,
    ['exec', '-i', pod, '-c', 'orca', '--', 'node', '-e', upload],
    readFileSync(join(source, 'out/pod-setup/pod-phone.cjs')).toString('base64')
  )
  await kubectl(
    config,
    ['exec', '-i', pod, '-c', 'orca', '--', 'node', controller, 'install'],
    JSON.stringify({
      binary: bytes.toString('base64'),
      launcher: readFileSync(join(source, 'out/pod-setup/tailnet-launch.cjs')).toString('base64'),
      config: phoneConfig
    }),
    120_000
  )
}
export async function phoneStatus(name: string, source: string): Promise<BasetenPhone> {
  const { config, pod } = await hostPod(name)
  return z
    .object({
      state: z.enum(['not-enabled', 'authorizing', 'ready', 'unverifiable', 'update-required']),
      authUrl: z.string().optional(),
      link: z.string().optional(),
      endpoint: z.string().optional(),
      message: z.string()
    })
    .parse(
      JSON.parse(
        await kubectl(
          config,
          ['exec', '-i', pod, '-c', 'orca', '--', 'node', '-', 'status'],
          readFileSync(join(source, 'out/pod-setup/pod-phone.cjs'), 'utf8')
        )
      )
    )
}
