import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0, default: null },
  sku: { type: String, trim: true, default: '' },
  brand: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', default: null },
  brandName: { type: String, trim: true, default: '' },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  categoryName: { type: String, trim: true, default: '' },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  subcategoryName: { type: String, trim: true, default: '' },
  weightOptions: [{ type: String, trim: true }],
  weightPrices: [{ weight: { type: String, required: true }, price: { type: Number, required: true, min: 0 } }],
  stock: { type: Number, required: true, min: 0, default: 0 },
  availability: { type: String, enum: ['in_stock', 'low_stock', 'out_of_stock', 'preorder'], default: 'in_stock' },
  published: { type: Boolean, default: false },
  featured: { type: Boolean, default: false },
  newArrival: { type: Boolean, default: false },
  newArrivalUntil: { type: Date, default: null },
  bestSeller: { type: Boolean, default: false },
  displayOrder: { type: Number, default: 0 },
  color: { type: String, default: 'blue', trim: true },
  sale: { type: Boolean, default: false },
  inStock: { type: Boolean, default: true },
  images: [{
    url: { type: String, required: true },
    key: { type: String, default: '' },
    alt: { type: String, default: '' },
    position: { type: Number, default: 0 },
  }],
  imageUrl: { type: String, trim: true, default: '' },
  imageKey: { type: String, trim: true, default: '' },
}, { timestamps: true });

export default mongoose.models.Product || mongoose.model('Product', productSchema);
