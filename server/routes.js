import multer from 'multer';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Brand from './models/Brand.js';
import Category from './models/Category.js';
import Customer from './models/Customer.js';
import Homepage from './models/Homepage.js';
import Product from './models/Product.js';
import Order from './models/Order.js';
import SiteSettings from './models/SiteSettings.js';
import Visit from './models/Visit.js';
import { requireAdmin } from './auth.js';
import { isR2Configured, uploadToR2, deleteFromR2 } from './storage.js';
import { z } from 'zod';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const booleans = ['published', 'featured', 'newArrival', 'bestSeller', 'inStock', 'active'];

const productUpdateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  price: z.coerce.number().nonnegative().optional(),
  stock: z.coerce.number().int().nonnegative().optional(),
  sku: z.string().trim().optional(),
  description: z.string().optional(),
  published: z.boolean().optional(),
  featured: z.boolean().optional(),
  newArrival: z.boolean().optional(),
  bestSeller: z.boolean().optional(),
  availability: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'preorder']).optional(),
  displayOrder: z.coerce.number().optional(),
  newArrivalUntil: z.coerce.date().nullable().optional(),
});

function normalizeBody(body = {}) {
  const data = { ...body };
  booleans.forEach((key) => {
    if (key in data) data[key] = data[key] === true || data[key] === 'true' || data[key] === '1';
  });
  ['price', 'compareAtPrice', 'stock', 'displayOrder', 'sortOrder'].forEach((key) => {
    if (data[key] !== undefined && data[key] !== '') data[key] = Number(data[key]);
  });
  if (typeof data.weightOptions === 'string') {
    data.weightOptions = data.weightOptions.split(',').map((value) => value.trim()).filter(Boolean);
  }
  if (typeof data.weightPrices === 'string') {
    data.weightPrices = data.weightPrices.split(',').map((entry) => {
      const [weight, price] = entry.split(':').map((value) => value.trim());
      return weight && price ? { weight, price: Number(price) } : null;
    }).filter((entry) => entry && Number.isFinite(entry.price));
  }
  ['newArrivalUntil'].forEach((key) => {
    if (data[key] === '' || data[key] === null) delete data[key];
  });
  ['brand','category','subcategory'].forEach((key) => {
    if (data[key] === '' || data[key] === null) delete data[key];
  });
  return data;
}

async function resolveNames(data) {
  if (data.brand) {
    const brand = mongoose.isValidObjectId(data.brand)
      ? await Brand.findById(data.brand).lean()
      : await Brand.findOne({ name: data.brand }).lean();
    if (brand) data.brandName = brand.name;
  }
  if (data.category) {
    const category = mongoose.isValidObjectId(data.category)
      ? await Category.findById(data.category).lean()
      : await Category.findOne({ name: data.category }).lean();
    if (category) data.categoryName = category.name;
  }
  if (data.subcategory) {
    const subcategory = mongoose.isValidObjectId(data.subcategory)
      ? await Category.findById(data.subcategory).lean()
      : await Category.findOne({ name: data.subcategory }).lean();
    if (subcategory) data.subcategoryName = subcategory.name;
  }
}

export function registerRoutes(app) {
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
      return res.status(503).json({ error: 'Admin authentication is not configured' });
    }
    if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    const token = jwt.sign({ role: 'admin', username }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, username });
  });

  app.get('/api/catalog', async (req, res, next) => {
    try {
      const filter = { published: true, $or: [{ newArrivalUntil: null }, { newArrivalUntil: { $gt: new Date() } }] };
      if (req.query.brand) filter.brandName = req.query.brand;
      if (req.query.category) filter.categoryName = req.query.category;
      if (req.query.subcategory) filter.subcategoryName = req.query.subcategory;
      if (req.query.featured === 'true') filter.featured = true;
      if (req.query.newArrival === 'true') filter.newArrival = true;
      if (req.query.bestSeller === 'true') filter.bestSeller = true;
      if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };
      const products = await Product.find(filter).sort({ displayOrder: 1, createdAt: -1 }).lean();
      res.json(products);
    } catch (error) { next(error); }
  });

  app.get('/api/public/homepage', async (_req, res, next) => {
    try {
      const homepage = await Homepage.findOne({ key: 'main' }).lean();
      const [newArrivals, featured, bestSellers, accessories, balls, shoes, bags, brands, categories] = await Promise.all([
        Product.find({ published: true, newArrival: true, $or: [{ newArrivalUntil: null }, { newArrivalUntil: { $gt: new Date() } }] }).sort({ displayOrder: 1 }).limit(12).lean(),
        Product.find({ published: true, featured: true }).sort({ displayOrder: 1 }).limit(12).lean(),
        Product.find({ published: true, bestSeller: true }).sort({ displayOrder: 1 }).limit(12).lean(),
        Product.find({ published: true, $or: [{ categoryName: 'Accessories' }, { subcategoryName: /Shoes|Bags|Cleaner|Towel|Grip|Tape|Insert|Wrist/i }] }).sort({ displayOrder: 1 }).limit(12).lean(),
        Product.find({ published: true, $or: [{ categoryName: 'Bowling Balls' }, { subcategoryName: /ball/i }] }).sort({ displayOrder: 1 }).limit(12).lean(),
        Product.find({ published: true, $or: [{ subcategoryName: /shoe/i }, { categoryName: /shoe/i }] }).sort({ displayOrder: 1 }).limit(12).lean(),
        Product.find({ published: true, $or: [{ subcategoryName: /bag/i }, { categoryName: /bag/i }] }).sort({ displayOrder: 1 }).limit(12).lean(),
        Brand.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
        Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      ]);
      res.json({ homepage: homepage?.sections || [], newArrivals, featured, bestSellers, accessories, balls, shoes, bags, brands, categories });
    } catch (error) { next(error); }
  });

  app.get('/api/brands/public', async (_req, res, next) => {
    try { res.json(await Brand.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean()); } catch (error) { next(error); }
  });
  app.get('/api/public/settings', async (_req, res, next) => {
    try {
      const settings = await SiteSettings.findOne({ key: 'main' }).select('phone email address').lean();
      res.json({ phone: settings?.phone || '', email: settings?.email || '', address: settings?.address || '' });
    } catch (error) { next(error); }
  });
  app.get('/api/categories/public', async (_req, res, next) => {
    try { res.json(await Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean()); } catch (error) { next(error); }
  });
  app.get('/api/products/:id', async (req, res, next) => {
    try {
      const product = await Product.findOne({ _id: req.params.id, published: true }).lean();
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json(product);
    } catch (error) { next(error); }
  });

  app.use('/api/admin', requireAdmin);

  app.get('/api/admin/dashboard', async (_req, res, next) => {
    try {
      const [productCount, publishedCount, orderCount, brandCount, categoryCount, lowStockCount, customerCount] = await Promise.all([
        Product.countDocuments(), Product.countDocuments({ published: true }), Order.countDocuments(),
        Brand.countDocuments(), Category.countDocuments(), Product.countDocuments({ $or: [{ stock: { $lte: 5 } }, { availability: 'out_of_stock' }] }),
        Customer.countDocuments(),
      ]);
      const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
      const startSevenDays = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const startMonth = new Date(); startMonth.setDate(1); startMonth.setHours(0, 0, 0, 0);
      const [revenueResult, sales, visitsToday, visitsSevenDays, visitsMonth, uniqueSevenDays, trafficByDay, orderStatusCounts] = await Promise.all([
        Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]),
        Order.aggregate([
          { $match: { createdAt: { $gte: startSevenDays } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        Visit.countDocuments({ createdAt: { $gte: startToday } }),
        Visit.countDocuments({ createdAt: { $gte: startSevenDays } }),
        Visit.countDocuments({ createdAt: { $gte: startMonth } }),
        Visit.distinct('sessionId', { createdAt: { $gte: startSevenDays } }),
        Visit.aggregate([
          { $match: { createdAt: { $gte: startSevenDays } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, visits: { $sum: 1 }, uniqueSessions: { $addToSet: '$sessionId' } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 1, visits: 1, uniqueVisitors: { $size: '$uniqueSessions' } } },
        ]),
        Order.aggregate([
          { $match: { createdAt: { $gte: startMonth } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
      ]);
      res.json({ productCount, publishedCount, orderCount, brandCount, categoryCount, lowStockCount, customerCount, revenue: revenueResult[0]?.total || 0, sales, visitsToday, visitsSevenDays, visitsMonth, uniqueVisitorsSevenDays: uniqueSevenDays.length, trafficByDay, orderStatusCounts });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/products', async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };
      if (req.query.brand) filter.brandName = req.query.brand;
      if (req.query.category) filter.categoryName = req.query.category;
      if (req.query.status === 'published') filter.published = true;
      if (req.query.status === 'draft') filter.published = false;
      if (req.query.availability) filter.availability = req.query.availability;
      const products = await Product.find(filter).sort({ displayOrder: 1, createdAt: -1 }).lean();
      res.json(products);
    } catch (error) { next(error); }
  });

  app.post('/api/admin/products', upload.array('images', 12), async (req, res, next) => {
    try {
      const schema = productUpdateSchema.extend({ name: z.string().trim().min(2), price: z.coerce.number().nonnegative(), stock: z.coerce.number().int().nonnegative().optional() });
      const validated = schema.safeParse(normalizeBody(req.body));
      if (!validated.success) return res.status(400).json({ error: validated.error.issues[0]?.message || 'Invalid product data' });
      const data = { ...normalizeBody(req.body), ...validated.data };
      data.slug = data.slug || slugify(data.name);
      await resolveNames(data);
      if (!data.stock) data.stock = 0;
      data.availability = data.stock === 0 ? 'out_of_stock' : data.availability || 'in_stock';
      data.inStock = data.stock > 0;
      const uploaded = [];
      for (let index = 0; index < (req.files || []).length; index++) {
        if (!isR2Configured()) throw new Error('Cloudflare R2 is not configured');
        const image = await uploadToR2(req.files[index]);
        uploaded.push({ url: image.url, key: image.key, alt: data.name || '', position: index });
      }
      data.images = uploaded;
      if (uploaded[0]) { data.imageUrl = uploaded[0].url; data.imageKey = uploaded[0].key; }
      const product = await Product.create(data);
      res.status(201).json(product);
    } catch (error) { next(error); }
  });

  app.put('/api/admin/products/:id', upload.array('images', 12), async (req, res, next) => {
    try {
      const existing = await Product.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Product not found' });
      const validated = productUpdateSchema.safeParse(normalizeBody(req.body));
      if (!validated.success) return res.status(400).json({ error: validated.error.issues[0]?.message || 'Invalid product data' });
      const data = { ...normalizeBody(req.body), ...validated.data };
      if (data.name) data.slug = data.slug || slugify(data.name);
      if (data.stock !== undefined) {
        data.availability = data.stock === 0 ? 'out_of_stock' : data.availability || existing.availability;
        data.inStock = data.stock > 0;
      }
      if (req.body.existingImages) {
        try {
          data.images = JSON.parse(req.body.existingImages);
        } catch { data.images = existing.images; }
        const keptKeys = new Set(data.images.map((image) => image.key).filter(Boolean));
        for (const image of existing.images || []) if (image.key && !keptKeys.has(image.key)) await deleteFromR2(image.key);
      }
      for (let index = 0; index < (req.files || []).length; index++) {
        if (!isR2Configured()) throw new Error('Cloudflare R2 is not configured');
        const image = await uploadToR2(req.files[index]);
        data.images = data.images || [];
        data.images.push({ url: image.url, key: image.key, alt: data.name || existing.name, position: data.images.length });
      }
      if (data.images?.length) {
        data.images.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).forEach((image, index) => { image.position = index; });
        data.imageUrl = data.images[0].url;
        data.imageKey = data.images[0].key;
      } else {
        data.imageUrl = undefined;
        data.imageKey = undefined;
      }
      const product = await Product.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
      res.json(product);
    } catch (error) { next(error); }
  });

  app.patch('/api/admin/products/:id/status', async req => {
    try {
      const product = await Product.findByIdAndUpdate(req.params.id, normalizeBody(req.body), { new: true, runValidators: true });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      res.json(product);
    } catch (error) { next(error); }
  });

  app.delete('/api/admin/products/:id', async (req, res, next) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      for (const image of product.images || []) if (image.key) await deleteFromR2(image.key);
      if (!product.images?.length && product.imageKey) await deleteFromR2(product.imageKey);
      await product.deleteOne();
      res.status(204).end();
    } catch (error) { next(error); }
  });

  for (const [name, Model, base] of [['brands', Brand, '/api/admin/brands'], ['categories', Category, '/api/admin/categories'], ['customers', Customer, '/api/admin/customers']]) {
    app.get(base, async (_req, res, next) => { try { res.json(await Model.find().sort({ sortOrder: 1, name: 1 }).lean()); } catch (error) { next(error); } });
    app.post(base, upload.single('image'), async (req, res, next) => {
      try {
        const data = normalizeBody(req.body);
        data.slug = data.slug || slugify(data.name);
        if (req.file) {
          const image = await uploadToR2(req.file);
          if (name === 'brands') { data.logoUrl = image.url; data.logoKey = image.key; }
          else { data.imageUrl = image.url; data.imageKey = image.key; }
        }
        res.status(201).json(await Model.create(data));
      } catch (error) { next(error); }
    });
    app.put(`${base}/:id`, upload.single('image'), async (req, res, next) => {
      try {
        const data = normalizeBody(req.body);
        if (req.file) {
          const current = await Model.findById(req.params.id);
          const oldKey = name === 'brands' ? current?.logoKey : current?.imageKey;
          if (oldKey) await deleteFromR2(oldKey);
          const image = await uploadToR2(req.file);
          if (name === 'brands') { data.logoUrl = image.url; data.logoKey = image.key; }
          else { data.imageUrl = image.url; data.imageKey = image.key; }
        }
        const item = await Model.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
        if (!item) return res.status(404).json({ error: `${name} record not found` });
        res.json(item);
      } catch (error) { next(error); }
    });
    app.delete(`${base}/:id`, async (req, res, next) => {
      try {
        const item = await Model.findByIdAndDelete(req.params.id);
        if (!item) return res.status(404).json({ error: `${name} record not found` });
        const key = name === 'brands' ? item.logoKey : item.imageKey;
        if (key) await deleteFromR2(key);
        res.status(204).end();
      } catch (error) { next(error); }
    });
  }

  app.get('/api/admin/orders', async (_req, res, next) => { try { res.json(await Order.find().sort({ createdAt: -1 }).lean()); } catch (error) { next(error); } });
  app.patch('/api/admin/orders/:id/status', async (req, res, next) => {
    try {
      const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      res.json(order);
    } catch (error) { next(error); }
  });

  app.get('/api/admin/homepage', async (_req, res, next) => { try { res.json(await Homepage.findOne({ key: 'main' }).lean()); } catch (error) { next(error); } });
  app.put('/api/admin/homepage', upload.any(), async (req, res, next) => {
    try {
      const sections = typeof req.body.sections === 'string' ? JSON.parse(req.body.sections) : req.body.sections;
      for (const file of req.files || []) {
        if (!isR2Configured()) throw new Error('Cloudflare R2 is not configured');
        const image = await uploadToR2(file);
        const section = sections.find((item) => item.key === file.fieldname);
        if (section) { section.imageUrl = image.url; section.imageKey = image.key; }
      }
      const homepage = await Homepage.findOneAndUpdate({ key: 'main' }, { key: 'main', sections }, { upsert: true, new: true, runValidators: true });
      res.json(homepage);
    } catch (error) { next(error); }
  });

  app.get('/api/admin/settings', async (_req, res, next) => {
    try {
      const settings = await SiteSettings.findOne({ key: 'main' }).lean();
      res.json(settings || {});
    } catch (error) { next(error); }
  });
  app.put('/api/admin/settings', async (req, res, next) => {
    try {
      const editableFields = ['storeName', 'phone', 'email', 'address', 'currency', 'announcement', 'footerText', 'facebookUrl', 'instagramUrl', 'youtubeUrl'];
      const data = Object.fromEntries(editableFields
        .filter((field) => typeof req.body[field] === 'string')
        .map((field) => [field, req.body[field].trim()]));
      const settings = await SiteSettings.findOneAndUpdate({ key: 'main' }, { key: 'main', ...data }, { upsert: true, new: true, runValidators: true });
      res.json(settings);
    } catch (error) { next(error); }
  });

  app.post('/api/analytics/visit', async (req, res, next) => {
    try {
      const sessionId = String(req.body.sessionId || '').slice(0, 80);
      if (!sessionId) return res.status(400).json({ error: 'Session identifier is required' });
      const userAgent = String(req.headers['user-agent'] || '').toLowerCase();
      const device = /mobile|android|iphone/i.test(userAgent) ? 'mobile' : /tablet|ipad/i.test(userAgent) ? 'tablet' : 'desktop';
      await Visit.create({
        sessionId,
        path: String(req.body.path || '/').slice(0, 300),
        referrer: String(req.body.referrer || '').slice(0, 500),
        device,
      });
      res.status(201).json({ recorded: true });
    } catch (error) { next(error); }
  });
}
