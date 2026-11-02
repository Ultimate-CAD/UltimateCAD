import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import configuration from './branding.cjs';

const { brand, publicAsset } = configuration;
const escape = (value) =>
  String(value).replace(/[<>&"']/g, (char) =>
    ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    })[char],
  );
const logo = readFileSync(publicAsset(brand.logo));
mkdirSync(path.dirname(publicAsset(brand.icon)), { recursive: true });
await sharp(logo)
  .resize(512, 512, { fit: 'contain', background: brand.backgroundColor })
  .png()
  .toFile(publicAsset(brand.icon));
mkdirSync(path.dirname(publicAsset(brand.splash)), { recursive: true });
const splash = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><rect width="640" height="320" rx="20" fill="${brand.backgroundColor}"/>`,
  `<image x="272" y="38" width="96" height="96" href="data:image/svg+xml;base64,${logo.toString('base64')}"/>`,
  `<g fill="${brand.foregroundColor}" font-family="Segoe UI,sans-serif" text-anchor="middle"><text x="320" y="184" font-size="32">${escape(brand.name)}</text>`,
  `<text x="320" y="222" font-size="15">${escape(brand.tagline)}</text><text x="320" y="268" font-size="13">${escape(brand.version)}</text></g></svg>`,
].join('');
writeFileSync(publicAsset(brand.splash), splash);
console.log(`Prepared local branding: ${brand.name} ${brand.version}`);
