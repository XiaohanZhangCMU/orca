import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { requireLinux, validatePort, validateUser, type HostConfig } from '../src/host-config'
import {
  copyNativeDependencies,
  ensureDirectory,
  hashFile,
  installPublicKey,
  linkLaunchers,
  requireNativeBinary,
  shellQuote,
  validatePublicKey,
  verifyInstalledFiles,
  writeLaunchers
} from '../src/runtime-files'

const roots: string[] = []
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'orca-pod-setup-test-'))
  roots.push(home)
  const root = join(home, '.local', 'share', 'orca-pod-host')
  const config: HostConfig = {
    version: 1,
    user: 'orca',
    uid: process.getuid?.() ?? 1000,
    gid: process.getgid?.() ?? 1000,
    home,
    root,
    profile: join(home, '.orca'),
    workspace: join(home, 'Codes', 'workspace'),
    port: 6770,
    source: join(home, 'source'),
    hashes: {},
    installedAt: 'fixture'
  }
  mkdirSync(join(root, 'bin'), { recursive: true })
  mkdirSync(join(home, '.local', 'bin'), { recursive: true })
  return config
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('pod setup boundaries', () => {
  it('requires Linux and a non-root account', () => {
    expect(() => requireLinux('linux')).not.toThrow()
    expect(() => requireLinux('darwin')).toThrow('Linux')
    expect(() => requireLinux('win32')).toThrow('Linux')
    for (const user of ['root', '../orca', 'orca;id', 'orca user', '-orca']) {
      expect(() => validateUser(user)).toThrow()
    }
    expect(() => validateUser('orca-dev')).not.toThrow()
  })

  it('refuses privileged, invalid, and ephemeral ports', () => {
    for (const port of [0, 22, -1, 65536, 1.5, Number.NaN]) {
      expect(() => validatePort(port)).toThrow()
    }
    expect(() => validatePort(6770)).not.toThrow()
  })

  it('accepts one public key, never a private key, options, or multiple keys', () => {
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEZpeHR1cmVLZXk= laptop'
    expect(validatePublicKey(`${key}\n`)).toBe(key)
    for (const input of [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      `command="id" ${key}`,
      `${key}\n${key}`
    ]) {
      expect(() => validatePublicKey(input)).toThrow('public key')
    }
  })

  it('hashes large binaries without changing their contents', () => {
    const config = fixture()
    const path = join(config.home, 'binary')
    const contents = Buffer.alloc(2_100_123, 7)
    writeFileSync(path, contents)
    expect(hashFile(path)).toBe(createHash('sha256').update(contents).digest('hex'))
    expect(readFileSync(path)).toEqual(contents)
  })

  it('refuses shell/npm shims and binaries for another architecture', () => {
    const config = fixture()
    const path = join(config.home, 'agent')
    writeFileSync(path, '#!/bin/sh\nexec something\n')
    expect(() => requireNativeBinary(path)).toThrow('standalone Linux')
    const header = Buffer.alloc(20)
    header.write('7f454c46', 0, 'hex')
    header[4] = 2
    header[5] = 1
    header.writeUInt16LE(process.arch === 'x64' ? 62 : 183, 18)
    writeFileSync(path, header)
    expect(() => requireNativeBinary(path)).not.toThrow()
    header.writeUInt16LE(3, 18)
    writeFileSync(path, header)
    expect(() => requireNativeBinary(path)).toThrow()
  })

  it('quotes paths without interpreting shell syntax', () => {
    expect(shellQuote("/tmp/a'b $(id)")).toBe("'/tmp/a'\\''b $(id)'")
  })
})

describe.skipIf(process.platform === 'win32')('account-owned filesystem installation', () => {
  it('rejects traversal and symlinked parent directories', () => {
    const config = fixture()
    const outside = fixture()
    symlinkSync(outside.home, join(config.home, 'redirect'))
    expect(() =>
      ensureDirectory(join(config.home, 'redirect', 'child'), config.home, config.uid, config.gid)
    ).toThrow('account-owned')
    expect(() =>
      ensureDirectory(join(config.home, '..', 'other'), config.home, config.uid, config.gid)
    ).toThrow('escapes')
  })

  it('creates idempotent launchers without replacing unrelated commands', () => {
    const config = fixture()
    writeLaunchers(config.root, config)
    for (const name of ['node', 'claude', 'opencode']) {
      writeFileSync(join(config.root, 'bin', name), 'fixture')
    }
    linkLaunchers(config)
    expect(() => linkLaunchers(config)).not.toThrow()
    expect(readlinkSync(join(config.home, '.local', 'bin', 'orca-host'))).toBe(
      join(config.root, 'bin', 'orca-host')
    )
    const second = fixture()
    writeFileSync(join(second.home, '.local', 'bin', 'node'), 'user-owned')
    expect(() => linkLaunchers(second)).toThrow('Refusing to replace')
    expect(readFileSync(join(second.home, '.local', 'bin', 'node'), 'utf8')).toBe('user-owned')
  })

  it('fences ccskip to the non-root UID and does not override root protections', () => {
    const config = fixture()
    writeLaunchers(config.root, config)
    const script = readFileSync(join(config.root, 'bin', 'ccskip'), 'utf8')
    expect(script).toContain(`"$(id -u)" = ${config.uid}`)
    expect(script).toContain('unset IS_SANDBOX')
    expect(script).toContain('--dangerously-skip-permissions "$@"')
    expect(script).not.toContain('IS_SANDBOX=1')
  })

  it('preserves SSH keys and avoids adding the same key twice', () => {
    const config = fixture()
    const key = validatePublicKey('ssh-ed25519 AAAAFixtureOne laptop')
    const second = validatePublicKey('ssh-ed25519 AAAAFixtureTwo backup')
    installPublicKey(config, key)
    installPublicKey(config, second)
    installPublicKey(config, key)
    const path = join(config.home, '.ssh', 'authorized_keys')
    expect(readFileSync(path, 'utf8')).toBe(`${key}\n${second}\n`)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('refuses dangling authorized_keys links without writing their targets', () => {
    const config = fixture()
    mkdirSync(join(config.home, '.ssh'))
    const target = join(config.home, 'unrelated')
    symlinkSync(target, join(config.home, '.ssh', 'authorized_keys'))
    expect(() => installPublicKey(config, 'ssh-ed25519 AAAAFixture laptop')).toThrow('Unsafe')
    expect(() => readFileSync(target)).toThrow()
  })

  it('detects changed installed artifacts before reusing a host', () => {
    const config = fixture()
    const path = join(config.root, 'bin', 'node')
    writeFileSync(path, 'original')
    const hashes = { node: hashFile(path) }
    expect(() => verifyInstalledFiles(config.root, hashes)).not.toThrow()
    writeFileSync(path, 'changed')
    expect(() => verifyInstalledFiles(config.root, hashes)).toThrow('differs')
  })

  it('copies Linux native dependencies without copying source credentials', () => {
    const config = fixture()
    mkdirSync(config.source)
    writeFileSync(join(config.source, 'package.json'), '{}')
    writeFileSync(join(config.source, 'auth.json'), 'do not copy')
    const packages = ['node-pty', '@parcel/watcher', `@parcel/watcher-linux-${process.arch}-glibc`]
    for (const name of packages) {
      const path = join(config.source, 'node_modules', name)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
      writeFileSync(join(path, 'native.node'), 'fixture')
    }
    const target = join(config.root, 'node_modules')
    copyNativeDependencies(config.source, target)
    expect(readFileSync(join(target, 'node-pty', 'native.node'), 'utf8')).toBe('fixture')
    expect(
      readFileSync(
        join(target, '@parcel/watcher', 'node_modules', packages[2], 'native.node'),
        'utf8'
      )
    ).toBe('fixture')
    expect(() => readFileSync(join(config.root, 'auth.json'))).toThrow()
  })
})
