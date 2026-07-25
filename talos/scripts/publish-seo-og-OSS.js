import OSS from 'ali-oss';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { getDeployChannel, resolveDeployPrefix } from './release-channel.js';

const config = JSON.parse(fs.readFileSync('./config/config.json', 'utf-8'));
const { region, bucket, accessKeyId, accessKeySecret, prefix: basePrefix } = config.web.build.oss;
const deployChannel = getDeployChannel();
const { prefix, source: prefixSource } = resolveDeployPrefix({
  basePrefix,
  channel: deployChannel,
  target: 'oss',
  deployChannels: config?.web?.build?.deployChannels,
});

const OSS_OG_VARIANT = 'oss';
const localDir = path.resolve(process.cwd(), process.env.SEO_OG_OUTPUT_DIR || `../seo-og/${OSS_OG_VARIANT}`);
const remoteBase = [
  prefix.replace(/^\/+|\/+$/g, ''),
  'seo/og',
  OSS_OG_VARIANT,
].filter(Boolean).join('/');
const requestedConcurrency = Number.parseInt(process.env.SEO_OG_UPLOAD_CONCURRENCY || '40', 10);
const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
  ? requestedConcurrency
  : 40;

console.log(
  `[publish-seo-og-OSS] channel=${deployChannel} prefix=${prefix || '/'} source=${prefixSource}`,
);
console.log(`[publish-seo-og-OSS] local=${path.relative(process.cwd(), localDir) || '.'}`);
console.log(`[publish-seo-og-OSS] remote=${remoteBase || 'seo/og'}/`);
console.log(`[publish-seo-og-OSS] variant=${OSS_OG_VARIANT}`);

const client = new OSS({
  region,
  accessKeyId,
  accessKeySecret,
  authorizationV4: true,
  bucket,
  timeout: 120000,
  agent: undefined,
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

const getRemoteObjectInfo = async (objectKey) => {
  try {
    const result = await client.getObjectMeta(objectKey);
    const headers = result?.res?.headers ?? {};
    return {
      etag: normalizeEtag(headers.etag),
      size: Number.parseInt(headers['content-length'], 10) || 0,
    };
  } catch (e) {
    if (e?.status === 404 || e?.code === 'NoSuchKey' || e?.code === 'NoSuchObject') {
      return null;
    }
    throw e;
  }
};

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

  await client.put(objectKey, localPath, {
    headers: {
      'x-oss-storage-class': 'Standard',
      'x-oss-object-acl': 'default',
      'x-oss-forbid-overwrite': 'false',
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
  console.log(`${relativePath} uploaded (${(stats.size / 1024).toFixed(2)}KB)`);
}

async function run() {
  if (!(await fs.pathExists(localDir))) {
    throw new Error(`SEO OG image directory does not exist: ${localDir}`);
  }

  const files = (await collectImageFiles(localDir))
    .sort();
  if (!files.length) {
    console.log('[publish-seo-og-OSS] no point images found.');
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
  console.log(`[publish-seo-og-OSS] uploaded/skipped ${files.length} images.`);
}

run().catch((err) => {
  console.error('[publish-seo-og-OSS] failed');
  console.error(err);
  process.exitCode = 1;
});
