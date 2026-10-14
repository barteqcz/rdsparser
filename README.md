# rdsparser

**JavaScript RDS/RBDS group decoder** with progressive error-weighted text correction. Ported from [Konrad Kosmatka's librdsparser](https://github.com/kkonradpl/librdsparser).

`@barteqcz/rdsparser` decodes **already-demodulated RDS groups** (four 16-bit blocks, optionally with receiver-provided error levels). It does not demodulate FM signals or perform RDS block synchronization/CRC correction.

## Install

Requires Node.js 18 or newer.

```sh
npm install @barteqcz/rdsparser
```

## Quick start

### CommonJS (Node.js)

```js
const { RDSParser } = require('@barteqcz/rdsparser');

const parser = new RDSParser();

parser.on('pi', pi => console.log('PI:', pi.toString(16).toUpperCase().padStart(4, '0')));
parser.on('ps', ({ text }) => console.log('PS:', text));
parser.on('rt', ({ text }, flag) => console.log(`RadioText ${flag}:`, text));
parser.on('pty', pty => console.log('PTY:', pty));
parser.on('af', frequencyKhz => console.log('AF:', frequencyKhz / 1000, 'MHz'));

// Example: four 16-bit RDS blocks, followed by a packed error byte.
parser.parseString('34DD054AE3054F2015');
```

### ES modules

```js
import { RDSParser } from '@barteqcz/rdsparser';

const parser = new RDSParser();
parser.on('ps', ({ text }) => console.log('PS:', text));
parser.parseString('34DD054AE3054F2015');
```

## Providing RDS data

Your application is responsible for receiving the RDS blocks from a tuner, SDR, or another source and passing each group to the parser.

### Hex string input

```js
// Four 16-bit blocks: A, B, C, D (16 hex characters).
parser.parseString('34DD054AE3054F20');

// The same blocks with a packed receiver error byte (18 hex characters).
parser.parseString('34DD054AE3054F2015');
```

`parseString()` returns `true` when the input format is valid and `false` otherwise. The optional final byte contains four two-bit error levels for blocks A, B, C, and D, in that order (bits 7–6, 5–4, 3–2, 1–0). If omitted, all error levels default to zero.

### Block-array input

```js
parser.parse({
  blocks: [0x34DD, 0x054A, 0xE305, 0x4F20],
  errors: [0, 1, 1, 1]
});

// Or pass blocks and errors separately:
parser.parse([0x34DD, 0x054A, 0xE305, 0x4F20], [0, 1, 1, 1]);
```

Each error level must be an integer from `0` to `3` (`0` = no reported error; `3` = uncorrectable). The input represents **one RDS group**, not an arbitrary stream of bytes. `parse()` throws on invalid block/error arrays.

## Reading decoded data

Use event listeners to respond when values change:

```js
parser.on('tp', value => console.log('TP:', value));
parser.on('ta', value => console.log('TA:', value));
parser.on('ecc', value => console.log('ECC:', value));
parser.on('ct', clock => console.log('Clock time:', clock));
parser.on('lps', text => console.log('Long PS:', text));
```

You can also read the current decoded state at any time:

```js
const state = parser.getState();

console.log('PI:', state.pi);           // Number, or -1 if unknown
console.log('PS:', state.ps.text);     // Up to 8 characters
console.log('RT A:', state.rtA.text);
console.log('RT B:', state.rtB.text);
console.log('AF (kHz):', state.af);    // Array of frequencies
console.log('ECC:', state.ecc);
console.log('Country:', state.countryName);
```

The text snapshots returned by `getPS()`, `getRT(flag)`, `getPTYN()`, and in text events have this shape:

```js
{
  text: 'TEST FM ',
  errors: [/* error quality for each character */],
  length: 8,
  available: true
}
```

`errors` holds the parser's **per-character quality scores**, not the four receiver error levels passed into `parse()`. `available` indicates whether any text character has been received. PS/RT values may be incomplete until enough RDS groups arrive.

### Available events

| Event | Listener arguments | Meaning |
| --- | --- | --- |
| `pi` | `(pi)` | Program Identification code (number) |
| `pty` | `(pty)` | Programme Type (number) |
| `tp`, `ta`, `ms` | `(value)` | Traffic Programme, Traffic Announcement, Music/Speech flags |
| `ps` | `(snapshot)` | 8-character Program Service text |
| `rt` | `(snapshot, flag)` | RadioText and A/B flag (`0` or `1`) |
| `af` | `(frequencyKhz)` | Alternative frequency in kHz |
| `ecc` | `(ecc)` | Extended Country Code |
| `country` | `(countryId)` | Country lookup-table identifier |
| `ct` | `(clock)` | Clock Time object (including UTC offset in minutes) |
| `ptyn` | `(snapshot)` | Programme Type Name text |
| `lps` | `(text)` | Long PS text |

Events are emitted as new decoded information becomes available. The `on(event, callback)` method registers a listener; `off(event, callback)` removes it.

## Progressive text correction

When reception is weak, repeated RDS groups may contain characters with different receiver-reported error levels. Progressive correction lets the parser retain better-quality PS/RadioText characters rather than replacing them with worse ones.

```js
const { RDSParser, TEXT, BLOCK_TYPE, PROGRESSIVE } = require('@barteqcz/rdsparser');

const parser = new RDSParser();

for (const textType of [TEXT.PS, TEXT.RT]) {
  parser.setTextCorrection(textType, BLOCK_TYPE.INFO, 2);
  parser.setTextCorrection(textType, BLOCK_TYPE.DATA, 2);
  parser.setTextProgressive(textType, PROGRESSIVE.AUTO);
}

parser.on('ps', ({ text, errors }) => {
  console.log('PS:', text, 'quality:', errors);
});
```

The correction thresholds above accept reported block error levels up to `2` for both information and data blocks. `PROGRESSIVE.AUTO` enables adaptive static/dynamic PS detection for PS. Other supported modes are `PROGRESSIVE.DISABLED` and `PROGRESSIVE.ENABLED`. The example mirrors FM-DX Webserver's correction configuration; choose thresholds appropriate to your receiver.

Optional extended checking requires confirmation of some decoded scalar fields and AF values before publishing them:

```js
parser.setExtendedCheck(true);
```

## Integration with a receiver or web application

A radio application typically has three parts:

1. **Receiver code** obtains a complete RDS group (and, if available, error levels).
2. **`rdsparser`** processes the group and emits decoded values.
3. **Application code** forwards those values to a user interface, database, WebSocket, etc.

For example, an application can expose a small adapter around the parser:

```js
const { RDSParser } = require('@barteqcz/rdsparser');

const parser = new RDSParser();
const radio = { pi: null, ps: '', rt: '' };

parser.on('pi', pi => { radio.pi = pi; });
parser.on('ps', ({ text }) => { radio.ps = text; });
parser.on('rt', ({ text }) => { radio.rt = text; });

function receiveRdsGroup(hexGroup) {
  return parser.parseString(hexGroup);
}

function onFrequencyChanged() {
  // Discard text accumulated from the previous station.
  parser.clear();
  radio.pi = null;
  radio.ps = '';
  radio.rt = '';
}

// Call receiveRdsGroup(...) for every incoming receiver group.
// Use `radio` in your application or send its fields over WebSocket.
```

**No special adapter is required by the npm package itself.** The `receiver.js` file used by [FM-DX Webserver](https://github.com/NoobishSVK/fm-dx-webserver) is application-specific glue that maps these events to FM-DX Webserver's existing data fields.

Create a separate `RDSParser` instance for each independent receiver. Call `parser.clear()` on station/frequency changes to reset the decoded information; parser correction settings and event listeners are retained.

## Decoder features

- PI, PTY, TP, TA, M/S, RDS/RBDS PTY lookup
- PS, RadioText 2A/2B, PTYN, Long PS (LPS)
- Alternative Frequencies (AF), ECC/country detection, Clock Time (CT)
- Progressive per-character error-quality correction for PS and RT
- Adaptive static/dynamic PS detection, configurable thresholds
- Optional extended checking for scalar fields and AF
- Independent parser instances (one per receiver)

## License and attribution

**LGPL-2.1-or-later.** Ported from **librdsparser** by Konrad Kosmatka, Copyright © 2023–2025. See [LICENSE](LICENSE) for the license terms. `rdsparser` is an independent port, not an official release from the original author.
