import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { inventoryBlock, replaceInventoryBlock, writeLocalInventory } from '../src/local-inventory'

const directories: string[] = []
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'orca-inventory-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
describe('private pod inventory', () => {
  it('preserves preexisting settings and other pod blocks', () => {
    const original = 'BL_API_KEY=existing\n# user comment\n'
    const first = replaceInventoryBlock(original, 'first-pod', { POD: 'one' })
    const second = replaceInventoryBlock(first, 'second-pod', { POD: 'two' })
    const updated = replaceInventoryBlock(second, 'first-pod', { POD: 'replacement' })
    expect(updated.startsWith(original)).toBe(true)
    expect(parseEnv(updated)).toMatchObject({
      BL_API_KEY: 'existing',
      ORCA_POD_FIRST_POD_POD: 'replacement',
      ORCA_POD_SECOND_POD_POD: 'two'
    })
    expect(replaceInventoryBlock(updated, 'first-pod', { POD: 'replacement' })).toBe(updated)
  })
  it('round trips private links and quoted commands', () => {
    const value = 'kubectl --kubeconfig "/Users/test/.kube/config"'
    expect(parseEnv(inventoryBlock('test-pod', { EXEC: value })).ORCA_POD_TEST_POD_EXEC).toBe(value)
    expect(
      parseEnv(inventoryBlock('test-pod', { LINK: 'orca://pair?code=abc_123-xyz' }))
        .ORCA_POD_TEST_POD_LINK
    ).toBe('orca://pair?code=abc_123-xyz')
  })
  it('rejects ambiguous markers and line injection', () => {
    expect(() => replaceInventoryBlock('# BEGIN ORCA POD: test-pod\n', 'test-pod', {})).toThrow()
    expect(() => inventoryBlock('test-pod', { LINK: 'secret\nOTHER=value' })).toThrow()
    expect(() => inventoryBlock('test-pod', { 'BAD=KEY': 'x' })).toThrow()
    expect(() =>
      replaceInventoryBlock(
        `${inventoryBlock('test-pod-other', {})}\n# END ORCA POD: test-pod\n# BEGIN ORCA POD: test-pod\n`,
        'test-pod',
        {}
      )
    ).toThrow()
  })
  it('does not replace a similarly prefixed pod block', () => {
    const other = `${inventoryBlock('test-pod-other', { POD: 'preserve' })}\n`
    const original = replaceInventoryBlock(other, 'test-pod', { POD: 'before' })
    const updated = replaceInventoryBlock(original, 'test-pod', { POD: 'after' })
    expect(updated.startsWith(other)).toBe(true)
    expect(parseEnv(updated).ORCA_POD_TEST_POD_POD).toBe('after')
  })
  it.skipIf(process.platform === 'win32')('refuses a dangling symlink', () => {
    const root = directory()
    const path = join(root, '.env')
    symlinkSync(join(root, 'missing'), path)
    expect(() => writeLocalInventory(path, 'test-pod', {})).toThrow()
  })
  it('writes private files without replacing unrelated contents', () => {
    const path = join(directory(), '.env')
    writeFileSync(path, 'EXISTING=value\n')
    writeLocalInventory(path, 'test-pod', { LINK: 'private-fixture' })
    expect(readFileSync(path, 'utf8').startsWith('EXISTING=value\n')).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })
  it.skipIf(process.platform === 'win32')(
    'refuses symlink .env without modifying its target',
    () => {
      const root = directory()
      const target = join(root, 'original')
      writeFileSync(target, 'preserve')
      const path = join(root, '.env')
      symlinkSync(target, path)
      expect(() => writeLocalInventory(path, 'test-pod', {})).toThrow()
      expect(readFileSync(target, 'utf8')).toBe('preserve')
    }
  )
})
