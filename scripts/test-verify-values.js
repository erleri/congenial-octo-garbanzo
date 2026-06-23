import assert from 'node:assert/strict'
import { numericValuesMatch } from './verify-fx-supabase.js'

assert.equal(numericValuesMatch(null, null), true)
assert.equal(numericValuesMatch(undefined, null), true)
assert.equal(numericValuesMatch(null, '0'), false)
assert.equal(numericValuesMatch(0, null), false)
assert.equal(numericValuesMatch(123.456, '123.456'), true)
assert.equal(numericValuesMatch(0.1 + 0.2, '0.3'), true)
assert.equal(numericValuesMatch(100, '100.01'), false)

console.log('Supabase verification value comparisons passed.')
