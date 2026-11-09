// Test-only persistence adapter; no credentials or network.
export function memoryOperatingStorage(){
 const objects=new Map(),incidents=[]
 return {objects,incidents,
  storageInspect:async ids=>({version:'operating-storage/2',objects:ids.filter(id=>objects.has(id)).map(id=>({id,sealed:objects.get(id).sealed}))}),
  storagePrepare:async meta=>{
   let o=objects.get(meta.id)
   if(o&&JSON.stringify(o.meta)!==JSON.stringify(meta))throw Error('immutable_object_conflict')
   if(!o){o={meta:structuredClone(meta),chunks:[],sealed:false};objects.set(meta.id,o)}
   return {sealed:o.sealed}
  },
  storageChunk:async(id,index,data)=>{
   const o=objects.get(id)
   if(o.chunks[index]&&o.chunks[index]!==data)throw Error('immutable_chunk_conflict')
   o.chunks[index]=data
  },
  storageSeal:async id=>{const o=objects.get(id);if(o.chunks.filter(Boolean).length!==o.meta.chunkCount)throw Error('chunks_missing');o.sealed=true},
  storageReadChunk:async(id,index)=>{const o=objects.get(id);if(!o?.sealed||!o.chunks[index])throw Error('chunk_unavailable');return o.chunks[index]},
  storageIncident:async r=>{incidents.push(r)}
 }
}
