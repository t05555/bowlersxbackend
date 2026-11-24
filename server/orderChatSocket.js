import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import {
  findOrderByCustomerToken,
  findOrderById,
  getOrCreateConversationForOrder,
  getConversationMessages,
  createChatMessage,
  markConversationRead,
  getConversationById,
  getUnreadSummary,
  isValidObjectId,
  serializeMessage,
} from './orderChatService.js';

const recentClientMessageIds = new Map();

function rememberClientMessage(socketId, clientMessageId) {
  if (!clientMessageId) return false;
  const key = `${socketId}:${clientMessageId}`;
  const now = Date.now();
  const prev = recentClientMessageIds.get(key);
  if (prev && now - prev < 2 * 60 * 1000) return true;
  recentClientMessageIds.set(key, now);
  if (recentClientMessageIds.size > 5000) {
    for (const [k, ts] of recentClientMessageIds) {
      if (now - ts > 5 * 60 * 1000) recentClientMessageIds.delete(k);
    }
  }
  return false;
}

function verifyAdmin(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload?.role === 'admin' ? payload : null;
  } catch {
    return null;
  }
}

function tokenFromSocket(socket) {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
  const header = socket.handshake.headers?.authorization || '';
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}

function roomForConversation(conversationId) {
  return `conversation:${String(conversationId)}`;
}

async function resolvePrincipal(socket, payload = {}) {
  const token = tokenFromSocket(socket);
  const admin = verifyAdmin(token);
  const orderId = payload.orderId ? String(payload.orderId) : '';
  const conversationId = payload.conversationId ? String(payload.conversationId) : '';

  let resolvedOrderId = orderId;
  if (!resolvedOrderId && conversationId && isValidObjectId(conversationId)) {
    const conversation = await getConversationById(conversationId);
    if (conversation) resolvedOrderId = String(conversation.orderId);
  }
  if (!resolvedOrderId || !isValidObjectId(resolvedOrderId)) return { error: 'Valid order is required' };

  if (admin) {
    const order = await findOrderById(resolvedOrderId);
    if (!order) return { error: 'Order not found' };
    return { role: 'admin', senderId: admin.username || 'admin', orderId: resolvedOrderId, admin };
  }

  const order = await findOrderByCustomerToken(resolvedOrderId, token);
  if (!order) return { error: 'Unauthorized' };
  return { role: 'customer', senderId: order.email || String(order._id), orderId: resolvedOrderId, order };
}

export function createOrderChatSocket(httpServer, corsOptions = {}) {
  const io = new Server(httpServer, {
    cors: corsOptions,
    path: '/socket.io',
  });

  io.use((socket, next) => {
    const token = tokenFromSocket(socket);
    if (!token) return next(new Error('Authentication required'));
    // allow connection for admin JWT or potentially customer token; detailed room access checked on join/send
    const admin = verifyAdmin(token);
    if (admin) {
      socket.data.principal = { role: 'admin', senderId: admin.username || 'admin' };
      return next();
    }
    // customer token validity is order-specific; accept connection and enforce per-room/order on events
    socket.data.principal = { role: 'customer', token };
    return next();
  });

  io.on('connection', (socket) => {
    socket.on('chat:join', async (payload = {}, ack) => {
      try {
        const principal = await resolvePrincipal(socket, payload);
        if (principal.error) return ack?.({ ok: false, error: principal.error });
        const result = await getOrCreateConversationForOrder(principal.orderId);
        if (result.error) return ack?.({ ok: false, error: result.error });
        const room = roomForConversation(result.conversation._id);
        socket.join(room);
        socket.data.joinedRooms = socket.data.joinedRooms || new Set();
        socket.data.joinedRooms.add(room);
        socket.data.conversationRole = socket.data.conversationRole || {};
        socket.data.conversationRole[String(result.conversation._id)] = principal.role;
        socket.data.conversationOrder = socket.data.conversationOrder || {};
        socket.data.conversationOrder[String(result.conversation._id)] = principal.orderId;
        const messages = await getConversationMessages(result.conversation._id);
        ack?.({ ok: true, conversationId: String(result.conversation._id), orderId: principal.orderId, role: principal.role, messages });
      } catch {
        ack?.({ ok: false, error: 'Unable to join conversation' });
      }
    });

    socket.on('chat:send', async (payload = {}, ack) => {
      try {
        const principal = await resolvePrincipal(socket, payload);
        if (principal.error) return ack?.({ ok: false, error: principal.error });
        const clientMessageId = payload.clientMessageId ? String(payload.clientMessageId).slice(0, 120) : '';
        if (rememberClientMessage(socket.id, clientMessageId)) {
          return ack?.({ ok: true, duplicate: true });
        }
        const result = await getOrCreateConversationForOrder(principal.orderId);
        if (result.error) return ack?.({ ok: false, error: result.error });
        const room = roomForConversation(result.conversation._id);
        if (!socket.rooms.has(room)) socket.join(room);
        const created = await createChatMessage({
          conversationId: result.conversation._id,
          senderId: principal.senderId,
          senderRole: principal.role,
          message: payload.message,
        });
        if (created.error) return ack?.({ ok: false, error: created.error });
        const outgoing = { ...created.message, clientMessageId: clientMessageId || undefined };
        io.to(room).emit('chat:new-message', { conversationId: String(result.conversation._id), orderId: principal.orderId, message: outgoing });
        io.emit('chat:conversation-updated', { conversationId: String(result.conversation._id), orderId: principal.orderId });
        ack?.({ ok: true, message: outgoing });
      } catch {
        ack?.({ ok: false, error: 'Unable to send message' });
      }
    });

    socket.on('chat:read', async (payload = {}, ack) => {
      try {
        const conversationId = String(payload.conversationId || '');
        if (!isValidObjectId(conversationId)) return ack?.({ ok: false, error: 'Conversation not found' });
        const conversation = await getConversationById(conversationId);
        if (!conversation) return ack?.({ ok: false, error: 'Conversation not found' });
        const principal = await resolvePrincipal(socket, { orderId: String(conversation.orderId), conversationId });
        if (principal.error) return ack?.({ ok: false, error: principal.error });
        const result = await markConversationRead(conversationId, principal.role);
        if (result.error) return ack?.({ ok: false, error: result.error });
        const room = roomForConversation(conversationId);
        io.to(room).emit('chat:read', { conversationId, role: principal.role, readerRole: principal.role });
        io.emit('chat:unread-updated', await getUnreadSummary().catch(() => ({ adminUnread: 0, adminUnreadConversations: 0, customerUnread: 0 })));
        ack?.({ ok: true, conversation: result.conversation });
      } catch {
        ack?.({ ok: false, error: 'Unable to mark messages as read' });
      }
    });

    async function emitTyping(event, payload = {}) {
      try {
        const conversationId = String(payload.conversationId || '');
        if (!isValidObjectId(conversationId)) return;
        const conversation = await getConversationById(conversationId);
        if (!conversation) return;
        const principal = await resolvePrincipal(socket, { orderId: String(conversation.orderId), conversationId });
        if (principal.error) return;
        const room = roomForConversation(conversationId);
        if (!socket.rooms.has(room)) return;
        socket.to(room).emit(event, { conversationId, role: principal.role, isTyping: event === 'chat:typing' });
      } catch {
        // ignore typing errors
      }
    }

    socket.on('chat:typing', (payload) => { emitTyping('chat:typing', payload); });
    socket.on('chat:stop-typing', (payload) => { emitTyping('chat:stop-typing', payload); });

    socket.on('disconnect', () => {
      // cleanup recent ids for socket
      for (const key of recentClientMessageIds.keys()) {
        if (key.startsWith(`${socket.id}:`)) recentClientMessageIds.delete(key);
      }
    });
  });

  return io;
}
