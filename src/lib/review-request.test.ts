import {expect,it} from 'vitest'
import {parseReviewRequest,reviewRequestPath,reviewLoginReturn} from './review-request.js'
it('roundtrips all review kinds and preserves the same exact target through sign-in',()=>{
 for(const kind of ['report','correction','source','policy','incident'] as const){
  const target={kind,id:'a'.repeat(64),version:'b'.repeat(64)},path=reviewRequestPath(target)
  expect(parseReviewRequest(new URL(path,'https://latamforex.netlify.app').search)).toEqual(target)
  expect(reviewLoginReturn('https://latamforex.netlify.app','https://latamforex.netlify.app'+path)).toBe('https://latamforex.netlify.app'+path)
 }
})
it('rejects ambiguous, invalid and cross-origin review instructions',()=>{
 for(const search of ['?review=report:../../x','?review=approve:global&reviewVersion='+'a'.repeat(64),'?review=report:global&review=source:global&reviewVersion='+'a'.repeat(64)])expect(parseReviewRequest(search)).toBeNull()
 expect(reviewLoginReturn('https://latamforex.netlify.app','https://evil.example/?review=report:global&reviewVersion='+'a'.repeat(64))).toBe('https://latamforex.netlify.app')
 expect(reviewLoginReturn('https://latamforex.netlify.app','https://latamforex.netlify.app/#dashboard')).toBe('https://latamforex.netlify.app')
})
