export type ReviewKind='report'|'correction'|'source'|'policy'|'incident'
export interface ReviewTarget {kind:ReviewKind;id:string;version:string}
export interface ReviewItem extends ReviewTarget {currency:string|null;baseDate:string|null;title:string;summary:string;reason:string;createdAt:string}
export function validReviewTarget(value:unknown):value is ReviewTarget
export function reviewRequestPath(target:ReviewTarget):string
export function parseReviewRequest(search:string):ReviewTarget|null
export function reviewLoginReturn(origin:string,href:string):string
