import { describe, expect, it } from 'vitest'
import { _electron } from '@stablyai/playwright-test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { z } from 'zod'

describe.skipIf(process.env.ORCA_MANAGER_RENDER_TEST !== '1')('hidden Electron report', () => {
  it('renders, escapes content, and refreshes a published report through a real browser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-manager-render-'))
    const publisher = resolve('dist/orca-manager.cjs')
    const invoke = async (args: string[]) => {
      const result = await runProcess({
        program: process.execPath,
        args: [publisher, ...args],
        env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' }
      })
      expect(result.code, result.stderr).toBe(0)
      return JSON.parse(result.stdout)
    }
    const profile = join(root, 'profile')
    await mkdir(profile)
    const prepared = z
      .object({ run: z.string(), report: z.string() })
      .parse(
        await invoke([
          'prepare',
          '--workspace',
          root,
          '--goal',
          'Audit checkout and summarize the evidence',
          '--orca',
          process.execPath
        ])
      )
    const draft = join(root, 'draft.json')
    await writeFile(
      draft,
      JSON.stringify({
        status: 'working',
        summary: 'Two ICs have returned findings. Independent verification is next.',
        tasks: [
          {
            title: 'Checkout audit',
            outcome: 'completed',
            summary: 'The IC supplied a test transcript.',
            evidence: ['Fixture evidence only — no production agents ran.']
          }
        ],
        decisions: ['Approve the proposed scope before making changes.']
      })
    )
    await invoke(['publish', '--run', prepared.run, '--input', draft])
    const application = await _electron.launch({
      args: [fileURLToPath(new URL('./report-window.cjs', import.meta.url))],
      env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_MANAGER_TEST_PROFILE: profile }
    })
    try {
      const page = await application.firstWindow()
      await page.goto(pathToFileURL(prepared.report).href)
      await page
        .getByRole('heading', { name: 'Audit checkout and summarize the evidence' })
        .waitFor()
      expect(
        await page.getByText('Approve the proposed scope before making changes.').count()
      ).toBe(1)
      expect(await page.evaluate(() => 'require' in window)).toBe(false)
      expect(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every((window) => !window.isVisible())
        )
      ).toBe(true)
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.evaluate(() => document.fonts.ready)
      const output = resolve('test-results')
      await mkdir(output, { recursive: true })
      await page.screenshot({ path: join(output, 'manager-report-dark.png'), fullPage: true })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.screenshot({ path: join(output, 'manager-report-light.png'), fullPage: true })
      expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(
        'Geist'
      )
      await writeFile(
        draft,
        JSON.stringify({
          status: 'completed',
          summary: 'Final verified summary. <script>window.reportInjected=true</script>'
        })
      )
      await invoke(['publish', '--run', prepared.run, '--input', draft])
      await page.getByText('Final verified summary.', { exact: false }).waitFor({ timeout: 25_000 })
      expect(await page.evaluate(() => 'reportInjected' in window)).toBe(false)
      expect(await page.locator('#refresh').count()).toBe(0)
      expect(await readFile(prepared.report, 'utf8')).toContain('Previous reports')
    } finally {
      await application.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 45_000)
})
