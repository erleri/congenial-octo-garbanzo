// Shared conservative byte reservation. Not a model tokenizer or a price quote.
// Keep this independent of dated trial runners, provider routes and credentials.
export function requestTokenBound(body) {
  return Buffer.byteLength(JSON.stringify({ messages: body.messages, response_format: body.response_format }), 'utf8') + 4096
}
