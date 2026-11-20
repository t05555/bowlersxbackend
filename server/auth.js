import jwt from 'jsonwebtoken';

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Admin authentication is not configured' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('Invalid role');
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Admin authentication required' });
  }
}
