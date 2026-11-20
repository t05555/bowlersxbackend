import mongoose from 'mongoose';

const visitSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, trim: true },
  path: { type: String, default: '/', trim: true },
  referrer: { type: String, default: '', trim: true },
  device: { type: String, enum: ['mobile', 'tablet', 'desktop', 'unknown'], default: 'unknown' },
}, { timestamps: true });

visitSchema.index({ createdAt: -1 });
visitSchema.index({ sessionId: 1, createdAt: -1 });

export default mongoose.models.Visit || mongoose.model('Visit', visitSchema);
