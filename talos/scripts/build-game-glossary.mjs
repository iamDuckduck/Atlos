import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const gameDir = path.join(root, 'src/locale/data/game');
const regionDir = path.join(root, 'src/locale/data/region');
const outputPath = path.join(root, 'locale/data/game/glossary.csv');

const gameLanguages = [
  { gameFile: 'en-us.json', regionFile: 'en-US.json', locale: 'en-US', googleLanguage: 'en' },
  { gameFile: 'zh-cn.json', regionFile: 'zh-CN.json', locale: 'zh-CN', googleLanguage: 'zh-CN' },
  { gameFile: 'zh-tw.json', regionFile: 'zh-TW.json', locale: 'zh-HK', googleLanguage: 'zh-TW' },
  { gameFile: 'ja-JP.json', regionFile: 'ja-JP.json', locale: 'ja-JP', googleLanguage: 'ja' },
  { gameFile: 'ko-KR.json', regionFile: 'ko-KR.json', locale: 'ko-KR', googleLanguage: 'ko' },
  { gameFile: 'ru-RU.json', regionFile: 'ru-RU.json', locale: 'ru-RU', googleLanguage: 'ru' },
  { gameFile: 'es-ES.json', regionFile: 'es-ES.json', locale: 'es-ES', googleLanguage: 'es' },
  { gameFile: 'fr-FR.json', regionFile: 'fr-FR.json', locale: 'fr-FR', googleLanguage: 'fr' },
  { gameFile: 'de-DE.json', regionFile: 'de-DE.json', locale: 'de-DE', googleLanguage: 'de' },
  { gameFile: 'it-IT.json', regionFile: 'it-IT.json', locale: 'it-IT', googleLanguage: 'it' },
  { gameFile: 'pt-BR.json', regionFile: 'pt-BR.json', locale: 'pt-BR', googleLanguage: 'pt' },
  { gameFile: 'id-ID.json', regionFile: 'id-ID.json', locale: 'id-ID', googleLanguage: 'id' },
  { gameFile: 'th-TH.json', regionFile: 'th-TH.json', locale: 'th-TH', googleLanguage: 'th' },
  { gameFile: 'vi-VN.json', regionFile: 'vi-VN.json', locale: 'vi-VN', googleLanguage: 'vi' },
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

const withoutRegionShortNames = (entries) => (
  Object.fromEntries(Object.entries(entries).filter(([key]) => !key.endsWith('.short')))
);

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
    {
      ...flattenLeaves(readJson(path.join(gameDir, language.gameFile)), 'game'),
      ...withoutRegionShortNames(flattenLeaves(readJson(path.join(regionDir, language.regionFile)), 'region')),
    },
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
