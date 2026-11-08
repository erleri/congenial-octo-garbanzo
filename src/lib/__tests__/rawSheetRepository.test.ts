import {expect,it,vi} from 'vitest'
import {buildRawSheetAssets} from '../../../scripts/raw-sheet-assets.js'
import {loadRawSheetCatalog,loadRawSheetPreview,loadRawSheetExport} from '../rawSheetRepository'
const data={rawSheets:[{name:'Summary',headers:['value'],rows:Array.from({length:120},(_,i)=>({value:i}))},{name:'PEN',headers:['value'],rows:[{value:3.5}]}]}
it('loads only selected preview rows until an explicit complete export and preserves the original source',async()=>{
 const before=structuredClone(data),assets=buildRawSheetAssets(data)
 const fetcher=vi.fn(async(url:string)=>Response.json(url==='/raw-sheets-index.json'?assets.catalog:url==='/raw-sheets.json'?data:JSON.parse(assets.previews.find(p=>p.url===url)!.body)))
 vi.stubGlobal('fetch',fetcher)
 const result=await loadRawSheetCatalog(),preview=await loadRawSheetPreview(result.catalog!,'Summary')
 expect(preview.rows).toEqual(data.rawSheets[0].rows.slice(0,50))
 expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/raw-sheets-index.json',assets.previews[0].url])
 const full=await loadRawSheetExport(result.catalog!,'Summary')
 expect(full.rows).toEqual(data.rawSheets[0].rows)
 expect(JSON.parse(assets.compact)).toEqual(data)
 expect(data).toEqual(before)
})
it('uses the full legacy contract only when the older deployment has no catalog, not for server failures',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:404})).mockResolvedValueOnce(Response.json(data)).mockResolvedValueOnce(new Response('',{status:503}))
 vi.stubGlobal('fetch',fetcher)
 expect((await loadRawSheetCatalog()).legacy).toEqual(data)
 await expect(loadRawSheetCatalog()).rejects.toThrow('원본 목록')
 expect(fetcher.mock.calls.filter(c=>c[0]==='/raw-sheets.json')).toHaveLength(1)
})
it('rejects a changed export version and cross-origin preview URLs',async()=>{
 const assets=buildRawSheetAssets(data)
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({rawSheets:[]})))
 await expect(loadRawSheetExport(assets.catalog,'Summary')).rejects.toThrow('갱신')
 const invalid=structuredClone(assets.catalog);invalid.sheets[0].previewUrl='https://outside.example/raw.json'
 await expect(loadRawSheetPreview(invalid,'Summary')).rejects.toThrow('invalid_raw_catalog')
})
