// Explicit, one-off migration trial; never erase or reset the original daily claim.
export function policyRetryAllowed({ privacy, retry, runs, currency, baseDate, fingerprint, model, originalClaim }) {
  if (!retry) return false
  return privacy === 'public-data' && runs.some(run =>
    run.status === 'failed' && run.reason === 'http_404' &&
    (run.privacy ?? 'strict') === 'strict' && run.fingerprint === fingerprint &&
    run.packet?.currency === currency && run.packet?.baseDate === baseDate &&
    (run.requestedModel ?? run.model ?? (
      originalClaim?.fingerprint === fingerprint && (originalClaim.privacy ?? 'strict') === 'strict'
        ? originalClaim.model : null
    )) === model)
}

export function diagnosticAllowed({ privacy, runs, currency, baseDate, fingerprint, model }) {
  return privacy === 'public-data' && runs.some(run =>
    run.status === 'failed' && run.reason === 'invalid_candidate' &&
    run.privacy === 'public-data' && run.fingerprint === fingerprint &&
    run.packet?.currency === currency && run.packet?.baseDate === baseDate &&
    run.requestedModel === model && !run.raw)
}

// CLI only: a user-requested retry names one failed run; its claim is never reset.
export function outageRetryAllowed({ prior, privacy, currency, baseDate, fingerprint, model }) {
  return prior?.status === 'failed' && prior.privacy === privacy &&
    prior.packet?.currency === currency && prior.packet?.baseDate === baseDate &&
    prior.fingerprint === fingerprint && prior.requestedModel === model && (
      ['timeout', 'transport_error', 'http_429', 'http_502', 'http_503', 'http_504'].includes(prior.reason) ||
      (prior.reason === 'provider_generation_error' && [429, 502, 503, 504].includes(prior.diagnostics?.errorCode))
    )
}

export function evaluationOptions({ mode, action, evaluationId, target = 'chain', conflictingFlags = false }) {
  if (action !== 'evaluate') {
    if (evaluationId || target !== 'chain') throw new Error('evaluation_id_requires_evaluate')
    return null
  }
  if (mode !== 'live-local' || conflictingFlags || !['chain', 'backup'].includes(target) || !/^[a-z][a-z0-9-]{0,59}$/.test(evaluationId ?? '')) throw new Error('invalid_local_evaluation')
  return { timeoutMs: 120_000, target, claimName: `evaluation-${evaluationId}-call.json` }
}
