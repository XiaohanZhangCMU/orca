import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  entryPoints: {
    desktop: fileURLToPath(new URL('./src/desktop-cli.ts', import.meta.url)),
    'pod-phone': fileURLToPath(new URL('./src/pod-phone.ts', import.meta.url)),
    'pod-setup': fileURLToPath(new URL('./src/cli.ts', import.meta.url)),
    cluster: fileURLToPath(new URL('./src/cluster-cli.ts', import.meta.url)),
    'pod-transfer': fileURLToPath(new URL('./src/pod-transfer.ts', import.meta.url)),
    'pod-bootstrap': fileURLToPath(new URL('./src/pod-bootstrap.ts', import.meta.url)),
    'pod-services': fileURLToPath(new URL('./src/pod-services.ts', import.meta.url)),
    'pod-verify': fileURLToPath(new URL('./src/pod-verify.ts', import.meta.url)),
    'tailnet-launch': fileURLToPath(new URL('./src/tailnet-launch.ts', import.meta.url))
  },
  outdir: fileURLToPath(new URL('../../out/pod-setup', import.meta.url)),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs'
})
