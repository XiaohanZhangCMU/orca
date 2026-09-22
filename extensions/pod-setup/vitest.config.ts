import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['extensions/pod-setup/test/**/*.test.ts'], environment: 'node' }
})
