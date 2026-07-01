import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const gameDir = path.join(root, 'src/locale/data/game');
const outputPath = path.join(root, 'locale/data/game/glossary.csv');

const gameLanguages = [
  { file: 'en-us.json', locale: 'en-US', googleLanguage: 'en' },
  { file: 'zh-cn.json', locale: 'zh-CN', googleLanguage: 'zh-CN' },
  { file: 'zh-tw.json', locale: 'zh-HK', googleLanguage: 'zh-TW' },
  { file: 'ja-JP.json', locale: 'ja-JP', googleLanguage: 'ja' },
  { file: 'ko-KR.json', locale: 'ko-KR', googleLanguage: 'ko' },
  { file: 'ru-RU.json', locale: 'ru-RU', googleLanguage: 'ru' },
  { file: 'es-ES.json', locale: 'es-ES', googleLanguage: 'es' },
  { file: 'fr-FR.json', locale: 'fr-FR', googleLanguage: 'fr' },
  { file: 'de-DE.json', locale: 'de-DE', googleLanguage: 'de' },
  { file: 'it-IT.json', locale: 'it-IT', googleLanguage: 'it' },
  { file: 'pt-BR.json', locale: 'pt-BR', googleLanguage: 'pt' },
  { file: 'id-ID.json', locale: 'id-ID', googleLanguage: 'id' },
  { file: 'th-TH.json', locale: 'th-TH', googleLanguage: 'th' },
  { file: 'vi-VN.json', locale: 'vi-VN', googleLanguage: 'vi' },
];

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const flattenLeaves = (value, prefix = '', output = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }

  if (typeof value === 'string') {
    output[prefix] = value.trim();
  }
  return output;
};

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
};

const writeCsv = (filePath, rows) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`,
    'utf8',
  );
};

const mapsByLocale = Object.fromEntries(
  gameLanguages.map((language) => [
    language.locale,
    flattenLeaves(readJson(path.join(gameDir, language.file))),
  ]),
);
const leafKeys = [...new Set(Object.values(mapsByLocale).flatMap((map) => Object.keys(map)))].sort();

const seenRows = new Set();
const rows = [
  gameLanguages.map((language) => language.googleLanguage),
];
for (const key of leafKeys) {
  const row = gameLanguages.map((language) => mapsByLocale[language.locale][key] ?? '');
  const signature = row.join('\u001f');
  if (seenRows.has(signature)) {
    continue;
  }
  seenRows.add(signature);
  rows.push(row);
}

writeCsv(outputPath, rows);

const missingCount = rows
  .slice(1)
  .reduce((count, row) => count + row.filter((value) => value === '').length, 0);
console.log(`[game-glossary] wrote ${path.relative(root, outputPath)} (${rows.length - 1} Google rows)`);
if (missingCount > 0) {
  console.log(`[game-glossary] missing translated cells: ${missingCount}`);
}
