import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createOrcaCall, OrcaCommandError, resolveOrcaExecutable } from '../src/orca-process'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture(source: string) {
  const root = await mkdtemp(join(tmpdir(), 'orca-manager-command-'))
  roots.push(root)
  const path = join(root, 'fake orca.cjs')
  await writeFile(path, source)
  return { path, root, call: createOrcaCall(path, root) }
}

describe('bounded Orca CLI adapter', () => {
  it('passes text as argv, preserving spaces, newlines, and shell metacharacters', async () => {
    const { call, path } = await fixture(
      'console.log(JSON.stringify({ok:true,result:{args:process.argv.slice(2),background:process.env.ORCA_BACKGROUND_LAUNCH}}))'
    )
    const prompt = 'line one\n$(do-not-run) `not-a-command` & "quoted"'
    expect(await call(['terminal', 'send', '--text', prompt])).toEqual({
      args: ['terminal', 'send', '--text', prompt, '--json'],
      background: '1'
    })
    expect(await resolveOrcaExecutable(path)).toBe(path)
  })

  it('preserves an Orca recovery receipt without retrying a failed mutation', async () => {
    const { call } = await fixture(
      'console.log(JSON.stringify({ok:false,error:{code:"timeout",requestId:"keep-me"}}));process.exitCode=1'
    )
    try {
      await call(['terminal', 'send'])
      throw new Error('Expected refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(OrcaCommandError)
      if (error instanceof OrcaCommandError) {
        expect(error.receipt).toMatchObject({ error: { requestId: 'keep-me' } })
      }
    }
  })

  it('fails closed on non-JSON and excessive output', async () => {
    const invalid = await fixture('console.log("not JSON")')
    await expect(invalid.call(['status'])).rejects.toThrow('JSON receipt')
    const excessive = await fixture('process.stdout.write("x".repeat(1100000))')
    await expect(excessive.call(['status'])).rejects.toThrow('unverifiable')
  })
})
