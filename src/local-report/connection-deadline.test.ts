import { afterEach, expect, it, vi } from 'vitest'
import { withConnectionDeadline } from './connection-deadline'

afterEach(() => vi.useRealTimers())
it('rejects a hanging transport and cannot resolve again when its late draft arrives', async () => {
  vi.useFakeTimers()
  let resolve!: (data: string) => void
  let signal!: AbortSignal
  const applied = vi.fn()
  const request = withConnectionDeadline(s => { signal = s; return new Promise<string>(r => { resolve = r }) }, 1500).then(applied)
  const rejected = expect(request).rejects.toThrow('connection_deadline')
  await vi.advanceTimersByTimeAsync(1500)
  await rejected
  expect(signal.aborted).toBe(true)
  resolve('late private draft')
  await Promise.resolve()
  expect(applied).not.toHaveBeenCalled()
})
it('returns timely data and clears the deadline on success and transport failure', async () => {
  vi.useFakeTimers()
  expect(await withConnectionDeadline(async () => 'approved', 1500)).toBe('approved')
  await expect(withConnectionDeadline(async () => { throw new Error('offline') }, 1500)).rejects.toThrow('offline')
  expect(vi.getTimerCount()).toBe(0)
})
