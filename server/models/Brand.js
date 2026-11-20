import mongoose from 'mongoose';

const brandSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  logoUrl: { type: String, default: '' },
  logoKey: { type: String, default: '' },
  description: { type: String, default: '' },
  active: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.models.Brand || mongoose.model('Brand', brandSchema);
