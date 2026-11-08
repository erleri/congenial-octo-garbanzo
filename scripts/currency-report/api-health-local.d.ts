import type {ApiHealthProvider,ApiHealthSnapshot} from '../../src/types/apiHealth'
export const API_SERVICES:ReadonlyArray<Pick<ApiHealthProvider,'id'|'name'|'kind'|'role'|'stage'>>
export const API_FAILURES:readonly string[]
export function projectApiHealth(runs?:unknown[],now?:string):ApiHealthSnapshot
export function readLocalApiHealth(workspace?:string):Promise<ApiHealthSnapshot>
