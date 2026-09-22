import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { prepareSession, publishReport, loadSession, recentVersions } from '../src/report-store'
import { atomicWrite, readJson, withRunLock } from '../src/scoped-files'
import { reportDraftSchema } from '../src/contracts'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orca-manager-test-'))
  roots.push(root)
  const run = await prepareSession({
    workspace: root,
    objective: 'Test a folder without Git',
    workers: 3,
    managerAgent: 'codex',
    workerAgent: 'claude',
    orca: process.execPath,
    publisher: '/test/orca-manager.cjs'
  })
  return { root, run }
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('workspace-owned report publication', () => {
  it('prepares a folder workspace without requiring Git or a running agent', async () => {
    const { root, run } = await fixture()
    expect((await loadSession(run)).workspace).toContain(basename(root))
    const html = await readFile(join(run, 'report.html'), 'utf8')
    expect(html).toContain('Manager launch has not been confirmed')
    expect(html).toContain('not a live process-status feed')
    const prompt = await readFile(join(run, 'manager-prompt.md'), 'utf8')
    expect(prompt).toContain('at most 3 ICs')
    expect(prompt).toContain('skills get orchestration --full')
    expect(prompt).toContain('worker-release')
    expect(prompt).toContain('unverifiable')
  })

  it('versions changed reports and repairs HTML on a duplicate publication', async () => {
    const { run } = await fixture()
    const draft = { status: 'working', summary: 'Two ICs returned evidence.' }
    expect(await publishReport(run, draft)).toMatchObject({ changed: true, version: 2 })
    await writeFile(join(run, 'report.html'), 'interrupted old output')
    expect(await publishReport(run, draft)).toMatchObject({ changed: false, version: 2 })
    expect(await readdir(join(run, 'reports'))).toHaveLength(2)
    expect(await readFile(join(run, 'report.html'), 'utf8')).toContain('Two ICs returned evidence.')
    expect((await recentVersions(run)).at(-1)?.report.summary).toBe(draft.summary)
  })

  it('escapes reports instead of executing agent-authored HTML', async () => {
    const { run } = await fixture()
    await publishReport(run, {
      status: 'completed',
      summary: '<script>alert("bad")</script>',
      tasks: [
        {
          title: '<img src=x onerror=alert(1)>',
          summary: 'Verified',
          outcome: 'completed',
          evidence: ['<iframe src="https://example.com">']
        }
      ]
    })
    const html = await readFile(join(run, 'report.html'), 'utf8')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain("connect-src 'none'")
    expect(html).not.toContain('id="refresh"')
  })

  it('bounds report size and rejects malformed status without changing history', async () => {
    const { run } = await fixture()
    await expect(
      publishReport(run, { status: 'done', summary: 'Not a valid status' })
    ).rejects.toThrow()
    await expect(
      publishReport(run, {
        status: 'working',
        summary: 'Large',
        decisions: Array(10).fill('x'.repeat(20_000))
      })
    ).rejects.toThrow('128 KiB')
    expect(await readdir(join(run, 'reports'))).toHaveLength(1)
  })

  it('refuses concurrent publication and does not steal the existing lock', async () => {
    const { run } = await fixture()
    await withRunLock(run, async () => {
      await expect(
        publishReport(run, { status: 'working', summary: 'Concurrent' })
      ).rejects.toThrow('already locked')
      expect(await readJson(join(run, 'publish.lock'))).toHaveProperty('pid', process.pid)
    })
    expect(await readdir(run)).not.toContain('publish.lock')
  })

  it('refuses a symlinked report directory and forged workspace metadata', async () => {
    const { run } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'orca-manager-outside-'))
    roots.push(outside)
    await rm(join(run, 'reports'), { recursive: true })
    await symlink(outside, join(run, 'reports'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(publishReport(run, { status: 'working', summary: 'No escape' })).rejects.toThrow(
      'symlinks'
    )
    expect(await readdir(outside)).toEqual([])
    const session = await loadSession(run)
    await writeFile(join(run, 'session.json'), JSON.stringify({ ...session, workspace: outside }))
    await expect(loadSession(run)).rejects.toThrow('does not match')
  })

  it('rejects arbitrary HTML fields in the report contract', () => {
    expect(
      reportDraftSchema.safeParse({ status: 'working', summary: 'Safe', html: '<script>' }).success
    ).toBe(false)
  })

  it('never overwrites an immutable version and leaves no temporary file behind', async () => {
    const { run } = await fixture()
    const snapshot = join(run, 'reports', '00000001.json')
    const original = await readFile(snapshot, 'utf8')
    await expect(atomicWrite(snapshot, 'overwrite', false)).rejects.toThrow()
    expect(await readFile(snapshot, 'utf8')).toBe(original)
    expect(await readdir(join(run, 'reports'))).toEqual(['00000001.json'])
  })
})
