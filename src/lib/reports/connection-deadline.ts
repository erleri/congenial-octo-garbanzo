// A transport that ignores AbortSignal must still not keep private UI data alive.
export async function withConnectionDeadline<T>(operation: (signal: AbortSignal) => PromiseLike<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error('connection_deadline')); controller.abort() }, milliseconds)
  })
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]) }
  finally { clearTimeout(timer) }
}
