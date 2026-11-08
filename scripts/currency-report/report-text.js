// Segmentation prepares review units; it does not infer independent claims or support.
// Keep exact prose in the report. Only review-unit boundary whitespace is trimmed.
const segmenter = new Intl.Segmenter('ko', { granularity: 'sentence' })
export function reviewSentenceSegments(text) {
  return [...segmenter.segment(text)].map(row => row.segment).filter(s => s.trim())
}
export function reviewSentences(text) {
  return reviewSentenceSegments(text).map(s => s.trim())
}
