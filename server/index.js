import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import multer from 'multer';
import Product from './models/Product.js';
import Order from './models/Order.js';
import { isR2Configured, uploadToR2, deleteFromR2 } from './storage.js';
import { registerRoutes } from './routes.js';
import { requireAdmin } from './auth.js';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = [
  ...(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  'https://bowlersx.vercel.app',
];
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.includes(origin));
  },
}));
app.use(express.json({ limit: '1mb' }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.get('/api/health', (_req, res) => {
  const mongoDb = mongoose.connection.readyState === 1;
  const r2 = isR2Configured();
  const healthy = mongoDb && (!isProduction || r2);
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    mongoDb,
    r2,
  });
});

app.get('/api/products', async (_req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    const products = await Product.find({ published: true }).sort({ displayOrder: 1, createdAt: -1 }).lean();
    res.json(products);
  } catch (error) { next(error); }
});

app.get('/api/orders', async (_req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    res.json(await Order.find().sort({ createdAt: -1 }).limit(20).lean());
  } catch (error) { next(error); }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'MongoDB is not configured' });
    const body = req.body;
    if (!body.customer || !body.email || !body.shippingAddress?.address || !Array.isArray(body.items) || !body.items.length) {
      return res.status(400).json({ error: 'Complete customer, shipping, and cart information is required' });
    }
    const items = body.items.map((item) => ({
      product: mongoose.isValidObjectId(item.product) ? item.product : undefined,
      name: String(item.name || 'Product').slice(0, 200),
      quantity: Math.max(1, Math.min(99, Number(item.quantity || 1))),
      price: Math.max(0, Number(item.price || 0)),
      weight: String(item.weight || '').slice(0, 20),
    }));
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shipping = subtotal >= 150 ? 0 : 12.95;
    const total = Number((subtotal + shipping).toFixed(2));
    const order = await Order.create({
      customer: String(body.customer).trim().slice(0, 200),
      email: String(body.email).trim().slice(0, 200),
      phone: String(body.phone || '').trim().slice(0, 50),
      shippingAddress: body.shippingAddress,
      paymentMethod: body.paymentMethod === 'paypal' ? 'paypal' : 'card',
      items,
      total,
      status: 'Processing',
    });
    res.status(201).json(order);
  } catch (error) { next(error); }
});

app.get('/api/admin/stats', async (_req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ productCount: 0, orderCount: 0, revenue: 0 });
    }
    const [productCount, orderCount, revenueResult] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]),
    ]);
    res.json({ productCount, orderCount, revenue: revenueResult[0]?.total ?? 0 });
  } catch (error) { next(error); }
});

app.post('/api/uploads/products', upload.single('image'), async (req, res, next) => {
  try {
    if (!isR2Configured()) {
      return res.status(503).json({ error: 'Cloudflare R2 is not configured' });
    }
    const result = await uploadToR2(req.file);
    res.status(201).json(result);
  } catch (error) { next(error); }
});

app.post('/api/products', requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'MongoDB is not configured' });
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (error) { next(error); }
});

app.put('/api/products/:id', requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'MongoDB is not configured' });
    const { id } = req.params;
    const product = await Product.findByIdAndUpdate(id, req.body, { new: true });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) { next(error); }
});

app.delete('/api/products/:id', requireAdmin, async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'MongoDB is not configured' });
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.name === 'ValidationError' ? 400 : 500;
  res.status(status).json({ error: isProduction ? 'Internal server error' : error.message });
});

const port = Number(process.env.PORT || 3001);

function validateProductionEnvironment() {
  if (!isProduction) return;

  const required = [
    'MONGODB_URI', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'JWT_SECRET', 'CORS_ORIGIN',
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(', ')}`);
  if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
  if (process.env.ADMIN_PASSWORD.length < 12 || process.env.ADMIN_PASSWORD === 'change-this-password') {
    throw new Error('ADMIN_PASSWORD must be a unique value of at least 12 characters in production');
  }
  if (['MONGODB_URI', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL']
    .some((key) => /<[^>]+>/.test(process.env[key]))) {
    throw new Error('Production environment variables must not contain example placeholders');
  }
}

async function start() {
  validateProductionEnvironment();

  if (!process.env.MONGODB_URI) {
    console.warn('MongoDB Atlas is not configured. The site is running with demo product data.');
    app.listen(port, '0.0.0.0', () => console.log(`API server listening on port ${port}`));
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected to MongoDB Atlas');
  } catch (error) {
    console.error('MongoDB connection failed:', error.name);
    if (isProduction) throw error;
    app.listen(port, '0.0.0.0', () => console.log(`API server listening on port ${port}`));
    return;
  }

  const collection = mongoose.connection.db.collection('products');
  const legacyProducts = await collection.find({}).toArray();
  for (const product of legacyProducts) {
    const update = { $set: {}, $unset: {} };
    if (typeof product.category === 'string') {
      update.$set.categoryName = product.category;
      update.$unset.category = '';
    }
    if (typeof product.subcategory === 'string') {
      update.$set.subcategoryName = product.subcategory;
      update.$unset.subcategory = '';
    }
    if (typeof product.brand === 'string') {
      update.$set.brandName = product.brand;
      update.$unset.brand = '';
    }
    if (Object.keys(update.$set).length || Object.keys(update.$unset).length) {
      await collection.updateOne({ _id: product._id }, update);
    }
  }

  app.listen(port, '0.0.0.0', () => console.log(`API server listening on port ${port}`));
}

registerRoutes(app);

start().catch((error) => {
  console.error('API startup failed:', error.message);
  process.exit(1);
});
