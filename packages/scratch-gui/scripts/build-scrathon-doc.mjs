import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mdPath = path.resolve(here, '../src/addons/addons/astras-copilot/docs/scrathon.md');
const outPath = path.resolve(here, '../src/addons/addons/astras-copilot/docs/scrathon-doc.js');
const markdown = fs.readFileSync(mdPath, 'utf8');

const output = `/**
 * Generated from docs/scrathon.md. Keep this file in sync with the
 * Markdown source; a unit test compares the two strings.
 *
 * Regenerate with: pnpm --filter scratch-gui build:scrathon-doc
 */
/* eslint-disable max-len */
// prettier-ignore
export const SCRATHON_DOC = ${JSON.stringify(markdown)};
/* eslint-enable max-len */
`;

fs.writeFileSync(outPath, output, 'utf8');
console.log(`Wrote ${outPath}`);
