const fs = require('node:fs')
const path = require('node:path')

async function main() {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
  }
  const request = JSON.parse(input)
  const fixture = JSON.parse(fs.readFileSync(path.join(request.source, 'fixture.json'), 'utf8'))
  if (request.command === 'registrations') {
    return [fixture.registration]
  }
  if (request.command === 'list') {
    return [
      {
        ...fixture.registration,
        namespace: 'isolated-test',
        storage: '250Gi',
        phase: 'Ready',
        state: 'ready',
        runtimeId: 'changed-runtime-id'
      }
    ]
  }
  if (request.command !== 'access') {
    throw new Error('Unexpected fixture operation')
  }
  if (fixture.waitForAccessFile) {
    const deadline = Date.now() + 30_000
    while (!fs.existsSync(path.join(request.source, 'access-ready'))) {
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for fixture access')
      }
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }
  fs.appendFileSync(path.join(request.source, 'access-count'), 'access\n')
  return {
    link: fixture.link,
    kubectl: path.join(request.source, 'forward.cjs'),
    kubeconfig: 'fixture-only',
    namespace: 'isolated-test',
    pod: 'fixture-pod'
  }
}
main()
  .then((result) => process.stdout.write(JSON.stringify({ ok: true, result })))
  .catch(() => {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Fixture operation failed' }))
    process.exitCode = 1
  })
