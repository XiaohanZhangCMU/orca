import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

export function confinedFile(home: string, name: string): string {
  const root = lstatSync(home)
  if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid?.()) {
    throw new Error('Unsafe home directory')
  }
  if (
    !name ||
    isAbsolute(name) ||
    name.includes('\\') ||
    name.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid pod-relative path')
  }
  const target = join(home, name)
  const inside = relative(home, target)
  if (inside.startsWith('..') || inside.startsWith(sep)) {
    throw new Error('Path escapes pod home')
  }
  let current = home
  for (const part of name.split('/').slice(0, -1)) {
    current = join(current, part)
    if (!existsSync(current)) {
      mkdirSync(current, { mode: 0o700 })
    }
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
      throw new Error('Unsafe parent directory')
    }
  }
  return target
}

export function installPrivateFile(
  home: string,
  name: string,
  value: string | Buffer,
  mode = 0o600
): 'created' | 'unchanged' | 'preserved' {
  const target = confinedFile(home, name)
  if (existsSync(target)) {
    const stat = lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
      throw new Error('Unsafe existing file')
    }
    chmodSync(target, mode)
    return readFileSync(target).equals(Buffer.from(value)) ? 'unchanged' : 'preserved'
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, value, { flag: 'wx', mode })
  return 'created'
}
