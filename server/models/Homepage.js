import mongoose from 'mongoose';

const sectionSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  buttonText: { type: String, default: '' },
  buttonUrl: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  imageKey: { type: String, default: '' },
}, { _id: false });

const homepageSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  sections: { type: [sectionSchema], default: [] },
}, { timestamps: true });

export default mongoose.models.Homepage || mongoose.model('Homepage', homepageSchema);
