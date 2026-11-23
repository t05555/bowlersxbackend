import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderChatToken, hashOrderChatToken, normalizeOrderChatMessage } from './orderChat.js';

test('order chat tokens are unique and stored as one-way digests', () => {
  const first = createOrderChatToken();
  const second = createOrderChatToken();

  assert.notEqual(first, second);
  assert.notEqual(hashOrderChatToken(first), first);
  assert.equal(hashOrderChatToken(first), hashOrderChatToken(first));
});

test('order chat messages are trimmed and reject blank or oversized input', () => {
  assert.deepEqual(normalizeOrderChatMessage('  Need help with my order  '), { text: 'Need help with my order' });
  assert.deepEqual(normalizeOrderChatMessage('  '), { error: 'Message cannot be empty' });
  assert.equal(normalizeOrderChatMessage('x'.repeat(1001)).error, 'Message cannot exceed 1000 characters');
  assert.equal(normalizeOrderChatMessage(null).error, 'Message must be text');
});
