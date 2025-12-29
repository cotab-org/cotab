/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Build `dist/nls.bundle*.json` from `dist/nls.metadata.json` + `src/nls.<locale>.json`.
 *
 * Why:
 * - `vscode-nls` in bundle mode loads `nls.bundle.<locale>.json`.
 * - Our webpack setup generates `nls.metadata.json`/`nls.metadata.header.json`, but we also
 *   need locale bundles for in-the-box localization (especially when forcing standalone mode).
 */
'use strict';

const fs = require('fs');
const path = require('path');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, '\t') + '\n', 'utf8');
}

function ensureFileExists(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Required file not found: ${p}`);
  }
}

function toKey(entryKey) {
  if (typeof entryKey === 'string') return entryKey;
  if (entryKey && typeof entryKey.key === 'string') return entryKey.key;
  return undefined;
}

function buildBundle(metaData, translationsByKey) {
  const bundle = Object.create(null);
  for (const moduleId of Object.keys(metaData)) {
    const entry = metaData[moduleId];
    const keys = entry.keys || [];
    const defaults = entry.messages || [];
    const messages = [];
    for (let i = 0; i < defaults.length; i++) {
      const k = toKey(keys[i]);
      const translated = k ? translationsByKey[k] : undefined;
      messages.push(translated !== undefined ? translated : defaults[i]);
    }
    bundle[moduleId] = messages;
  }
  return bundle;
}

function buildDefaultBundle(metaData) {
  const bundle = Object.create(null);
  for (const moduleId of Object.keys(metaData)) {
    bundle[moduleId] = metaData[moduleId].messages || [];
  }
  return bundle;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const distDir = path.join(repoRoot, 'dist');
  const srcDir = path.join(repoRoot, 'src');

  const metaPath = path.join(distDir, 'nls.metadata.json');
  ensureFileExists(metaPath);
  const metaData = readJson(metaPath);

  // Always write default bundle (English)
  writeJson(path.join(distDir, 'nls.bundle.json'), buildDefaultBundle(metaData));

  // Automatically discover locale files
  const localeFiles = fs.readdirSync(srcDir)
    .filter(file => file.startsWith('nls.') && file.endsWith('.json') && file !== 'nls.json')
    .map(file => {
      const match = file.match(/^nls\.(.+)\.json$/);
      if (match) {
        const locale = match[1];
        return {
          locale,
          src: path.join(srcDir, file),
          out: path.join(distDir, `nls.bundle.${locale}.json`)
        };
      }
      return null;
    })
    .filter(Boolean);

  const locales = localeFiles;

  for (const { locale, src, out } of locales) {
    ensureFileExists(src);
    const translations = readJson(src);
    const bundle = buildBundle(metaData, translations);
    writeJson(out, bundle);
    // eslint-disable-next-line no-console
    console.log(`[i18n] wrote ${path.relative(repoRoot, out)} (${locale})`);
  }
}

main();


