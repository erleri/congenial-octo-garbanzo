import { describe, expect, it, vi } from 'vitest'
import { paidBody, callPaid, assertProviderSchema } from './paid-comparison.js'
import { comparisonPacket as packet } from './test-support.js'
const model = 'openai/gpt-5.4'

describe('provider JSON Schema preflight', () => {
  it('rejects the observed Azure untyped version-field failure before any network request', async () => {
    const body = paidBody(packet(), model)
    const schema = body.response_format.json_schema.schema
    expect(() => assertProviderSchema(schema)).not.toThrow()
    schema.properties.ruleLedger.properties.version = { const: 'writer-links/1' }
    const fetchImpl = vi.fn()
    await expect(callPaid({ body, packet: packet(), apiKey: 'test-key', fetchImpl })).rejects.toThrow('provider_schema_type_required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('blocks a preserved obsolete request before spending any money', async () => {
    const body = paidBody(packet(), model)
    body.response_format.json_schema.schema.required = ['title']
    const fetchImpl = vi.fn()
    await expect(callPaid({ body, packet: packet(), apiKey: 'test-key', fetchImpl })).rejects.toThrow('obsolete_paid_request_contract')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects an enum without its type', () => {
    const schema = paidBody(packet(), model).response_format.json_schema.schema
    delete schema.properties.drivers.items.properties.kind.type
    expect(() => assertProviderSchema(schema)).toThrow('provider_schema_type_required')
  })
  it('rejects an object whose properties are not all required', () => {
    const schema = paidBody(packet(), model).response_format.json_schema.schema
    schema.required.pop()
    expect(() => assertProviderSchema(schema)).toThrow('provider_schema_required_properties')
  })
})
