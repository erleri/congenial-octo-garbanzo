import { BACKUP_MODEL, DEFAULT_MODEL, EMERGENCY_MODEL, generateCandidate, requestBody } from './openrouter.js'

export function canUseBackup(run) {
  return run?.status === 'failed' && (
    ['timeout', 'transport_error', 'http_429', 'http_502', 'http_503', 'http_504'].includes(run.reason) ||
    (run.reason === 'provider_generation_error' && [429, 502, 503, 504].includes(run.diagnostics?.errorCode))
  )
}

// Local opt-in only. Fixed models first, then the random free router as an emergency.
// A prior primary failure may be reused ONLY after CLI checks provenance and claims a slot.
export async function generateWithBackup({ apiKey, packet, model = DEFAULT_MODEL, privacy = 'strict', primaryRun, fetchImpl, timeoutMs, claimBackup = async () => true, claimEmergency = async () => true, onAttempt = () => {} }) {
  if (model !== DEFAULT_MODEL) throw new Error('unsupported_primary_for_backup')
  requestBody(packet, model, privacy)
  requestBody(packet, BACKUP_MODEL, privacy)
  requestBody(packet, EMERGENCY_MODEL, privacy)
  const common = { apiKey, packet, privacy, fetchImpl, timeoutMs, maxAttempts: 1 }
  if (!primaryRun) onAttempt({ requestedModel: model, phase: 'started' })
  const primary = primaryRun ?? await generateCandidate({ ...common, model })
  if (!primaryRun) onAttempt({ requestedModel: model, phase: 'finished', status: primary.status, reason: primary.reason })
  const trials = [{ requestedModel: model, reused: Boolean(primaryRun), ...primary }]
  const primaryAttempts = primaryRun ? 0 : primary.attempts
  if (!canUseBackup(primary)) return { ...primary, requestedModel: model, attempts: primaryAttempts, trials }
  if (!await claimBackup()) return { ...primary, reason: 'backup_slot_already_claimed', requestedModel: model, attempts: primaryAttempts, trials }
  onAttempt({ requestedModel: BACKUP_MODEL, phase: 'started' })
  const backup = await generateCandidate({ ...common, model: BACKUP_MODEL })
  onAttempt({ requestedModel: BACKUP_MODEL, phase: 'finished', status: backup.status, reason: backup.reason })
  trials.push({ requestedModel: BACKUP_MODEL, reused: false, ...backup })
  const backupAttempts = primaryAttempts + backup.attempts
  // Content/format/validation failures stop here. The router is only an outage fallback.
  if (!canUseBackup(backup)) return { ...backup, requestedModel: BACKUP_MODEL, attempts: backupAttempts, trials }
  if (!await claimEmergency()) return { ...backup, reason: 'emergency_slot_already_claimed', requestedModel: BACKUP_MODEL, attempts: backupAttempts, trials }
  onAttempt({ requestedModel: EMERGENCY_MODEL, phase: 'started' })
  const emergency = await generateCandidate({ ...common, model: EMERGENCY_MODEL })
  onAttempt({ requestedModel: EMERGENCY_MODEL, phase: 'finished', status: emergency.status, reason: emergency.reason })
  trials.push({ requestedModel: EMERGENCY_MODEL, reused: false, ...emergency })
  return { ...emergency, requestedModel: EMERGENCY_MODEL, attempts: backupAttempts + emergency.attempts, trials }
}
