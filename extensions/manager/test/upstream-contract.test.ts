import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { CORE_COMMAND_SPECS } from '../../../src/cli/specs/core'
import { ORCHESTRATION_COMMAND_SPECS } from '../../../src/cli/specs/orchestration'
import {
  ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY,
  TERMINAL_PROMPT_DELIVERY_RUNTIME_CAPABILITY
} from '../../../src/shared/protocol-version'

describe('upstream compatibility boundary', () => {
  it.each([
    ['status', []],
    ['worktree show', ['worktree']],
    ['repo show', ['repo']],
    ['terminal create', ['worktree', 'title', 'command']],
    ['terminal wait', ['terminal', 'for', 'timeout-ms']],
    ['terminal send', ['terminal', 'text', 'enter', 'wait-submit']],
    ['orchestration run-create', ['objective']],
    ['orchestration worker-start', ['spec', 'task', 'worktree', 'agent', 'model']],
    ['orchestration check', ['wait', 'types', 'timeout-ms', 'ack']],
    ['orchestration worker-release', ['dispatch']]
  ])('the upstream CLI still supports %s and the flags used here', (command, flags) => {
    const spec = [...CORE_COMMAND_SPECS, ...ORCHESTRATION_COMMAND_SPECS].find(
      (entry) => entry.path.join(' ') === command
    )
    expect(
      spec,
      `Upstream removed ${command}; update only the manager adapter/prompt.`
    ).toBeDefined()
    expect(spec?.allowedFlags).toEqual(expect.arrayContaining(['json', ...flags]))
  })

  it('negotiates the capabilities actually advertised by this upstream build', () => {
    expect(ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY).toBe('orchestration.contract.v1')
    expect(TERMINAL_PROMPT_DELIVERY_RUNTIME_CAPABILITY).toBe('terminal.prompt-delivery.v1')
  })

  it('keeps upstream imports confined to the process adapter and team contract', async () => {
    const source = new URL('../src/', import.meta.url)
    for (const name of await readdir(source)) {
      const text = await readFile(new URL(name, source), 'utf8')
      const imports = text.match(/from ['"]\.\.\/\.\.\/\.\.\/src\/[^'"]+['"]/g) ?? []
      const expected =
        name === 'orca-process.ts'
          ? ["from '../../../src/shared/child-process/run-process'"]
          : ['contracts.ts', 'cli.ts'].includes(name)
            ? ["from '../../../src/shared/manager-team-contract'"]
            : []
      expect(imports).toEqual(expected)
      expect(text).not.toMatch(
        /from ['"](?:node:)?child_process['"]|orchestration\.db|window\.api|useAppStore/
      )
    }
  })
})
