import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  lastMessage: { type: String, default: '' },
  lastMessageAt: { type: Date, default: null },
  customerUnread: { type: Number, default: 0, min: 0 },
  adminUnread: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ lastMessageAt: -1 });

export default mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
