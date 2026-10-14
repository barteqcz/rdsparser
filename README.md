# rdsparser

**Pure JavaScript RDS/RBDS group decoder** with progressive error-weighted text correction and adaptive PS detection. Ported from [Konrad Kosmatka's librdsparser](https://github.com/kkonradpl/librdsparser). No C library, `koffi`, WebAssembly, or runtime npm dependencies.

Works in **Node.js 18+** with both `require()` and ES-module `import`. The ES-module sources can also be imported directly by modern browsers (using relative file paths). The decoder expects already-demodulated RDS groups supplied by receiver hardware/software; it does not demodulate a radio signal or perform CRC correction.

## Install

Once published to npm:

```sh
npm install rdsparser
```

Before publication, from a local checkout:

```sh
npm install /path/to/rdsparser
```

> The npm name `rdsparser` must be available to publish it. If the name is taken, use a scoped name such as `@your-npm-username/rdsparser` and update the examples accordingly.

## Quick start (CommonJS / FM-DX Webserver)

```js
const { RDSParser, TEXT, BLOCK_TYPE, PROGRESSIVE } = require('rdsparser');
const parser = new RDSParser();

// Optional: match the FM-DX Webserver adapter's correction settings.
for (const text of [TEXT.PS, TEXT.RT]) {
  parser.setTextCorrection(text, BLOCK_TYPE.INFO, 2);
  parser.setTextCorrection(text, BLOCK_TYPE.DATA, 2);
  parser.setTextProgressive(text, PROGRESSIVE.AUTO);
}

parser.on('ps', snapshot => console.log('PS:', snapshot.text));
parser.on('rt', (snapshot, flag) => console.log('RT:', flag, snapshot.text));
parser.on('af', frequencyKhz => console.log('AF:', frequencyKhz));

// Four 16-bit RDS blocks followed by an optional packed error byte.
parser.parseString('34DD054AE3054F2015');

// Reset on frequency change to avoid mixing stations.
parser.clear();
```

In FM-DX Webserver, **keep** `server/rds/receiver.js`, but change its first import to:

```diff
-const { RDSParser, TEXT, BLOCK_TYPE, PROGRESSIVE, countryName, countryISO } = require('./index');
+const { RDSParser, TEXT, BLOCK_TYPE, PROGRESSIVE, countryName, countryISO } = require('rdsparser');
```

Remove the local decoder files `server/rds/RDSParser.js`, `server/rds/tables.js`, and `server/rds/index.js`, and add `rdsparser` to FM-DX Webserver's npm dependencies (`npm install rdsparser`). The unchanged FM-DX Webserver adapter is also provided as [`examples/fm-dx-webserver-receiver.cjs`](examples/fm-dx-webserver-receiver.cjs).

## ES-module usage

```js
import { RDSParser, TEXT } from 'rdsparser';
const parser = new RDSParser();
parser.on('pi', pi => console.log(pi.toString(16)));
parser.parse({ blocks: [0x34DD, 0x054A, 0xE305, 0x4F20], errors: [0,1,1,1] });
```

For browser builds, import the browser-compatible source entry `src/index.js` directly or bundle it with your preferred bundler. No Node.js-only APIs are used by the decoder itself.

## Decoder features

- PI, PTY, TP, TA, M/S, RDS/RBDS PTY lookup
- PS, RadioText 2A/2B, PTYN, Long PS (LPS)
- Alternative Frequencies (AF), ECC/country detection, Clock Time (CT)
- Progressive per-character error-quality correction for PS and RT
- Adaptive static/dynamic PS detection, configurable thresholds
- Optional extended checking for scalar fields and AF
- Independent parser instances (one per receiver)

**RT+ is not implemented in this source port**, matching the supplied C source snapshot.

### Input format

```js
parser.parseString('34DD054AE3054F2015');
parser.parseString('34DD054AE3054F20'); // omit error byte (all errors = 0)
parser.parse([0x34DD, 0x054A, 0xE305, 0x4F20], [0,1,1,1]);
parser.parse({blocks: [0x34DD,0x054A,0xE305,0x4F20],errors: [0,1,1,1]});
```

The 18-character hex format consists of four 16-bit words and one packed error byte. That byte stores four two-bit correction qualities, from A (bits 7–6) through D (bits 1–0): `0` no error; `1` small corrected; `2` large corrected; `3` uncorrectable. The above `0x15` corresponds to `[0,1,1,1]`.

### Public API

```js
const p = new RDSParser();
p.on('ps', callback); p.off('ps', callback);
p.parseString('34DD054AE3054F2015'); // true when valid
p.parse([a,b,c,d], [errorA,errorB,errorC,errorD]);
p.clear();
p.setExtendedCheck(true); p.getExtendedCheck();
p.setTextCorrection(TEXT.PS, BLOCK_TYPE.DATA, 2);
p.getTextCorrection(TEXT.PS, BLOCK_TYPE.DATA);
p.setTextProgressive(TEXT.PS, PROGRESSIVE.AUTO);
p.getTextProgressive(TEXT.PS);
p.getPI(); p.getPTY(); p.getTP(); p.getTA(); p.getMS();
p.getECC(); p.getCountry(); p.getAF(); p.getLPS();
p.getPS(); p.getRT(0); p.getRT(1); p.getPTYN();
p.getState();
```

Text values returned by `getPS()`, `getRT()` and `getPTYN()` have shape `{ text, errors, length, available }`. The `rt` event passes `(snapshot, abFlag)`. AF callback values are in **kHz**. A CT event returns `{ year, month, day, hour, minute, offset }` where `offset` is in minutes from UTC.

Other utility exports: `ptyName`, `ptyShort`, `ptyLong`, `lookupCountry`, `countryName`, `countryISO`, `BLOCK_ERROR`, and `STRING_ERROR_UNCORRECTABLE`.

Defaults follow the original C library: progressive correction and extended checking are disabled, with zero-error blocks accepted by default. Set thresholds explicitly to enable error-quality-aware reconstruction.

## Development and publishing

```sh
npm test                  # includes 61,065-group C-reference regression fixtures
npm run build             # generates CommonJS in dist/ from ES-module source
npm pack --dry-run        # preview package contents
npm login                 # authenticate with npm
npm publish --access public
```

The npm package **contains only** `src/`, generated `dist/`, `README.md`, `LICENSE`, `NOTICE.md`, and `package.json`. The GitHub repository additionally contains test fixtures, build script, examples, and CI workflow. `prepack` builds the CJS files before packaging.

Use `src/` as the **single source of truth**; do not edit `dist/` by hand. Commit regenerated `dist/` files when editing the parser, so a checkout works without a build step.

### Verification

`npm test` checks multiple RDS features and parses the **61,065-group** TEF6687 reference dataset against checkpoints derived from the supplied C source. During initial port development, the JavaScript parser was also compared against a compiled C reference after every group, including adaptive PS mode. These tests are included in GitHub but excluded from npm releases.

## License and attribution

**LGPL-2.1-or-later.** Ported from **librdsparser** by Konrad Kosmatka, Copyright © 2023–2025. See [NOTICE.md](NOTICE.md) for attribution and [LICENSE](LICENSE) for the license terms. `rdsparser` is an independent port, not an official release from the original author.
