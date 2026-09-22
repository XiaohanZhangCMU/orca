import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inventoryBlock } from '../src/local-inventory'
import { legacyHost, savedHosts, savedPhone } from '../src/desktop-legacy-hosts'
import { encodePairingOffer } from '../../../src/shared/pairing'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../../../src/cli/runtime-client', () => ({
  RuntimeClient: class {
    call = mocks.call
  }
}))
let directory: string
const offer = {
  v: 2 as const,
  scope: 'runtime' as const,
  endpoint: 'ws://127.0.0.1:6770',
  publicKeyB64: 'test-key',
  deviceToken: 'fixture-token'
}
function save(phone = { ...offer, scope: 'mobile' as const, endpoint: 'ws://100.64.0.1:6770' }) {
  writeFileSync(
    join(directory, '.env'),
    inventoryBlock('legacy-host', {
      DEPLOYMENT: 'legacy-deployment',
      NAMESPACE: 'test-cluster',
      KUBECONFIG: '/fixture/config',
      STORAGE: 'legacy: no persistent PVC',
      LAPTOP_PAIRING_LINK: encodePairingOffer(offer),
      PHONE_PAIRING_LINK: encodePairingOffer(phone)
    })
  )
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-legacy-test-'))
  vi.stubEnv('ORCA_POD_INVENTORY_FILE', join(directory, '.env'))
  mocks.call.mockResolvedValue({ result: { runtimeId: 'legacy-runtime', graphStatus: 'ready' } })
  save()
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

it('discovers explicit local registrations and marks them legacy without release authority', async () => {
  expect(savedHosts(directory)).toEqual(['legacy-host'])
  expect(await legacyHost(directory, 'legacy-host')).toMatchObject({
    management: 'legacy',
    runtimeId: 'legacy-runtime',
    state: 'ready'
  })
  expect(await legacyHost(directory, 'legacy-host')).not.toHaveProperty('instance')
})
it('keeps a disconnected legacy registration visible and unverifiable', async () => {
  mocks.call.mockRejectedValueOnce(new Error('offline'))
  expect(await legacyHost(directory, 'legacy-host')).toMatchObject({
    state: 'unverifiable',
    management: 'legacy'
  })
})
it('reuses the existing mobile credential without minting or converting a desktop token', () => {
  const result = savedPhone(directory, 'legacy-host')
  expect(result).toMatchObject({ state: 'ready', endpoint: 'ws://100.64.0.1:6770' })
  expect(result?.link).toContain('orca://pair?code=')
})
it.each(['ws://127.0.0.1:6770', 'ws://example.test:6770', 'ws://100.64.0.1:22'])(
  'refuses an unusable or non-tailnet phone endpoint: %s',
  (endpoint) => {
    save({ ...offer, scope: 'mobile', endpoint })
    expect(() => savedPhone(directory, 'legacy-host')).toThrow('private mobile pairing identity')
  }
)
it('refuses a phone credential belonging to another host', () => {
  save({ ...offer, scope: 'mobile', endpoint: 'ws://100.64.0.1:6770', publicKeyB64: 'another-key' })
  expect(() => savedPhone(directory, 'legacy-host')).toThrow('private mobile pairing identity')
})
