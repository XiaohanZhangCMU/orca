import { describe, expect, it } from 'vitest'
import { _electron } from '@stablyai/playwright-test'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

describe.skipIf(process.env.ORCA_MANAGER_RENDER_TEST !== '1')(
  'hidden Electron team creation UI',
  () => {
    it('renders both themes and independently selects providers/models without starting real agents', async () => {
      const root = await mkdtemp(join(tmpdir(), 'orca-team-dialog-'))
      const fixtureRoot = import.meta.dirname
      const output = join(root, 'ui')
      await build({
        configFile: false,
        root: fixtureRoot,
        base: './',
        logLevel: 'error',
        plugins: [react(), tailwindcss()],
        resolve: { alias: { '@': resolve('../../src/renderer/src') } },
        build: { outDir: output, rollupOptions: { input: join(fixtureRoot, 'team-dialog.html') } }
      })
      const profile = join(root, 'profile')
      await mkdir(profile)
      const application = await _electron.launch({
        args: [join(fixtureRoot, 'report-window.cjs')],
        env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_MANAGER_TEST_PROFILE: profile }
      })
      try {
        const page = await application.firstWindow()
        await page.goto(pathToFileURL(join(output, 'team-dialog.html')).href)
        await page.getByRole('heading', { name: 'New manager team' }).waitFor()
        await page.evaluate(() =>
          document.documentElement.classList.add('theme-transition-disabled')
        )
        expect(
          await page.getByRole('dialog').evaluate((dialog) => getComputedStyle(dialog).position)
        ).toBe('fixed')
        await page
          .getByLabel('What should the team accomplish?')
          .fill('Audit the parser and report verified findings')
        const first = page.getByRole('group', { name: 'Worker 1', exact: true })
        const second = page.getByRole('group', { name: 'Worker 2', exact: true })
        await first.getByLabel('Provider', { exact: true }).click()
        await page.getByRole('option', { name: 'OpenCode', exact: true }).click()
        await first.getByText('opencode models', { exact: true }).waitFor()
        expect(await first.getByText('opencode models', { exact: true }).count()).toBe(1)
        expect(await first.getByLabel('Model', { exact: true }).textContent()).toContain(
          'Provider default'
        )
        await page.getByRole('button', { name: 'Create team', exact: true }).click()
        expect(
          JSON.parse((await page.getByTestId('submitted').textContent()) ?? '').workers[0]
        ).toEqual({ name: 'Worker 1', provider: 'opencode' })
        await page.getByText('4 Dreamteam-compatible models', { exact: false }).waitFor()
        const screenshots = resolve('test-results')
        await mkdir(screenshots, { recursive: true })
        await first.getByLabel('Model', { exact: true }).click()
        await page.getByRole('option', { name: 'GLM-5.2', exact: true }).waitFor()
        expect(
          await page.getByRole('option', { name: 'Kimi-K3 (baseten)', exact: true }).count()
        ).toBe(1)
        expect(
          await page.getByRole('option', { name: 'Kimi-K3 (baseten-k3)', exact: true }).count()
        ).toBe(1)
        expect(await page.getByRole('option', { name: 'big-pickle', exact: false }).count()).toBe(0)
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await page.screenshot({
          path: join(screenshots, 'manager-opencode-models-dark.png'),
          animations: 'disabled'
        })
        await page.evaluate(() => document.documentElement.classList.remove('dark'))
        await page.screenshot({
          path: join(screenshots, 'manager-opencode-models-light.png'),
          animations: 'disabled'
        })
        await page.getByRole('option', { name: 'GLM-5.2', exact: true }).click()
        await second.getByLabel('Provider', { exact: true }).click()
        await page.getByRole('option', { name: 'OpenCode', exact: true }).click()
        await second.getByLabel('Model', { exact: true }).click()
        await page.getByRole('option', { name: 'Kimi-K3 (baseten-k3)', exact: true }).click()
        await page.getByRole('button', { name: 'Create team', exact: true }).click()
        expect(JSON.parse((await page.getByTestId('submitted').textContent()) ?? '')).toMatchObject(
          {
            workers: [
              { provider: 'opencode', model: 'baseten/zai-org/GLM-5.2' },
              { provider: 'opencode', model: 'baseten-k3/moonshotai/Kimi-K3' },
              { provider: 'codex' }
            ]
          }
        )
        await first.getByLabel('Model', { exact: true }).click()
        await page.getByRole('option', { name: 'Custom model ID…' }).click()
        await first
          .getByLabel('Custom model ID', { exact: true })
          .fill('local-fixture/org/model:Q4_K_M')
        await second.getByLabel('Provider', { exact: true }).click()
        await page.getByRole('option', { name: 'Cursor', exact: true }).click()
        await page.getByRole('button', { name: 'Create team', exact: true }).click()
        const submitted = await page.getByTestId('submitted').textContent()
        expect(JSON.parse(submitted ?? '')).toMatchObject({
          workers: [
            { name: 'Worker 1', provider: 'opencode', model: 'local-fixture/org/model:Q4_K_M' },
            { name: 'Worker 2', provider: 'cursor' },
            { name: 'Worker 3', provider: 'codex' }
          ]
        })
        await page.locator('div.scrollbar-sleek').evaluate((element) => {
          element.scrollTop = 0
        })
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await page.screenshot({
          path: join(screenshots, 'manager-team-dark.png'),
          animations: 'disabled'
        })
        expect(
          await page
            .getByRole('dialog')
            .evaluate((dialog) => getComputedStyle(dialog).backgroundColor)
        ).toBe('rgba(23, 23, 23, 0.96)')
        await page.evaluate(() => document.documentElement.classList.remove('dark'))
        await page.screenshot({
          path: join(screenshots, 'manager-team-light.png'),
          animations: 'disabled'
        })
        await first.getByLabel('Provider', { exact: true }).click()
        await page.getByRole('option', { name: 'Codex / OpenAI' }).click()
        expect(await first.getByLabel('Model', { exact: true }).textContent()).toContain(
          'Provider default'
        )
        expect(await first.getByLabel('Custom model ID', { exact: true }).count()).toBe(0)
        expect(await first.getByText('opencode models', { exact: true }).count()).toBe(0)
        expect(await second.getByLabel('Provider', { exact: true }).textContent()).toContain(
          'Cursor'
        )
        expect(
          await application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().every((window) => !window.isVisible())
          )
        ).toBe(true)
        expect(await page.evaluate(() => 'require' in window)).toBe(false)
        for (const scenario of ['empty', 'error', 'removed']) {
          await page.goto(
            `${pathToFileURL(join(output, 'team-dialog.html')).href}?models=${scenario}`
          )
          await page.getByLabel('What should the team accomplish?').fill('Fixture')
          await first.getByLabel('Provider', { exact: true }).click()
          await page.getByRole('option', { name: 'OpenCode', exact: true }).click()
          if (scenario === 'error') {
            await page.getByRole('alert').filter({ hasText: 'Fixture host unavailable' }).waitFor()
            await page.getByRole('button', { name: 'Reload OpenCode models' }).click()
            await page.getByText('4 Dreamteam-compatible models', { exact: false }).waitFor()
          } else if (scenario === 'removed') {
            await page.getByText('4 Dreamteam-compatible models', { exact: false }).waitFor()
            await first.getByLabel('Model', { exact: true }).click()
            await page.getByRole('option', { name: 'DeepSeek-V4-Pro', exact: true }).click()
            await page.getByRole('button', { name: 'Reload OpenCode models' }).click()
            await page
              .getByText('No Dreamteam-compatible models were listed.', { exact: false })
              .waitFor()
            expect(await first.getByLabel('Model', { exact: true }).textContent()).toContain(
              'baseten/deepseek-ai/DeepSeek-V4-Pro (not in current list)'
            )
            await page.getByRole('button', { name: 'Create team', exact: true }).click()
            expect(
              JSON.parse((await page.getByTestId('submitted').textContent()) ?? '').workers[0].model
            ).toBe('baseten/deepseek-ai/DeepSeek-V4-Pro')
          } else {
            await page
              .getByText('No Dreamteam-compatible models were listed.', { exact: false })
              .waitFor()
            await first.getByLabel('Model', { exact: true }).click()
            expect(await page.getByRole('option').allTextContents()).toEqual([
              'Provider default',
              'Custom model ID…'
            ])
            await page.getByRole('option', { name: 'Custom model ID…' }).click()
            await first.getByLabel('Custom model ID', { exact: true }).fill('local-fixture/model')
            await page.getByRole('button', { name: 'Create team', exact: true }).click()
            expect(
              JSON.parse((await page.getByTestId('submitted').textContent()) ?? '').workers[0].model
            ).toBe('local-fixture/model')
          }
        }
      } finally {
        await application.close()
        await rm(root, { recursive: true, force: true })
      }
    }, 60_000)
  }
)
