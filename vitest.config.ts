import { defineConfig } from 'vitest/config'

// Unit tests must not load the app's development-server plugins or local env.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
  },
})
