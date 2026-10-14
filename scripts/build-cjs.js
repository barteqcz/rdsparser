/**
 * Generate the CommonJS distribution from the canonical ES-module source.
 * Uses Node.js built-ins only; no transpiler or external dependencies.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = name => readFileSync(resolve(root, 'src', name), 'utf8');
mkdirSync(resolve(root, 'dist'), { recursive: true });

let tables = src('tables.js');
if (!tables.includes('export const TABLES =')) throw new Error('Unexpected tables.js source format');
tables = tables.replace('export const TABLES =', 'const TABLES =');
tables += '\nmodule.exports = { TABLES };\n';
writeFileSync(resolve(root, 'dist/tables.cjs'), tables);

let parser = src('RDSParser.js');
const importLine = "import { TABLES } from './tables.js';";
if (!parser.includes(importLine)) throw new Error('Unexpected RDSParser.js source format');
parser = parser.replace(importLine, "const { TABLES } = require('./tables.cjs');");
parser = parser.replace(/^export (const|function|class) /gm, '$1 ');
if (/^export /m.test(parser)) throw new Error('Unconverted ES module export in RDSParser.js');
parser += '\nmodule.exports = { RDSParser, TEXT, BLOCK_TYPE, BLOCK_ERROR, PROGRESSIVE, STRING_ERROR_UNCORRECTABLE, lookupCountry, countryName, countryISO, ptyName, ptyShort, ptyLong };\n';
writeFileSync(resolve(root, 'dist/RDSParser.cjs'), parser);
writeFileSync(resolve(root, 'dist/index.cjs'), "/* Generated from src/RDSParser.js by npm run build. */\nmodule.exports = require('./RDSParser.cjs');\n");
console.log('Built CommonJS distribution in dist/');
