import mongoose from 'mongoose';

const siteSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  storeName: { type: String, default: 'BOWLERX' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  currency: { type: String, default: 'USD' },
  announcement: { type: String, default: '' },
  footerText: { type: String, default: '' },
  facebookUrl: { type: String, default: '' },
  instagramUrl: { type: String, default: '' },
  youtubeUrl: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.SiteSettings || mongoose.model('SiteSettings', siteSettingsSchema);
