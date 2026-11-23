import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWeightPrices } from './productInput.js';

test('normalizes weight-price entries from a form field', () => {
  assert.deepEqual(normalizeWeightPrices('12:179.95, 14:189.95'), [
    { weight: '12', price: 179.95 },
    { weight: '14', price: 189.95 },
  ]);
});

test('deduplicates repeated multipart fields and ignores invalid entries', () => {
  assert.deepEqual(normalizeWeightPrices(['12:179.95,invalid', '12:179.95,invalid']), [
    { weight: '12', price: 179.95 },
  ]);
});
