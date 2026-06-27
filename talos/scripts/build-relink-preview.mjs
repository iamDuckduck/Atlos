import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.resolve(ROOT, 'oem-relink/src/seo-preview.generated.ts');

const runPreviewBuild = (target, locale, outputFile) => {
  execFileSync('node', ['./scripts/build-seo-pages.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      BUILD_TARGET: target,
      SEO_LOCALE: locale,
      SEO_PREVIEW_ONLY: '1',
      SEO_PREVIEW_FORMAT: 'json',
      SEO_PREVIEW_OUTPUT_FILE: path.relative(ROOT, outputFile),
    },
  });
};

const readPreviewJson = async (file) => fs.readJson(file);

const buildGeneratedTs = (locales) => `export type SeoPointPreview = {
  title: string;
  description: string;
};

export type SeoPointPreviewLocale = 'zh' | 'en';

export const SEO_POINT_PREVIEWS: Record<SeoPointPreviewLocale, Record<string, SeoPointPreview>> = ${JSON.stringify(locales, null, 2)} as const;
`;

const tempDir = await fs.mkdtemp(path.resolve(os.tmpdir(), 'talos-relink-preview-'));

try {
  const zhFile = path.resolve(tempDir, 'zh.json');
  const enFile = path.resolve(tempDir, 'en.json');

  runPreviewBuild('oss', 'zh-CN', zhFile);
  runPreviewBuild('r2', 'en-US', enFile);

  const [zh, en] = await Promise.all([
    readPreviewJson(zhFile),
    readPreviewJson(enFile),
  ]);

  await fs.writeFile(OUT_FILE, buildGeneratedTs({ zh, en }), 'utf8');
  console.log(`[relink-preview] wrote ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`[relink-preview] zh=${Object.keys(zh).length}, en=${Object.keys(en).length}`);
} finally {
  await fs.remove(tempDir);
}
