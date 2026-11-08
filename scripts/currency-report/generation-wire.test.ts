import Ajv from 'ajv'
import {expect,it,vi} from 'vitest'
import {generationWire,decodeGenerationOutput,assertGenerationWireRequest,GENERATION_WIRE_VERSION} from './generation-wire.js'
import {draftSchemaForPacket,composeDraft} from './openrouter.js'
import {compileEventTrialOutput} from './lifecycle-control.js'
import {currentCase,wireDraft} from './test-support.js'

const model='anthropic/claude-sonnet-5.5'
function fixture(){
  const a=currentCase('CLP'),draft=wireDraft(a),transport=generationWire(draftSchemaForPacket(a.packet,true),model)
  const wire=structuredClone(draft)
  for(const [field,{max}] of Object.entries(transport.contract.sections) as [string,{min:number,max:number}][]){
    const list=(draft as Record<string,unknown[]>)[field]
    if(list.length>max)throw Error('test_fixture_exceeds_slots')
    ;(wire as Record<string,unknown>)[field]=Object.fromEntries(Array.from({length:max},(_,i)=>[`slot_${i}`,list[i]??null]))
  }
  return {...a,draft,wire,transport,validate:new Ajv({allErrors:true}).compile(transport.schema)}
}

it('enforces section counts with closed slots and enumerated targets using only Claude-supported constraints',()=>{
  const a=fixture(),original=structuredClone(a.draft)
  expect(a.validate(a.wire)).toBe(true)
  const fourth=structuredClone(a.wire);fourth.drivers.slot_3=structuredClone(a.wire.drivers.slot_0)
  expect(a.validate(fourth)).toBe(false)
  expect(a.validate.errors).toContainEqual(expect.objectContaining({keyword:'additionalProperties',dataPath:'.drivers'}))
  expect(()=>decodeGenerationOutput(fourth,a.transport.contract)).toThrow('generation_slot_shape')
  const extraWatch=structuredClone(a.wire);extraWatch.watch.slot_2=null
  expect(a.validate(extraWatch)).toBe(false)
  const falseImplication=structuredClone(a.wire);falseImplication.implications.slot_0=a.wire.drivers.slot_0
  expect(a.validate(falseImplication)).toBe(false)
  const invalidTarget=structuredClone(a.wire);invalidTarget.ruleLedger.claims[0].target='drivers.3.text'
  expect(a.validate(invalidTarget)).toBe(false)
  expect(a.transport.contract).toMatchObject({version:GENERATION_WIRE_VERSION,sections:{drivers:{min:1,max:3},watch:{min:0,max:2},implications:{min:0,max:0}}})
  expect(a.transport.localOnlyConstraints).toContainEqual(expect.objectContaining({keyword:'maxLength'}))
  expect(a.draft).toEqual(original)
})

it('decodes valid slots losslessly through the common compiler and leaves missing ledger or wrong references rejected',()=>{
  const a=fixture(),before=structuredClone(a.wire),network=vi.fn(()=>{throw Error('offline_only')})
  vi.stubGlobal('fetch',network)
  try{
    const normalized=decodeGenerationOutput(a.wire,a.transport.contract)
    expect(normalized).toEqual(a.draft)
    const argon=generationWire(draftSchemaForPacket(a.packet,true),'google/gemini-4-argon')
    expect(argon.schema).toEqual(a.transport.schema)
    expect(decodeGenerationOutput(a.wire,argon.contract)).toEqual(a.draft)
    const compiled=compileEventTrialOutput({plan:{purpose:'fx_explanation',outputContract:a.transport.contract},packet:a.packet,draft:a.wire})
    expect(compiled.validation.valid).toBe(true)
    expect(compiled.rules.automaticStatus).toBe('pass')
    expect(compiled.candidate).toEqual(composeDraft(a.packet,a.draft,true).candidate)
    expect(compiled.rules.semanticStatus).toBe('unverified')
    const missing=structuredClone(a.wire);missing.ruleLedger.claims=missing.ruleLedger.claims.filter(c=>c.target!=='drivers.0.title')
    const held=compileEventTrialOutput({plan:{purpose:'fx_explanation',outputContract:a.transport.contract},packet:a.packet,draft:missing})
    expect(held.rules.checks).toContainEqual(expect.objectContaining({ruleId:'R10',status:'hold',location:'drivers.0.title'}))
    const badRef=structuredClone(a.wire);badRef.drivers.slot_0.evidenceIds=['not-a-source']
    expect(compileEventTrialOutput({plan:{purpose:'fx_explanation',outputContract:a.transport.contract},packet:a.packet,draft:badRef}).validation.valid).toBe(false)
    expect(a.wire).toEqual(before);expect(network).not.toHaveBeenCalled()
  }finally{vi.unstubAllGlobals()}
})

it('rejects gaps, omitted fields, legacy arrays and extra slots without silently trimming or repairing an answer',()=>{
  const a=fixture()
  const gap=structuredClone(a.wire);gap.drivers.slot_1=null;gap.drivers.slot_2=a.wire.drivers.slot_0
  expect(()=>decodeGenerationOutput(gap,a.transport.contract)).toThrow('generation_slot_gap')
  const missing=structuredClone(a.wire);delete missing.watch.slot_1
  expect(()=>decodeGenerationOutput(missing,a.transport.contract)).toThrow('generation_slot_shape')
  const empty=structuredClone(a.wire);empty.drivers.slot_0=null
  expect(()=>decodeGenerationOutput(empty,a.transport.contract)).toThrow('generation_slot_count')
  expect(()=>decodeGenerationOutput(a.draft,a.transport.contract)).toThrow('generation_slot_shape')
  expect(()=>generationWire(draftSchemaForPacket(a.packet,true),'unknown/model')).toThrow('unsupported_generation_wire_model')
  const body={model,messages:[{role:'user',content:JSON.stringify({outputLayout:a.transport.contract})}],response_format:{json_schema:{schema:a.transport.schema}}}
  expect(()=>assertGenerationWireRequest(body,a.transport.contract)).not.toThrow()
  const old=structuredClone(body);old.response_format.json_schema.schema.properties.drivers=draftSchemaForPacket(a.packet,true).properties.drivers
  expect(()=>assertGenerationWireRequest(old,a.transport.contract)).toThrow('generation_wire_request_required')
  expect(()=>assertGenerationWireRequest(body,undefined)).toThrow('generation_wire_request_required')
})
