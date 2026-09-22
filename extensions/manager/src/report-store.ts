import { randomUUID } from 'node:crypto'
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  reportDraftSchema,
  reportVersionSchema,
  sessionSchema,
  type ManagerSession,
  type ReportVersion
} from './contracts'
import {
  atomicWrite,
  ensureDirectory,
  isInside,
  readJson,
  validateRunPath,
  withRunLock
} from './scoped-files'
import { renderReportHtml } from './report-html'
import { buildManagerPrompt } from './manager-prompt'

export async function loadSession(runDir: string): Promise<ManagerSession> {
  const actual = await validateRunPath(runDir)
  const session = sessionSchema.parse(await readJson(join(actual, 'session.json')))
  if (actual !== join(session.workspace, '.orca-manager', 'runs', session.id)) {
    throw new Error('Run metadata does not match its workspace-owned directory.')
  }
  return session
}

export async function prepareSession(
  input: Omit<ManagerSession, 'schemaVersion' | 'id' | 'createdAt'>,
  requestId: string = randomUUID()
): Promise<string> {
  const workspace = await realpath(input.workspace)
  const session = sessionSchema.parse({
    ...input,
    workspace,
    schemaVersion: 1,
    id: requestId,
    createdAt: new Date().toISOString()
  })
  const root = join(workspace, '.orca-manager')
  await ensureDirectory(root)
  await ensureDirectory(join(root, 'runs'))
  const runDir = join(root, 'runs', session.id)
  try {
    await mkdir(runDir, { mode: 0o700 })
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
      throw error
    }
    const previous = await loadSession(runDir)
    const { createdAt: _created, ...oldDefinition } = previous
    const { createdAt: _now, ...newDefinition } = session
    if (JSON.stringify(oldDefinition) !== JSON.stringify(newDefinition)) {
      throw new Error(
        'This request ID already belongs to a different team. Inspect the existing run.'
      )
    }
    // Interrupted preparation never grants permission to launch with missing instructions.
    await readJson(join(runDir, 'report-draft.json'))
    await realpath(join(runDir, 'manager-prompt.md'))
    await realpath(join(runDir, 'report.html'))
    return runDir
  }
  await mkdir(join(runDir, 'reports'), { mode: 0o700 })
  await writeFile(join(runDir, 'session.json'), JSON.stringify(session, null, 2), {
    flag: 'wx',
    mode: 0o600
  })
  await writeFile(join(runDir, 'manager-prompt.md'), buildManagerPrompt(session, runDir), {
    flag: 'wx',
    mode: 0o600
  })
  const initial = {
    status: 'planning',
    summary: 'Prepared. Manager launch has not been confirmed.',
    tasks: [],
    decisions: [],
    nextSteps: ['Start the manager, then follow its reports here.']
  }
  await writeFile(join(runDir, 'report-draft.json'), JSON.stringify(initial, null, 2), {
    flag: 'wx',
    mode: 0o600
  })
  await publishReport(runDir, initial)
  return runDir
}

export async function recentVersions(runDir: string): Promise<ReportVersion[]> {
  const names = (await readdir(join(runDir, 'reports')))
    .filter((name) => /^\d{8}\.json$/.test(name))
    .sort()
    .slice(-11)
  return Promise.all(
    names.map(async (name) =>
      reportVersionSchema.parse(await readJson(join(runDir, 'reports', name)))
    )
  )
}

export async function publishReport(
  runDir: string,
  input: unknown
): Promise<{ version: number; changed: boolean; report: string }> {
  const session = await loadSession(runDir)
  const report = reportDraftSchema.parse(input)
  if (Buffer.byteLength(JSON.stringify(report)) > 128 * 1024) {
    throw new Error('Keep report content below 128 KiB; reference large artifacts by path.')
  }
  const reports = join(runDir, 'reports')
  await ensureDirectory(reports)
  if (!isInside(session.workspace, reports)) {
    throw new Error('Reports must remain inside the workspace.')
  }
  return withRunLock(runDir, async () => {
    const versions = await recentVersions(runDir)
    const previous = versions.at(-1)
    const changed = !previous || JSON.stringify(previous.report) !== JSON.stringify(report)
    const version = changed ? (previous?.version ?? 0) + 1 : previous.version
    if (version > 99_999_999) {
      throw new Error('Report history limit reached.')
    }
    if (changed) {
      const record: ReportVersion = {
        schemaVersion: 1,
        version,
        publishedAt: new Date().toISOString(),
        report
      }
      await atomicWrite(
        join(reports, `${String(version).padStart(8, '0')}.json`),
        JSON.stringify(record, null, 2),
        false
      )
      versions.push(record)
    }
    // Re-render even after a duplicate so retry repairs a crash between history and HTML publication.
    const path = join(runDir, 'report.html')
    await atomicWrite(path, renderReportHtml(session, versions))
    return { version, changed, report: path }
  })
}
