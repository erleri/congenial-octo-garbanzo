import { describe, expect, it } from 'vitest'
import {
  buildBusinessPlanInsertRows,
  groupBusinessPlanHistoryRows,
  verifyBusinessPlanSave,
  isSchemaCompatibilityError,
} from '../businessPlanRemote'

describe('remote business plan mapping', () => {
  it('does not fall back for permission or connection errors mentioning a table', () => {
    expect(isSchemaCompatibilityError({ code: '42501', message: 'business_plan_current permission denied' })).toBe(false)
    expect(isSchemaCompatibilityError({ message: 'change_set_id network failure' })).toBe(false)
    expect(isSchemaCompatibilityError({ code: 'PGRST204' })).toBe(true)
  })
  it('uses one change-set id for the complete 22-row save', () => {
    const rows = buildBusinessPlanInsertRows(
      '2026-09-01',
      { leading: { BRL: 5.2 }, moving: { BRL: 5.1 } },
      'ADMIN@EXAMPLE.COM',
      'change-set-1',
    )

    expect(rows).toHaveLength(22)
    expect(new Set(rows.map((row) => row.change_set_id))).toEqual(new Set(['change-set-1']))
    expect(new Set(rows.map((row) => row.created_by_email))).toEqual(new Set(['admin@example.com']))
  })

  it('groups rows into auditable change sets and excludes unchanged values', () => {
    const entries = groupBusinessPlanHistoryRows([
      {
        change_group: 'set-1',
        legacy: false,
        period_month: '2026-09-01',
        created_at: '2026-09-01T01:00:00Z',
        created_by_email: 'admin@example.com',
        plan_type: 'leading',
        currency: 'BRL',
        previous_rate_value: '5.1',
        rate_value: '5.2',
      },
      {
        change_group: 'set-1',
        legacy: false,
        period_month: '2026-09-01',
        created_at: '2026-09-01T01:00:00Z',
        created_by_email: 'admin@example.com',
        plan_type: 'moving',
        currency: 'BRL',
        previous_rate_value: '5.0',
        rate_value: '5.0',
      },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].changes).toEqual([
      {
        currency: 'BRL',
        planType: 'leading',
        previousValue: 5.1,
        nextValue: 5.2,
      },
    ])
  })

  it('marks a save verified only after operational data can be re-read', async () => {
    const plan = { leading: { BRL: 5.2 }, moving: { BRL: 5.1 } }
    const verified = await verifyBusinessPlanSave(plan, 'admin@example.com', async () => ({
      plan,
      lastUpdatedAt: '2026-09-01T01:00:00Z',
      lastUpdatedBy: null,
      lastVerifiedAt: '2026-09-01T01:00:01Z',
      verificationStatus: 'verified',
      verificationMessage: null,
    }))
    const unverified = await verifyBusinessPlanSave(plan, 'admin@example.com', async () => {
      throw new Error('re-read failed')
    })

    expect(verified.verificationStatus).toBe('verified')
    expect(unverified).toMatchObject({
      verificationStatus: 'unverified',
      lastUpdatedBy: 'admin@example.com',
      verificationMessage: 're-read failed',
    })
  })
})
