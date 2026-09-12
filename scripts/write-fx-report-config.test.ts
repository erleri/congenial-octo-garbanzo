import { describe, expect, it } from 'vitest'
import { renderReportConfig, reportFeatureEnabled } from './write-fx-report-config.js'

describe('FX report feature config', () => {
  it('defaults to enabled and accepts explicit true or false values', () => {
    expect(reportFeatureEnabled(undefined)).toBe(true)
    expect(reportFeatureEnabled(' TRUE ')).toBe(true)
    expect(reportFeatureEnabled('false')).toBe(false)
  })

  it('rejects ambiguous values and renders a deterministic module', () => {
    expect(() => reportFeatureEnabled('yes')).toThrow('true or false')
    expect(renderReportConfig(false)).toContain('enabled: false')
  })
})
