import { readFileSync } from 'node:fs'
import { podPacketSchema } from './pod-packet'
import { installPrivateFile } from './pod-private-files'
import { shellQuote } from './runtime-files'

async function main() {
  if (process.platform !== 'linux' || process.getuid?.() !== 1001) {
    throw new Error('Wrong pod user')
  }
  process.umask(0o077)
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk)
    length += bytes.length
    if (length > 200 * 1024 * 1024) {
      throw new Error('Packet too large')
    }
    chunks.push(bytes)
  }
  const packet = podPacketSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  const home = '/home/orca'
  const owner = JSON.parse(readFileSync(`${home}/.orca-cluster-owner.json`, 'utf8'))
  if (owner.instance !== packet.instance) {
    throw new Error('Pod volume identity mismatch')
  }
  const results = Object.entries(packet.files).map(([path, value]) => ({
    path,
    action: installPrivateFile(home, path, value)
  }))
  installPrivateFile(home, '.config/orca-pod/credentials.json', JSON.stringify(packet.env))
  installPrivateFile(
    home,
    '.config/orca-pod/env.sh',
    `${Object.entries(packet.env)
      .filter(([name]) => /^[A-Z][A-Z0-9_]*$/.test(name))
      .map(([name, value]) => `export ${name}=${shellQuote(value)}`)
      .join('\n')}\n`
  )
  installPrivateFile(home, '.config/opencode/opencode.json', packet.openCodeConfig)
  const profile = `export PATH="$HOME/.local/bin:$HOME/.local/share/orca-toolchain/node_modules/.bin:$HOME/.local/share/orca-python/bin:/usr/local/bin:$PATH"\n[ ! -r "$HOME/.config/orca-pod/env.sh" ] || . "$HOME/.config/orca-pod/env.sh"\nexport OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"\nexport KUBECONFIG="$HOME/.kube/${packet.kubeconfigName}"\n`
  installPrivateFile(home, '.profile', profile)
  installPrivateFile(home, '.bashrc', profile)
  const {
    files: _files,
    env: _env,
    bootstrap,
    services,
    verifier,
    storageProbe,
    controller,
    ...plan
  } = packet
  installPrivateFile(home, '.local/state/orca-cluster/plan.json', JSON.stringify(plan))
  installPrivateFile(
    home,
    '.local/state/orca-cluster/bootstrap.cjs',
    Buffer.from(bootstrap, 'base64')
  )
  installPrivateFile(
    home,
    '.local/state/orca-cluster/services.cjs',
    Buffer.from(services, 'base64')
  )
  installPrivateFile(home, '.local/state/orca-cluster/verify.cjs', Buffer.from(verifier, 'base64'))
  installPrivateFile(
    home,
    '.local/state/orca-cluster/storage-credential-probe.py',
    Buffer.from(storageProbe, 'base64')
  )
  installPrivateFile(
    home,
    '.local/state/orca-cluster/pod-setup.cjs',
    Buffer.from(controller, 'base64')
  )
  console.log(
    JSON.stringify({
      copied: results.filter((row) => row.action === 'created').length,
      preserved: results.filter((row) => row.action === 'preserved').map((row) => row.path),
      uid: process.getuid()
    })
  )
}
main().catch(() => {
  console.error('Private transfer failed; credential-bearing details withheld')
  process.exitCode = 1
})
