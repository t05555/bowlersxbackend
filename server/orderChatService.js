import mongoose from 'mongoose';
import Conversation from './models/Conversation.js';
import Message from './models/Message.js';
import Order from './models/Order.js';
import Customer from './models/Customer.js';
import { hashOrderChatToken, normalizeOrderChatMessage } from './orderChat.js';

export function isValidObjectId(id) {
  return mongoose.isValidObjectId(id);
}

export async function findOrderByCustomerToken(orderId, token) {
  if (!token || !isValidObjectId(orderId)) return null;
  return Order.findOne({ _id: orderId, chatTokenHash: hashOrderChatToken(String(token).trim()) })
    .select('_id customer email phone total status items createdAt chatTokenHash')
    .lean();
}

export async function findOrderById(orderId) {
  if (!isValidObjectId(orderId)) return null;
  return Order.findById(orderId).select('_id customer email phone total status items createdAt').lean();
}

export async function resolveCustomerIdForOrder(order) {
  if (!order?.email) return null;
  const email = String(order.email).trim().toLowerCase();
  if (!email) return null;
  const existing = await Customer.findOne({ email }).select('_id').lean();
  if (existing?._id) return existing._id;
  const created = await Customer.create({
    name: String(order.customer || 'Customer').trim().slice(0, 200) || 'Customer',
    email,
    phone: String(order.phone || '').trim().slice(0, 50),
    active: true,
  }).catch(async () => Customer.findOne({ email }).select('_id').lean());
  return created?._id || null;
}

async function migrateEmbeddedMessagesIfNeeded(conversation, orderId) {
  const count = await Message.countDocuments({ conversationId: conversation._id });
  if (count > 0) return;
  const order = await Order.findById(orderId).select('messages customer email').lean();
  const legacy = Array.isArray(order?.messages) ? order.messages : [];
  if (!legacy.length) return;
  const docs = legacy.map((m) => ({
    conversationId: conversation._id,
    senderId: m.sender === 'admin' ? 'admin' : String(order?.email || orderId),
    senderRole: m.sender === 'admin' ? 'admin' : 'customer',
    message: String(m.text || '').trim().slice(0, 1000),
    read: false,
    createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
    updatedAt: m.createdAt ? new Date(m.createdAt) : new Date(),
  })).filter((d) => d.message);
  if (!docs.length) return;
  await Message.insertMany(docs, { ordered: false }).catch(() => {});
  const last = docs[docs.length - 1];
  await Conversation.findByIdAndUpdate(conversation._id, {
    $set: {
      lastMessage: last.message.slice(0, 300),
      lastMessageAt: last.createdAt,
    },
  });
}

export async function getOrCreateConversationForOrder(orderId) {
  const order = await findOrderById(orderId);
  if (!order) return { error: 'Order not found', status: 404 };
  const customerId = await resolveCustomerIdForOrder(order).catch(() => null);
  let conversation = await Conversation.findOne({ orderId: order._id });
  if (!conversation) {
    try {
      conversation = await Conversation.create({ orderId: order._id, customerId, lastMessage: '', lastMessageAt: null, customerUnread: 0, adminUnread: 0 });
    } catch (err) {
      if (err?.code === 11000) conversation = await Conversation.findOne({ orderId: order._id });
      else throw err;
    }
  } else if (!conversation.customerId && customerId) {
    conversation.customerId = customerId;
    await conversation.save().catch(() => {});
  }
  await migrateEmbeddedMessagesIfNeeded(conversation, order._id);
  return { conversation, order };
}

export function serializeConversation(conversation, order = null, extras = {}) {
  return {
    _id: String(conversation._id),
    orderId: String(conversation.orderId?._id || conversation.orderId),
    customerId: conversation.customerId ? String(conversation.customerId._id || conversation.customerId) : null,
    lastMessage: conversation.lastMessage || '',
    lastMessageAt: conversation.lastMessageAt || null,
    customerUnread: Number(conversation.customerUnread || 0),
    adminUnread: Number(conversation.adminUnread || 0),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    ...(order ? { order } : {}),
    ...extras,
  };
}

export function serializeMessage(message) {
  return {
    _id: String(message._id),
    conversationId: String(message.conversationId?._id || message.conversationId),
    senderId: message.senderId || '',
    senderRole: message.senderRole,
    message: message.message,
    read: !!message.read,
    createdAt: message.createdAt,
  };
}

export async function getConversationMessages(conversationId, { limit = 200, before } = {}) {
  const query = { conversationId };
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) query.createdAt = { $lt: d };
  }
  const capped = Math.max(1, Math.min(500, Number(limit) || 200));
  const messages = await Message.find(query).sort({ createdAt: 1 }).limit(capped).lean();
  return messages.map(serializeMessage);
}

export async function createChatMessage({ conversationId, senderId, senderRole, message }) {
  const normalized = normalizeOrderChatMessage(message);
  if (normalized.error) return { error: normalized.error, status: 400 };
  const role = senderRole === 'admin' ? 'admin' : 'customer';
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return { error: 'Conversation not found', status: 404 };
  const doc = await Message.create({
    conversationId: conversation._id,
    senderId: String(senderId || (role === 'admin' ? 'admin' : 'customer')).slice(0, 200),
    senderRole: role,
    message: normalized.text,
    read: false,
  });
  const unreadField = role === 'admin' ? 'customerUnread' : 'adminUnread';
  await Conversation.findByIdAndUpdate(conversation._id, {
    $set: { lastMessage: normalized.text.slice(0, 300), lastMessageAt: doc.createdAt },
    $inc: { [unreadField]: 1 },
  });
  // compatibility: append to embedded order messages (best-effort)
  await Order.findByIdAndUpdate(conversation.orderId, {
    $push: { messages: { $each: [{ sender: role, text: normalized.text, createdAt: doc.createdAt }], $slice: -200 } },
  }).catch(() => {});
  return { message: serializeMessage(doc), conversationId: String(conversation._id) };
}

export async function markConversationRead(conversationId, readerRole) {
  const role = readerRole === 'admin' ? 'admin' : 'customer';
  const otherRole = role === 'admin' ? 'customer' : 'admin';
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return { error: 'Conversation not found', status: 404 };
  await Message.updateMany(
    { conversationId: conversation._id, senderRole: otherRole, read: false },
    { $set: { read: true } },
  );
  const unreadField = role === 'admin' ? 'adminUnread' : 'customerUnread';
  conversation[unreadField] = 0;
  await conversation.save();
  return { conversation: serializeConversation(conversation) };
}

export async function getAdminConversations({ page = 1, limit = 20, search = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const skip = (pageNum - 1) * lim;
  const filter = {};
  let orderIds = null;
  const q = String(search || '').trim();
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const or = [{ customer: rx }, { email: rx }, { phone: rx }];
    if (isValidObjectId(q)) or.push({ _id: q });
    const matchingOrders = await Order.find(or).select('_id').lean();
    orderIds = matchingOrders.map((o) => o._id);
    if (!orderIds.length) return { conversations: [], page: pageNum, limit: lim, total: 0, totalPages: 0 };
    filter.orderId = { $in: orderIds };
  }
  const [total, conversations] = await Promise.all([
    Conversation.countDocuments(filter),
    Conversation.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate('orderId', 'customer email phone total status items createdAt')
      .lean(),
  ]);
  const list = conversations.map((c) => {
    const order = c.orderId && typeof c.orderId === 'object' ? c.orderId : null;
    const orderId = order?._id || c.orderId;
    return {
      _id: String(c._id),
      orderId: String(orderId),
      customerId: c.customerId ? String(c.customerId) : null,
      lastMessage: c.lastMessage || '',
      lastMessageAt: c.lastMessageAt || null,
      customerUnread: Number(c.customerUnread || 0),
      adminUnread: Number(c.adminUnread || 0),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      orderNumber: order?._id ? String(order._id).slice(-6).toUpperCase() : String(orderId).slice(-6).toUpperCase(),
      customerName: order?.customer || '',
      customerEmail: order?.email || '',
      customerPhone: order?.phone || '',
      orderStatus: order?.status || '',
      orderTotal: order?.total ?? null,
      orderCreatedAt: order?.createdAt || null,
    };
  });
  return { conversations: list, page: pageNum, limit: lim, total, totalPages: Math.ceil(total / lim) };
}

export async function getUnreadSummary() {
  const [adminUnread, customerUnreadAgg] = await Promise.all([
    Conversation.aggregate([{ $group: { _id: null, total: { $sum: '$adminUnread' }, conversations: { $sum: { $cond: [{ $gt: ['$adminUnread', 0] }, 1, 0] } } } }]),
    Conversation.aggregate([{ $group: { _id: null, total: { $sum: '$customerUnread' } } }]),
  ]);
  return {
    adminUnread: Number(adminUnread[0]?.total || 0),
    adminUnreadConversations: Number(adminUnread[0]?.conversations || 0),
    customerUnread: Number(customerUnreadAgg[0]?.total || 0),
  };
}

export async function getConversationWithOrder(conversationId) {
  if (!isValidObjectId(conversationId)) return null;
  return Conversation.findById(conversationId).populate('orderId', 'customer email phone total status items createdAt shippingAddress paymentMethod').lean();
}

export async function getConversationById(conversationId) {
  if (!isValidObjectId(conversationId)) return null;
  return Conversation.findById(conversationId).lean();
}
