import { describe, expect, it } from 'vitest'
import { BUDGET_USD, paidBody, inputUpperBound, reservationFor, reserve } from './paid-comparison.js'
import { comparisonPacket as packet } from './test-support.js'
const model = 'openai/gpt-5.4'
const body = () => paidBody(packet(), model)

describe('paid call reservation and spend limits', () => {
  it('bounds two attempts for each authorized model within the original budget', () => {
    expect(inputUpperBound(body())).toBeLessThan(32000)
    expect(reservationFor(body()) * 2 + reservationFor(paidBody(packet(), 'openai/gpt-5.4-mini')) * 2).toBeLessThan(BUDGET_USD)
  })
  it('rejects duplicate model/attempt reservation', () => {
    const b = body(), first = reserve([], model, 1, b)
    expect(() => reserve([first], model, 1, b)).toThrow('duplicate_call')
  })
  it('permits one transient retry but forbids a third attempt', () => {
    const b = body(), first = reserve([], model, 1, b)
    expect(() => reserve([first], model, 2, b)).toThrow('retry_not_allowed')
    expect(reserve([{ ...first, retryable: true }], model, 2, b).attempt).toBe(2)
    expect(() => reserve([], model, 3, b)).toThrow('attempt_not_allowed')
  })
  it('requires explicit route approval as well as a matching ZDR 404', () => {
    const b = body(), first = reserve([], model, 1, b)
    expect(() => reserve([first], model, 2, b, true)).toThrow('retry_not_allowed')
    expect(() => reserve([{ ...first, reason: 'zdr_routing_404' }], model, 2, b)).toThrow('retry_not_allowed')
    expect(reserve([{ ...first, reason: 'zdr_routing_404' }], model, 2, b, true).attempt).toBe(2)
  })
  it('retains unknown charges and refuses to spend beyond remaining budget', () => {
    const b = body(), first = reserve([], model, 1, b)
    expect(() => reserve([{ ...first, model: 'other', reservedUsd: .99 }], model, 1, b)).toThrow('total_budget_exceeded')
    expect(reserve([{ ...first, model: 'other', costUsd: 0, reservedUsd: .99 }], model, 1, b).attempt).toBe(1)
  })
  it('rejects an oversized input before reservation or request', () => {
    expect(() => inputUpperBound({ ...body(), messages: [{ content: 'x'.repeat(40000) }] })).toThrow('input_budget_exceeded')
  })
})
