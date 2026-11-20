import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  imageKey: { type: String, default: '' },
  active: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.models.Category || mongoose.model('Category', categorySchema);
