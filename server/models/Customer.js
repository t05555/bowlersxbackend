import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  active: { type: Boolean, default: true },
  notes: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.Customer || mongoose.model('Customer', customerSchema);
