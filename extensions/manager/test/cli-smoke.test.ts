import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { runProcess } from '../../../src/shared/child-process/run-process'

describe('built command smoke test', () => {
  it('starts, steers, and reports through the executable adapter without a paid agent', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-manager-cli-')))
    const fake = join(root, 'orca fixture.cjs')
    await writeFile(
      fake,
      `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.cwd(), 'commands.jsonl'), JSON.stringify(args) + '\\n');
const command = args.slice(0, 2).filter(x => x !== '--json').join(' ');
const results = {
  'status': {target:{kind:'local'},runtime:{reachable:true,runtimeId:'fixture-host',capabilities:['terminal.prompt-delivery.v1','orchestration.contract.v1']}},
  'worktree show': {worktree:{id:'workspace',repoId:'project',path:process.cwd(),hostId:'local'}},
  'repo show': {repo:{connectionId:null,executionHostId:'local'}},
  'terminal create': {terminal:{handle:'manager-handle',worktreeId:'workspace',executionHostId:'local'}},
  'terminal wait': {wait:{satisfied:true}},
  'terminal send': {send:{handle:'manager-handle',accepted:true,prompt:{stages:['input_accepted']}}}
};
if (!results[command]) throw new Error('Unexpected command: ' + command);
console.log(JSON.stringify({ok:true,result:results[command],_meta:{runtimeId:'fixture-host'}}));
`
    )
    const invoke = (args: string[]) =>
      runProcess({
        program: process.execPath,
        args: [resolve('dist/orca-manager.cjs'), ...args],
        cwd: root,
        env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
        timeoutMs: 30_000
      })
    try {
      const started = await invoke([
        'start',
        '--workspace',
        root,
        '--orca',
        fake,
        '--workers',
        '2',
        '--goal',
        'Review only; do not edit files.'
      ])
      expect(started.code, started.stderr).toBe(0)
      const result = z
        .object({
          run: z.string(),
          report: z.string(),
          launch: z.object({ stage: z.literal('prompt-accepted') })
        })
        .parse(JSON.parse(started.stdout))
      expect(await readFile(result.report, 'utf8')).toContain('Manager report')
      const message = await invoke([
        'message',
        '--run',
        result.run,
        '--text',
        'Do not change the public API.'
      ])
      expect(message.code, message.stderr).toBe(0)
      const duplicate = await invoke(['launch', '--run', result.run])
      expect(duplicate.code).toBe(1)
      expect(duplicate.stderr).toContain('already has a launch receipt')
      const commands = z.array(z.array(z.string())).parse(
        (await readFile(join(root, 'commands.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      )
      expect(commands.filter((args) => args[1] === 'create')).toHaveLength(1)
      expect(commands.filter((args) => args[1] === 'send')).toHaveLength(2)
      const stopped = await invoke(['request-stop', '--run', result.run])
      expect(stopped.code, stopped.stderr).toBe(0)
      expect(stopped.stdout).toContain('does not prove')
      const definition = {
        objective: 'UI round-trip fixture',
        manager: 'claude',
        workers: [
          { name: 'Builder', provider: 'claude', model: 'fixture-sonnet' },
          { name: 'Reviewer', provider: 'cursor' },
          {
            name: 'Open-weight reviewer',
            provider: 'opencode',
            model: 'local-fixture/model:latest'
          }
        ]
      }
      const prepareArgs = [
        'prepare',
        '--workspace',
        root,
        '--orca',
        fake,
        '--request-id',
        'e8c97a3e-68c3-43fa-8676-7f7c02b35640',
        '--team',
        JSON.stringify(definition),
        '--workspace-id',
        'workspace',
        '--runtime-id',
        'fixture-host',
        '--publisher-node',
        'node'
      ]
      const prepared = await invoke(prepareArgs)
      expect(prepared.code, prepared.stderr).toBe(0)
      const uiRun = z.object({ run: z.string() }).parse(JSON.parse(prepared.stdout)).run
      const replay = await invoke(prepareArgs)
      expect(replay.code, replay.stderr).toBe(0)
      expect(JSON.parse(replay.stdout).run).toBe(uiRun)
      const beforeLaunch = await invoke(['show', '--run', uiRun])
      expect(JSON.parse(beforeLaunch.stdout)).toMatchObject({
        launch: null,
        session: { workerProfiles: definition.workers }
      })
      const uiLaunch = await invoke(['launch', '--run', uiRun])
      expect(uiLaunch.code, uiLaunch.stderr).toBe(0)
      const afterLaunch = await invoke(['show', '--run', uiRun])
      expect(JSON.parse(afterLaunch.stdout).launch.stage).toBe('prompt-accepted')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 45_000)
})
