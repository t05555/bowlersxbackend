import { createHash, randomBytes } from 'node:crypto';

const MAX_MESSAGE_LENGTH = 1000;

export function createOrderChatToken() {
  return randomBytes(32).toString('base64url');
}

export function hashOrderChatToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeOrderChatMessage(value) {
  if (typeof value !== 'string') return { error: 'Message must be text' };
  const text = value.trim();
  if (!text) return { error: 'Message cannot be empty' };
  if (text.length > MAX_MESSAGE_LENGTH) return { error: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters` };
  return { text };
}
