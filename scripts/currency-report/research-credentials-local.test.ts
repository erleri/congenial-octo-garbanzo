import {describe,it,expect,vi} from 'vitest'
import {parseResearchTokenFile,researchCredentialStatus} from './research-credentials-local.js'

describe('Local economic API credential setup',()=>{
  it('reports presence without values, URLs, fingerprints or outbound validation',()=>{
    const banxico='B'.repeat(64),inegi='01234567-89ab-cdef-0123-456789abcdef'
    const network=vi.fn(()=>{throw new Error('network forbidden')})
    vi.stubGlobal('fetch',network)
    try {
      const settings=parseResearchTokenFile(`BANXICO_SIE_TOKEN=${banxico}\nINEGI_INDICATORS_TOKEN=${inegi}\n`)
      const status=researchCredentialStatus(settings),printed=JSON.stringify(status)
      expect(status).toMatchObject({banxico:{state:'configured',authentication:'not_tested'},inegi:{state:'configured',authentication:'not_tested'},networkCalls:0})
      expect(printed).not.toContain(banxico);expect(printed).not.toContain(inegi)
      expect(network).not.toHaveBeenCalled()
    }finally{vi.unstubAllGlobals()}
  })
  it('distinguishes empty fields from malformed placeholders without treating either as authentication success',()=>{
    const empty=researchCredentialStatus(parseResearchTokenFile('BANXICO_SIE_TOKEN=\nINEGI_INDICATORS_TOKEN=\n'))
    expect(empty.banxico.state).toBe('missing');expect(empty.inegi.state).toBe('missing')
    const malformed=researchCredentialStatus(parseResearchTokenFile('BANXICO_SIE_TOKEN=붙여넣기\nINEGI_INDICATORS_TOKEN=not a token\n'))
    expect(malformed.banxico).toEqual({state:'format_check_required',authentication:'not_tested'})
    expect(malformed.inegi.state).toBe('format_check_required')
  })
  it('rejects browser-prefixed fields, mixed AI settings and duplicate assignments with static errors',()=>{
    expect(()=>parseResearchTokenFile('VITE_BANXICO_SIE_TOKEN=private-value')).toThrow('unexpected_research_setting')
    expect(()=>parseResearchTokenFile('OPENROUTER_API_KEY=private-value')).toThrow('unexpected_research_setting')
    expect(()=>parseResearchTokenFile('BANXICO_SIE_TOKEN=one\nBANXICO_SIE_TOKEN=two')).toThrow('duplicate_research_setting')
    expect(()=>parseResearchTokenFile('x'.repeat(10_001))).toThrow('invalid_research_settings')
  })
})
