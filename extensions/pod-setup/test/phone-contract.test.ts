import { describe, expect, it } from 'vitest'
import { phoneConfigSchema, tailnetIp } from '../src/phone-contract'
import { basetenSetupSchema } from '../../../src/shared/baseten-hosts'

describe('private Baseten host setup', () => {
  it('only accepts exact private tailnet IPv4 addresses, never public or wildcard listeners', () => {
    for (const ip of ['100.64.0.1', '100.127.255.254']) {
      expect(tailnetIp.safeParse(ip).success).toBe(true)
    }
    for (const ip of [
      '0.0.0.0',
      '127.0.0.1',
      '8.8.8.8',
      '100.128.0.1',
      '100.064.0.1',
      '100.64.256.1',
      '100.64.0.0/10',
      '100.64.0.1;echo test'
    ]) {
      expect(tailnetIp.safeParse(ip).success).toBe(false)
    }
    expect(phoneConfigSchema.safeParse({ hostname: 'orca-test', allowedIps: [] }).success).toBe(
      false
    )
  })
  it('requires persistent storage of at least 250 GiB and a run request', () => {
    const input = {
      name: 'orca-test',
      namespace: 'test-cluster',
      source: '/orca',
      dreamteam: '/dreamteam',
      kubeconfig: '/kubeconfig',
      storageGi: 250,
      prompt: 'Test launch'
    }
    expect(basetenSetupSchema.safeParse(input).success).toBe(true)
    for (const patch of [
      { storageGi: 249 },
      { storageGi: 0 },
      { prompt: '' },
      { name: '../other' },
      { namespace: '-other' }
    ]) {
      expect(basetenSetupSchema.safeParse({ ...input, ...patch }).success).toBe(false)
    }
  })
})
