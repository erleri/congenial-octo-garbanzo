import {expect,it} from 'vitest'
import {readerText,readerTime} from './reader-display'
it('formats explicit instants across date boundaries without guessing unzoned dates',()=>{
 expect(readerTime('2026-11-02T23:10:13.920Z')).toBe('2026-11-03 08:10 KST')
 expect(readerTime('2026-11-02T18:10:00-03:00')).toBe('2026-11-03 06:10 KST')
 for(const value of ['2026-11-02','2026-11-02T15:10:00','bad-time','2026-02-30T12:00:00Z'])expect(readerTime(value)).toBe(value)
 expect(readerTime(null)).toBe('시각 미기록')
 expect(readerTime(undefined,'미제공')).toBe('미제공')
})
it('only translates known unit tokens while preserving claims and numeric precision',()=>{
 const text='기준환율은 5.437 BRL_per_USD, 18.00 MXN_per_USD. XYZ_per_USD와 BRL_per_KRW는 미확인.'
 expect(readerText(text)).toBe('기준환율은 5.437 BRL / 1 USD, 18.00 MXN / 1 USD. XYZ_per_USD와 BRL_per_KRW는 미확인.')
 expect(text).toContain('BRL_per_USD')
})
