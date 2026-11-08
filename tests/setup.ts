import { afterEach, beforeEach, expect, vi } from 'vitest'

let unexpectedFetch: ReturnType<typeof vi.fn>
beforeEach(() => {
  unexpectedFetch = vi.fn(() => { throw new Error('test_network_not_mocked') })
  vi.stubGlobal('fetch', unexpectedFetch)
})
afterEach(() => {
  // Catch swallowed network failures too. Inject fetchImpl or an explicit mock.
  expect(unexpectedFetch, 'Unit test attempted a non-mocked fetch').not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
