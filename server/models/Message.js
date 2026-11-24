import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderId: { type: String, default: '' },
  senderRole: { type: String, enum: ['customer', 'admin'], required: true },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  read: { type: Boolean, default: false },
}, { timestamps: true });

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ conversationId: 1, read: 1, senderRole: 1 });

export default mongoose.models.Message || mongoose.model('Message', messageSchema);
