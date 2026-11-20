import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function createClient() {
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 is not configured');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export async function uploadToR2(file) {
  if (!file) throw new Error('No file provided');

  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!allowedTypes.has(file.mimetype)) {
    throw new Error('Only JPEG, PNG, WEBP, and GIF images are allowed');
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image must be smaller than 5 MB');
  }

  let body = file.buffer;
  let contentType = file.mimetype;
  let extension = path.extname(file.originalname).toLowerCase() || '.jpg';

  if (file.mimetype !== 'image/gif') {
    body = await sharp(file.buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    contentType = 'image/webp';
    extension = '.webp';
  }

  const key = `products/${crypto.randomUUID()}${extension}`;

  await createClient().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  const publicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return { key, url: publicUrl ? `${publicUrl}/${key}` : key };
}

export async function deleteFromR2(key) {
  if (!key) return;
  await createClient().send(new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  }));
}
