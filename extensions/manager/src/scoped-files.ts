import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export async function readJson(path: string): Promise<unknown> {
  if ((await lstat(path)).isSymbolicLink()) {
    throw new Error('JSON artifacts must not be symlinks.')
  }
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 1024 * 1024) {
      throw new Error('Expected a JSON file under 1 MiB.')
    }
    return JSON.parse(await file.readFile('utf8'))
  } finally {
    await file.close()
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error
    }
  })
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Manager output directories must not be symlinks: ${path}`)
  }
}

export function isInside(root: string, path: string): boolean {
  const value = relative(root, path)
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)
}

export async function validateRunPath(path: string): Promise<string> {
  const absolute = resolve(path)
  if ((await realpath(absolute)) !== absolute) {
    throw new Error('Manager run paths must not contain symlinks.')
  }
  return absolute
}

export async function atomicWrite(path: string, content: string, replace = true): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(content)
      await file.sync()
    } finally {
      await file.close()
    }
    // A hard link publishes a complete immutable snapshot without replacing a version.
    await (replace ? rename(temporary, path) : link(temporary, path))
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

export async function withRunLock<T>(runDir: string, operation: () => Promise<T>): Promise<T> {
  const path = join(runDir, 'publish.lock')
  const lock = await open(path, 'wx', 0o600).catch(() => {
    throw new Error(
      `A report publication is already locked. Inspect ${path}; do not retry concurrently.`
    )
  })
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    return await operation()
  } finally {
    await lock.close()
    await unlink(path)
  }
}
