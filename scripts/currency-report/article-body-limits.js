// One complete-capture boundary shared by acquisition and review preparation.
// These are resource limits, not evidence quality or publication approval.
export const ARTICLE_BODY_MAX_BLOCKS = 4096
export const ARTICLE_BODY_MAX_BYTES = 200_000
export function withinArticleBodyLimits(blocks) {
  return Array.isArray(blocks) && blocks.length > 0 && blocks.length <= ARTICLE_BODY_MAX_BLOCKS
    && blocks.every(b => typeof b?.text === 'string' && b.text.trim())
    && Buffer.byteLength(JSON.stringify(blocks)) <= ARTICLE_BODY_MAX_BYTES
}
