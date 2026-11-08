// Claude has no maxItems support. Sol/Argon comparisons reuse identical closed slots.
// This is format support only; it does not authorize a route or a paid call.
// Bound report sections with closed objects,
// decode them losslessly, then run the unchanged FULL local report validators.
// Raw provider responses are never edited. No repair, truncation or retry here.
export const GENERATION_WIRE_VERSION = 'generation-wire/1'
const fields = ['drivers', 'implications', 'watch']
const supportedModel = model => model?.startsWith('anthropic/') || ['openai/gpt-6.1-sol', 'google/gemini-4-argon'].includes(model)
export const GENERATION_WIRE_INSTRUCTIONS = '전송 형식: drivers·implications·watch는 스키마의 고정 slot 객체다. 왼쪽부터 채우고 나머지는 null, 칸이 없으면 {}다. 코드가 배열로 변환한다. 출처 연결의 target은 변환 후 배열 위치 drivers.0.title 같은 점 표기다. 연결 항목은 제공된 스키마대로 제출한다.'

export function generationWire(schema, model) {
  if (!supportedModel(model)) throw new Error('unsupported_generation_wire_model')
  const original = structuredClone(schema), sections = {}, wire = structuredClone(schema)
  wire.$defs = { ...wire.$defs }
  for (const field of fields) {
    const source = original.properties?.[field]
    if (!source) continue
    const min = source.minItems ?? 0, max = source.maxItems
    if (source.type !== 'array' || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 3 || min > max)
      throw new Error('unbounded_report_section')
    sections[field] = { min, max }
    const properties = {}, ref = `#/$defs/latam_${field}`
    if (max) wire.$defs[`latam_${field}`] = source.items
    for (let i = 0; i < max; i++) properties[`slot_${i}`] = i < min ? { $ref: ref } : { anyOf: [{ $ref: ref }, { type: 'null' }] }
    wire.properties[field] = { type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
      description: `${min}~${max}개, 빈 선택 칸은 null. 배열 위치는 slot 순서.` }
  }
  // Enumerated targets avoid relying on unsupported pattern constraints.
  const target = wire.properties?.ruleLedger?.properties?.claims?.items?.properties?.target
  if (target) {
    target.enum = ['title', 'summary', ...Object.entries(sections).flatMap(([field, { max }]) =>
      Array.from({ length: max }, (_, i) => [`${field}.${i}.title`, `${field}.${i}.text`]).flat())]
    delete target.pattern
  }
  const localOnlyConstraints = []
  function project(node, location = '$') {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((v, i) => project(v, `${location}.${i}`))
    const next = {}
    for (const [key, value] of Object.entries(node)) {
      if (['minLength', 'maxLength', 'pattern', 'uniqueItems', 'maximum', 'minimum'].includes(key) ||
        key === 'maxItems' || key === 'minItems' && value !== 0 && value !== 1) {
        localOnlyConstraints.push({ path: location, keyword: key, value })
      } else next[key] = ['properties', '$defs'].includes(key)
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, project(v, `${location}.${key}.${k}`)]))
        : ['items', 'anyOf', 'allOf'].includes(key) ? project(value, `${location}.${key}`) : value
    }
    // These constraints remain in the full local validator and in the plan's
    // explicit audit list. Do not repeat every length/pattern in the prompt.
    return next
  }
  return { schema: project(wire), contract: { version: GENERATION_WIRE_VERSION, model, sections,
    ...(original.properties?.ruleLedger?.properties?.version?.enum?.[0] === 'writer-links/1'
      ? { writingContractVersion: 'writer-links/1', writingContractField: 'ruleLedger' }
      : original.properties?.writingContractVersion?.enum?.[0] === 'writer-links/1'
        ? { writingContractVersion: 'writer-links/1', writingContractField: 'root' } : {}) }, localOnlyConstraints }
}

export function decodeGenerationOutput(draft, contract) {
  if (contract?.version !== GENERATION_WIRE_VERSION || !supportedModel(contract.model) ||
    !contract.sections || Object.keys(contract.sections).some(f => !fields.includes(f))) throw new Error('invalid_generation_wire_contract')
  const next = structuredClone(draft)
  if (contract.writingContractVersion && (contract.writingContractField === 'root' ? draft?.writingContractVersion : draft?.ruleLedger?.version) !== contract.writingContractVersion)
    throw new Error('writing_contract_required')
  for (const [field, { min, max }] of Object.entries(contract.sections)) {
    const object = draft?.[field]
    const keys = Array.from({ length: max }, (_, i) => `slot_${i}`)
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 3 || min > max ||
      !object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).length !== keys.length ||
      !keys.every(k => Object.hasOwn(object, k))) throw new Error('generation_slot_shape')
    let emptySeen = false
    const list = []
    for (const key of keys) {
      const value = object[key]
      if (value === null) { emptySeen = true; continue }
      if (emptySeen || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('generation_slot_gap')
      list.push(value)
    }
    if (list.length < min || list.length > max) throw new Error('generation_slot_count')
    next[field] = list
  }
  return next
}

export function assertGenerationWireRequest(body, contract) {
  let sent
  try { sent = JSON.parse(body.messages.find(m => m.role === 'user').content) } catch { throw new Error('generation_wire_request_required') }
  if (contract?.version !== GENERATION_WIRE_VERSION || contract.model !== body.model ||
    JSON.stringify(sent.outputLayout) !== JSON.stringify(contract) || !contract.sections?.drivers)
    throw new Error('generation_wire_request_required')
  for (const [field, { max }] of Object.entries(contract.sections)) {
    const node = body.response_format?.json_schema?.schema?.properties?.[field]
    const slots = Array.from({ length: max }, (_, i) => `slot_${i}`)
    if (node?.type !== 'object' || node.additionalProperties !== false ||
      JSON.stringify(Object.keys(node.properties ?? {})) !== JSON.stringify(slots) ||
      JSON.stringify(node.required) !== JSON.stringify(slots)) throw new Error('generation_wire_request_required')
  }
}
