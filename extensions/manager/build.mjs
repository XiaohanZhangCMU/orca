import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'

const root = new URL('./', import.meta.url)
const styles = await readFile(new URL('../../src/renderer/src/assets/main.css', root), 'utf8')
const font = await readFile(
  new URL('../../src/renderer/src/assets/fonts/Geist-Variable.woff2', root)
)
const tokens = [
  'background',
  'foreground',
  'muted',
  'muted-foreground',
  'border',
  'radius',
  'font-mono'
]
function theme(selector) {
  const block = styles.slice(styles.indexOf(`${selector} {`)).split('}')[0]
  return tokens
    .map((name) => {
      const value = block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]
      if (!value && selector === ':root') {
        throw new Error(`Missing Orca design token: ${name}`)
      }
      return value ? `--${name}:${value};` : ''
    })
    .join('')
}
const themeCss = `:root{${theme(':root')}}
@media(prefers-color-scheme:dark){:root{${theme('.dark')}}}
@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:100 900;font-display:swap}`

export async function buildManager(
  outfile = fileURLToPath(new URL('dist/orca-manager.cjs', root))
) {
  await build({
    entryPoints: [fileURLToPath(new URL('src/cli.ts', root))],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    plugins: [
      {
        name: 'orca-report-design-tokens',
        setup(builder) {
          builder.onLoad({ filter: /report-theme\.ts$/ }, () => ({
            contents: `export const reportThemeCss = ${JSON.stringify(themeCss)}`,
            loader: 'ts'
          }))
        }
      }
    ]
  })
}

export async function buildManagerHostAssets(directory) {
  await buildManager(join(directory, 'orca-manager.cjs'))
  await build({
    entryPoints: [fileURLToPath(new URL('../../src/cli/index.ts', root))],
    outfile: join(directory, 'orca.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs'
  })
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  await buildManager()
  if (process.argv.includes('--host')) {
    await buildManagerHostAssets(fileURLToPath(new URL('../../out/manager', root)))
  }
  console.log('Built Orca manager assets.')
}
