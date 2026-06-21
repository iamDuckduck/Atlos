import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { getDeployChannel, resolveDeployPrefix } from './release-channel.js';

const config = JSON.parse(fs.readFileSync('./config/config.r2.json', 'utf-8'));
const { endpoint, bucket, region, prefix: basePrefix, accessKeyId, accessKeySecret } =
  config.web.build.r2;
const deployChannel = getDeployChannel();
const { prefix, source: prefixSource } = resolveDeployPrefix({
  basePrefix,
  channel: deployChannel,
  target: 'r2',
  deployChannels: config?.web?.build?.deployChannels,
});

const localDir = path.resolve(process.cwd(), process.env.SEO_OG_OUTPUT_DIR || '../seo-og');
const uploadVariant = (process.env.SEO_OG_UPLOAD_VARIANT || 'r2').trim().toLowerCase();
const remoteBase = [prefix.replace(/^\/+|\/+$/g, ''), 'seo/og'].filter(Boolean).join('/');
const requestedConcurrency = Number.parseInt(process.env.SEO_OG_UPLOAD_CONCURRENCY || '40', 10);
const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
  ? requestedConcurrency
  : 40;

console.log(
  `[publish-seo-og-R2] channel=${deployChannel} prefix=${prefix || '/'} source=${prefixSource}`
);
console.log(`[publish-seo-og-R2] local=${path.relative(process.cwd(), localDir) || '.'}`);
console.log(`[publish-seo-og-R2] remote=${remoteBase || 'seo/og'}/`);
console.log(`[publish-seo-og-R2] variant=${uploadVariant}`);

const client = new S3Client({
  region: region || 'auto',
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey: accessKeySecret,
  },
});

const normalizeEtag = (etag) =>
  String(etag ?? '').replace(/^"|"$/g, '').toLowerCase();

const calculateFileMd5 = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

async function getRemoteObjectInfo(objectKey) {
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );
    return {
      etag: normalizeEtag(result.ETag),
      size: result.ContentLength ?? 0,
    };
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404 || e?.name === 'NotFound' || e?.Code === 'NoSuchKey') {
      return null;
    }
    throw e;
  }
}

async function shouldSkipUpload(localPath, objectKey, fileSize) {
  const [localEtag, remote] = await Promise.all([
    calculateFileMd5(localPath),
    getRemoteObjectInfo(objectKey),
  ]);
  return Boolean(remote && remote.size === fileSize && remote.etag === localEtag);
}

async function collectImageFiles(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectImageFiles(fullPath, baseDir));
      continue;
    }
    if (!entry.isFile() || !/^[0-9a-zA-Z]{7}\.jpg$/.test(entry.name)) continue;
    files.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
  }
  return files;
}

async function uploadImage(relativePath) {
  const localPath = path.join(localDir, relativePath);
  const objectKey = [remoteBase, relativePath].filter(Boolean).join('/');
  const stats = await fs.stat(localPath);

  if (await shouldSkipUpload(localPath, objectKey, stats.size)) {
    console.log(`${relativePath} skipped`);
    return;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: fs.createReadStream(localPath),
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  console.log(`${relativePath} uploaded (${(stats.size / 1024).toFixed(2)}KB)`);
}

async function run() {
  if (!(await fs.pathExists(localDir))) {
    throw new Error(`SEO OG image directory does not exist: ${localDir}`);
  }

  const hasVariantDirs = await fs.pathExists(path.join(localDir, 'oss'))
    || await fs.pathExists(path.join(localDir, 'r2'));
  const files = (await collectImageFiles(localDir))
    .filter((file) => {
      if (!hasVariantDirs) return true;
      if (uploadVariant === 'all') return /^(oss|r2)\/[0-9a-zA-Z]{7}\.jpg$/.test(file);
      return file.startsWith(`${uploadVariant}/`) && /^[0-9a-zA-Z]{7}\.jpg$/.test(path.basename(file));
    })
    .sort();

  if (!files.length) {
    console.log('[publish-seo-og-R2] no point images found.');
    return;
  }

  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, files.length)) },
    async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        await uploadImage(file);
      }
    },
  );

  await Promise.all(workers);
  console.log(`[publish-seo-og-R2] uploaded/skipped ${files.length} images.`);
}

run().catch((err) => {
  console.error('[publish-seo-og-R2] failed');
  console.error(err);
  process.exitCode = 1;
});
