import {
  chmodSync,
  chownSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { runProcess } from '../../../src/shared/child-process/run-process'
import {
  readHostConfig,
  requireLinux,
  validatePort,
  validateUser,
  type HostConfig
} from './host-config'
import {
  assertDirectory,
  copyNativeDependencies,
  ensureDirectory,
  entryExists,
  hashFile,
  installPublicKey,
  launcherNames,
  linkLaunchers,
  ownNewTree,
  requireNativeBinary,
  validatePublicKey,
  verifyInstalledFiles,
  writeLaunchers
} from './runtime-files'

export type InstallOptions = {
  source: string
  node: string
  claude: string
  opencode: string
  user: string
  port: number
  publicKey?: string
  dryRun: boolean
  controller: string
}

async function command(program: string, args: string[], allowMissing = false): Promise<string> {
  const result = await runProcess({ program, args, timeoutMs: 15_000, maxOutputBytes: 32_000 })
  if (allowMissing && result.code === 2) {
    return ''
  }
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    throw new Error(`${program} preflight failed`)
  }
  return result.stdout.trim()
}

async function lookupAccount(user: string, home: string) {
  const passwd = await command('getent', ['passwd', user], true)
  if (!passwd) {
    return null
  }
  const fields = passwd.split(':')
  const uid = Number(fields[2])
  const gid = Number(fields[3])
  if (
    !Number.isSafeInteger(uid) ||
    !Number.isSafeInteger(gid) ||
    uid < 1000 ||
    gid <= 0 ||
    fields[5] !== home ||
    fields[6] !== '/bin/bash'
  ) {
    throw new Error(
      'Existing account is not a dedicated non-root bash account at the expected home'
    )
  }
  const groups = (await command('id', ['-G', user])).split(/\s+/)
  if (groups.some((group) => Number(group) !== gid)) {
    throw new Error('Refusing an account with supplementary groups')
  }
  assertDirectory(home, uid)
  return { uid, gid }
}

export function preflightFiles(options: InstallOptions) {
  validateUser(options.user)
  validatePort(options.port)
  const source = realpathSync(options.source)
  const home = join('/home', options.user)
  const root = join(home, '.local', 'share', 'orca-pod-host')
  const binaries = {
    node: realpathSync(options.node),
    claude: realpathSync(options.claude),
    opencode: realpathSync(options.opencode)
  }
  for (const path of Object.values(binaries)) {
    requireNativeBinary(path)
  }
  const hashes: Record<string, string> = {}
  for (const [name, path] of Object.entries(binaries)) {
    hashes[name] = hashFile(path)
  }
  for (const name of [
    'orcad.js',
    'daemon-entry.js',
    'parcel-watcher-process-entry.js',
    'manager/orca.cjs',
    'manager/orca-manager.cjs'
  ]) {
    hashes[name] = hashFile(join(source, 'out', 'orcad', name))
  }
  hashes.controller = hashFile(options.controller)
  const publicKey = options.publicKey
    ? validatePublicKey(readFileSync(options.publicKey, 'utf8'))
    : null
  return { source, home, root, binaries, hashes, publicKey }
}

export async function installHost(options: InstallOptions): Promise<HostConfig | null> {
  requireLinux()
  const plan = preflightFiles(options)
  const major = await command(plan.binaries.node, ['-p', 'process.versions.node.split(".")[0]'])
  if (major !== '24') {
    throw new Error('Use a Node 24 binary for this source build')
  }
  const existing = await lookupAccount(options.user, plan.home)
  if (process.getuid?.() !== 0 && (!existing || existing.uid !== process.getuid?.())) {
    throw new Error('Run as root to create an account, or as the existing dedicated account')
  }
  if (
    !existing &&
    (existsSync(plan.home) || (await command('getent', ['group', options.user], true)))
  ) {
    throw new Error('Home or group already exists without the expected account')
  }
  if (existsSync(plan.root)) {
    if (!existing) {
      throw new Error('Installation exists without its account')
    }
    for (const directory of [
      join(plan.home, '.local'),
      join(plan.home, '.local', 'share'),
      plan.root
    ]) {
      assertDirectory(directory, existing.uid)
    }
    const config = readHostConfig(plan.root)
    if (
      !existing ||
      config.user !== options.user ||
      config.uid !== existing.uid ||
      config.gid !== existing.gid ||
      config.home !== plan.home ||
      config.workspace !== join(plan.home, 'Codes', 'workspace') ||
      config.port !== options.port ||
      JSON.stringify(config.hashes) !== JSON.stringify(plan.hashes)
    ) {
      throw new Error(
        'Existing installation differs; no upgrade, restart, or overwrite was attempted'
      )
    }
    verifyInstalledFiles(plan.root, plan.hashes)
    if (options.dryRun) {
      console.log(JSON.stringify({ action: 'reuse', root: plan.root }))
      return null
    }
    linkLaunchers(config)
    if (plan.publicKey) {
      installPublicKey(config, plan.publicKey)
    }
    return config
  }
  if (existsSync(join(plan.home, '.orca'))) {
    throw new Error('Existing Orca profile is not managed by this setup; choose a separate user')
  }
  for (const directory of [
    join(plan.home, '.local'),
    join(plan.home, '.local', 'bin'),
    join(plan.home, '.local', 'share')
  ]) {
    if (existsSync(directory) && existing) {
      assertDirectory(directory, existing.uid)
    }
  }
  for (const name of launcherNames) {
    const path = join(plan.home, '.local', 'bin', name)
    try {
      lstatSync(path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    throw new Error(`Existing command would be replaced: ${path}; choose a separate user`)
  }
  if (options.dryRun) {
    console.log(
      JSON.stringify({
        action: 'install',
        user: options.user,
        home: plan.home,
        root: plan.root,
        port: options.port,
        source: plan.source,
        hashes: plan.hashes
      })
    )
    return null
  }
  if (!existing) {
    await command('useradd', [
      '--create-home',
      '--user-group',
      '--shell',
      '/bin/bash',
      options.user
    ])
  }
  const account = existing ?? (await lookupAccount(options.user, plan.home))
  if (!account) {
    throw new Error('New account was not created')
  }
  chmodSync(plan.home, 0o700)
  const config: HostConfig = {
    version: 1,
    user: options.user,
    ...account,
    home: plan.home,
    root: plan.root,
    profile: join(plan.home, '.orca'),
    workspace: join(plan.home, 'Codes', 'workspace'),
    port: options.port,
    hashes: plan.hashes,
    source: plan.source,
    installedAt: new Date().toISOString()
  }
  for (const directory of [
    join(plan.home, '.local', 'share'),
    join(plan.home, '.local', 'bin'),
    config.workspace
  ]) {
    ensureDirectory(directory, plan.home, account.uid, account.gid)
  }
  const stage = mkdtempSync(join(plan.home, '.local', 'share', '.orca-pod-host-stage-'))
  try {
    cpSync(join(plan.source, 'out', 'orcad'), stage, {
      recursive: true,
      dereference: true,
      force: false,
      errorOnExist: true
    })
    copyNativeDependencies(plan.source, join(stage, 'node_modules'))
    mkdirSync(join(stage, 'bin'))
    for (const [name, path] of Object.entries(plan.binaries)) {
      cpSync(path, join(stage, 'bin', name), { errorOnExist: true, force: false })
      chmodSync(join(stage, 'bin', name), 0o755)
    }
    cpSync(resolve(options.controller), join(stage, 'host-control.cjs'), {
      errorOnExist: true,
      force: false
    })
    writeLaunchers(stage, config)
    writeFileSync(join(stage, 'setup.json'), JSON.stringify(config, null, 2), {
      mode: 0o600,
      flag: 'wx'
    })
    verifyInstalledFiles(stage, plan.hashes)
    ownNewTree(stage, account.uid, account.gid)
    renameSync(stage, plan.root)
  } catch (error) {
    console.error(`Incomplete staging retained for inspection: ${stage}`)
    throw error
  }
  linkLaunchers(config)
  if (plan.publicKey) {
    installPublicKey(config, plan.publicKey)
  }
  const profile = join(plan.home, '.profile')
  const marker = '# Orca pod host commands'
  if (
    entryExists(profile) &&
    (!lstatSync(profile).isFile() || lstatSync(profile).uid !== account.uid)
  ) {
    throw new Error(
      'Refusing an unsafe shell profile; installation is present but PATH was not changed'
    )
  }
  const text = existsSync(profile) ? readFileSync(profile, 'utf8') : ''
  if (!text.includes(marker)) {
    writeFileSync(profile, `${text}\n${marker}\nexport PATH="$HOME/.local/bin:$PATH"\n`, {
      mode: 0o600
    })
    chownSync(profile, account.uid, account.gid)
  }
  return config
}
