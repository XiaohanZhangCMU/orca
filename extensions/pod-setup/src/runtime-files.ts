import {
  chmodSync,
  chownSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import type { HostConfig } from './host-config'

export const launcherNames = ['node', 'claude', 'opencode', 'ccskip', 'orca-ide', 'orca-host']

export function entryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export function hashFile(path: string): string {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  const buffer = Buffer.alloc(1024 * 1024)
  try {
    let count: number
    while ((count = readSync(fd, buffer)) > 0) {
      hash.update(buffer.subarray(0, count))
    }
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}

export function requireNativeBinary(path: string): void {
  const fd = openSync(path, 'r')
  const header = Buffer.alloc(20)
  try {
    readSync(fd, header)
  } finally {
    closeSync(fd)
  }
  const machine = process.arch === 'x64' ? 62 : process.arch === 'arm64' ? 183 : -1
  if (
    header.subarray(0, 4).toString('hex') !== '7f454c46' ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header.readUInt16LE(18) !== machine
  ) {
    throw new Error(
      `Expected a standalone Linux ${process.arch} binary, not an npm/shell shim: ${path}`
    )
  }
}

export function verifyInstalledFiles(root: string, hashes: Record<string, string>): void {
  for (const [name, hash] of Object.entries(hashes)) {
    const path =
      name === 'controller'
        ? join(root, 'host-control.cjs')
        : ['node', 'claude', 'opencode'].includes(name)
          ? join(root, 'bin', name)
          : join(root, name)
    if (hashFile(path) !== hash) {
      throw new Error(`Installed artifact differs from its receipt: ${name}`)
    }
  }
}

export function assertDirectory(path: string, uid: number): void {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid) {
    throw new Error(`Expected an account-owned directory: ${path}`)
  }
}

export function ensureDirectory(path: string, home: string, uid: number, gid: number): void {
  const subpath = relative(home, path)
  if (subpath.startsWith('..') || subpath.startsWith(sep)) {
    throw new Error('Path escapes account home')
  }
  assertDirectory(home, uid)
  let current = home
  for (const segment of subpath.split(sep).filter(Boolean)) {
    current = join(current, segment)
    if (!existsSync(current)) {
      mkdirSync(current, { mode: 0o700 })
      chownSync(current, uid, gid)
    }
    assertDirectory(current, uid)
  }
}

export function ownNewTree(path: string, uid: number, gid: number): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) {
    throw new Error(`Unexpected symlink in staged installation: ${path}`)
  }
  chownSync(path, uid, gid)
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) {
      ownNewTree(join(path, name), uid, gid)
    }
  }
}

export function copyNativeDependencies(source: string, destination: string): void {
  const rootRequire = createRequire(join(source, 'package.json'))
  const copy = (name: string, parent: NodeRequire, modules: string, depth: number): void => {
    if (depth > 8) {
      throw new Error('Native dependency nesting exceeds the installation bound')
    }
    const manifest = parent.resolve(`${name}/package.json`)
    const directory = dirname(manifest)
    const target = join(modules, name)
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'))
    cpSync(directory, target, {
      recursive: true,
      dereference: true,
      errorOnExist: true,
      force: false,
      filter: (path) => !relative(directory, path).split(sep).includes('node_modules')
    })
    const dependencies = { ...metadata.dependencies }
    if (name === '@parcel/watcher') {
      dependencies[`@parcel/watcher-linux-${process.arch}-glibc`] = metadata.version
    }
    for (const dependency of Object.keys(dependencies)) {
      copy(dependency, createRequire(manifest), join(target, 'node_modules'), depth + 1)
    }
  }
  for (const name of ['node-pty', '@parcel/watcher']) {
    copy(name, rootRequire, destination, 0)
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function writeLaunchers(stage: string, config: HostConfig): void {
  const binary = (name: string) => shellQuote(join(config.root, 'bin', name))
  const profile = shellQuote(config.profile)
  const scripts = {
    ccskip: `#!/bin/sh\nset -eu\n[ "$(id -u)" = ${config.uid} ] || { echo 'ccskip requires the configured non-root account' >&2; exit 1; }\nunset IS_SANDBOX\nexec ${binary('claude')} --dangerously-skip-permissions "$@"\n`,
    'orca-ide': `#!/bin/sh\nexport ORCA_USER_DATA_PATH=${profile}\nexec ${binary('node')} ${shellQuote(join(config.root, 'manager', 'orca.cjs'))} "$@"\n`,
    'orca-host': `#!/bin/sh\nexec ${binary('node')} ${shellQuote(join(config.root, 'host-control.cjs'))} "$@"\n`
  }
  for (const [name, script] of Object.entries(scripts)) {
    writeFileSync(join(stage, 'bin', name), script, { flag: 'wx', mode: 0o755 })
  }
}

export function validatePublicKey(text: string): string {
  const key = text.trim()
  if (
    key.length > 8192 ||
    !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/]+={0,3}(?: [^\r\n]*)?$/.test(
      key
    )
  ) {
    throw new Error(
      'Expected one OpenSSH public key, never a private key or authorized_keys options'
    )
  }
  return key
}

export function linkLaunchers(config: HostConfig): void {
  const directory = join(config.home, '.local', 'bin')
  for (const name of launcherNames) {
    const target = join(config.root, 'bin', name)
    const path = join(directory, name)
    if (entryExists(path)) {
      if (!lstatSync(path).isSymbolicLink() || readlinkSync(path) !== target) {
        throw new Error(`Refusing to replace existing command: ${path}`)
      }
    } else {
      symlinkSync(target, path)
    }
  }
}

export function installPublicKey(config: HostConfig, key: string): void {
  const directory = join(config.home, '.ssh')
  ensureDirectory(directory, config.home, config.uid, config.gid)
  const path = join(directory, 'authorized_keys')
  let existing = ''
  if (entryExists(path)) {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.uid !== config.uid) {
      throw new Error('Unsafe authorized_keys path')
    }
    existing = readFileSync(path, 'utf8')
  }
  const identity = key.split(' ').slice(0, 2).join(' ')
  if (!existing.split('\n').some((line) => line.split(' ').slice(0, 2).join(' ') === identity)) {
    writeFileSync(path, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${key}\n`, {
      mode: 0o600
    })
    chownSync(path, config.uid, config.gid)
  }
  chmodSync(path, 0o600)
}
