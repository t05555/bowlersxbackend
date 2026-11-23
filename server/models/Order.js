import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  customer: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  shippingAddress: {
    firstName: String, lastName: String, company: String, address: String,
    apartment: String, city: String, state: String, zip: String, country: String,
  },
  paymentMethod: { type: String, enum: ['card', 'paypal'], default: 'card' },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    quantity: { type: Number, default: 1, min: 1 },
    price: { type: Number, required: true, min: 0 },
    weight: { type: String, default: '' },
  }],
  chatTokenHash: { type: String, select: false },
  messages: [{
    sender: { type: String, enum: ['customer', 'admin'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
  }],
  total: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['Processing', 'Shipped', 'Delivered', 'Cancelled'], default: 'Processing' },
}, { timestamps: true });

export default mongoose.models.Order || mongoose.model('Order', orderSchema);
