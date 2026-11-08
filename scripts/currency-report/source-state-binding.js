import {createHash} from 'node:crypto'
// JSONB changes object key order. Arrays remain ordered and values remain exact.
// Do not change the historical article/request hash formats elsewhere.
function sort(value){
 return Array.isArray(value)?value.map(sort):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])):value
}
export const sourceStateBinding=value=>createHash('sha256').update(JSON.stringify(sort(value))).digest('hex')
