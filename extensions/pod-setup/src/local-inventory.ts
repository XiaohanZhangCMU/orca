import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { parseEnv } from 'node:util'

export function readInventoryFields(path: string, name: string): Record<string, string> {
  if (!existsSync(path)) {
    return {}
  }
  const prefix = `ORCA_POD_${name.toUpperCase().replaceAll('-', '_')}_`
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    if (key.startsWith(prefix) && typeof value === 'string') {
      fields[key.slice(prefix.length)] = value
    }
  }
  return fields
}

export function inventoryBlock(name: string, fields: Record<string, string>): string {
  if (!/^[a-z][a-z0-9-]{1,50}[a-z0-9]$/.test(name)) {
    throw new Error('Invalid inventory name')
  }
  const prefix = `ORCA_POD_${name.toUpperCase().replaceAll('-', '_')}`
  const rows = Object.entries(fields).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /['\r\n\0]/.test(value)) {
      throw new Error('Invalid inventory field')
    }
    return `${prefix}_${key}='${value}'`
  })
  return [
    `# BEGIN ORCA POD: ${name}`,
    '# Private local inventory. Read with a dotenv parser; do not source as shell code.',
    ...rows,
    `# END ORCA POD: ${name}`
  ].join('\n')
}

export function replaceInventoryBlock(
  original: string,
  name: string,
  fields: Record<string, string>
): string {
  const block = inventoryBlock(name, fields)
  const begin = `# BEGIN ORCA POD: ${name}`
  const end = `# END ORCA POD: ${name}`
  const starts = original.split('\n').filter((line) => line === begin).length
  const ends = original.split('\n').filter((line) => line === end).length
  if (starts === 0 && ends === 0) {
    return `${original}${original.endsWith('\n') || !original ? '' : '\n'}\n${block}\n`
  }
  const start = original.search(new RegExp(`^${begin}$`, 'm'))
  const finish = original.search(new RegExp(`^${end}$`, 'm')) + end.length
  if (starts !== 1 || ends !== 1 || finish <= start) {
    throw new Error('Ambiguous inventory markers; existing file was preserved')
  }
  return original.slice(0, start) + block + original.slice(finish)
}

export function writeLocalInventory(
  path: string,
  name: string,
  fields: Record<string, string>
): void {
  if (basename(path) !== '.env' || lstatSync(dirname(path)).isSymbolicLink()) {
    throw new Error('Expected a local .env in a real directory')
  }
  const lock = join(dirname(path), '.env.orca-pods.lock.local')
  mkdirSync(lock, { mode: 0o700 })
  const temporary = join(dirname(path), `.env.orca-pods.${randomUUID()}.local`)
  try {
    const existing = lstatSync(path, { throwIfNoEntry: false })
    if (existing && (!existing.isFile() || existing.nlink !== 1)) {
      throw new Error('Refusing a symlink, hard link, or non-file .env')
    }
    const original = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const next = replaceInventoryBlock(original, name, fields)
    writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 })
    if ((existsSync(path) ? readFileSync(path, 'utf8') : '') !== original) {
      throw new Error('.env changed concurrently; existing file was preserved')
    }
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary)
    }
    rmdirSync(lock)
  }
}
