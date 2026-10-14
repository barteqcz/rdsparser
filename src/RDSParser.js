/* SPDX-License-Identifier: LGPL-2.1-or-later
 * JavaScript translation of librdsparser's decoding state machine.
 * Original C library: Copyright (C) 2023-2025 Konrad Kosmatka.
 * JavaScript port follows the LGPL-2.1-or-later licensing of the source.
 */
import { TABLES } from './tables.js';

export const TEXT = Object.freeze({ PS: 0, RT: 1, PTYN: 2 });
export const BLOCK_TYPE = Object.freeze({ INFO: 0, DATA: 1 });
export const BLOCK_ERROR = Object.freeze({ NONE: 0, SMALL: 1, LARGE: 2, UNCORRECTABLE: 3 });
export const PROGRESSIVE = Object.freeze({ DISABLED: 0, AUTO: 1, ENABLED: 2 });
export const STRING_ERROR_UNCORRECTABLE = 10;

const FIELD_NAMES = ['pi', 'pty', 'tp', 'ta', 'ms', 'ecc', 'country'];

function createBuffer() {
  return { pi: -1, pty: -1, tp: -1, ta: -1, ms: -1, ecc: -1, country: 0, af: new Set() };
}

function validateIndex(value, max, name) {
  if (!Number.isInteger(value) || value < 0 || value >= max) throw new RangeError(`Invalid ${name}: ${value}`);
}

export function lookupCountry(pi, ecc) {
  if (!Number.isInteger(pi) || pi < 0) return 0;
  const id = (pi >>> 12) & 15;
  if (!id) return 0;
  let table, row;
  if (ecc >= 0xa0 && ecc <= 0xa6) { table = 'rdsparser_ecc_a0_a6_lut'; row = ecc - 0xa0; }
  else if (ecc >= 0xd0 && ecc <= 0xd4) { table = 'rdsparser_ecc_d0_d4_lut'; row = ecc - 0xd0; }
  else if (ecc >= 0xe0 && ecc <= 0xe5) { table = 'rdsparser_ecc_e0_e5_lut'; row = ecc - 0xe0; }
  else if (ecc >= 0xf0 && ecc <= 0xf4) { table = 'rdsparser_ecc_f0_f4_lut'; row = ecc - 0xf0; }
  else return 0;
  return TABLES.ecc[table][row][id - 1];
}

export function countryName(id) { return TABLES.countryNames[id - 1] ?? 'Unknown'; }
export function countryISO(id) { return TABLES.countryISO[id - 1] ?? '??'; }
export function ptyName(pty, rbds = false) { return TABLES.pty[rbds ? 'rbds_name' : 'rds_name'][pty] ?? 'Unknown'; }
export function ptyShort(pty, rbds = false) { return TABLES.pty[rbds ? 'rbds_short' : 'rds_short'][pty] ?? 'Unknown'; }
export function ptyLong(pty, rbds = false) { return TABLES.pty[rbds ? 'rbds_long' : 'rds_long'][pty] ?? 'Unknown'; }

class RDSText {
  constructor(size) {
    this.size = size;
    this.clear();
  }

  clear() {
    this.chars = Array(this.size).fill(' ');
    this.errors = Array(this.size).fill(STRING_ERROR_UNCORRECTABLE);
  }

  get length() {
    const pos = this.chars.indexOf('\0');
    return pos === -1 ? this.size : pos;
  }

  get available() { return this.errors.some(e => e !== STRING_ERROR_UNCORRECTABLE); }

  snapshot() {
    return {
      text: this.chars.slice(0, this.length).join(''),
      errors: this.errors.slice(),
      length: this.length,
      available: this.available
    };
  }

  update(position, input, error, progressive, allowEol, commit) {
    if (progressive && this.errors[position] < error) return false;
    if (input === 0x0d) {
      if (!allowEol || error !== 0) return false;
    } else if (input < 0x20) return false;
    if (input >= 0x7f && error !== 0) return false;
    const char = input === 0x0d ? '\0' : (input < 0x20 ? ' ' : TABLES.charset[input - 0x20]);
    if (this.chars[position] === char && this.errors[position] <= error) return false;
    if (commit) {
      this.chars[position] = char;
      this.errors[position] = error;
    }
    return true;
  }
}

/**
 * A source-compatible state-machine port of the 2025-11-13 C librdsparser.
 * Processes already-demodulated four-block RDS groups; it does NOT decode RF,
 * perform the RDS CRC/syndrome, or implement RT+ (not in the source snapshot).
 *
 * Events: pi, pty, tp, ta, ms, ecc, country, af, ps, rt, ptyn, ct, lps.
 * on('rt', callback) receives (snapshot, flag); other events receive a value.
 */
export class RDSParser {
  constructor() {
    this.listeners = new Map();
    this.extendedCheck = false;
    this.progressive = [false, false, false];
    this.correction = [[0, 0], [0, 0], [0, 0]];
    this.adaptivePS = false;
    this.clear();
  }

  on(event, callback) {
    if (typeof callback !== 'function') throw new TypeError('Listener must be a function');
    const set = this.listeners.get(event) ?? new Set();
    set.add(callback);
    this.listeners.set(event, set);
    return this;
  }

  off(event, callback) { this.listeners.get(event)?.delete(callback); return this; }
  _emit(event, value, arg) { for (const fn of this.listeners.get(event) ?? []) fn(value, arg); }

  clear() {
    this.used = createBuffer();
    this.temp = createBuffer();
    this.ps = new RDSText(8);
    this.rt = [new RDSText(64), new RDSText(64)];
    this.ptyn = new RDSText(8);
    this.lpsBytes = new Uint8Array(32);
    this.lpsValid = new Uint8Array(32);
    if (this.adaptivePS) {
      this.progressive[TEXT.PS] = true;
      this.adaptivePSCounter = 0;
      this.adaptivePSErrors = 0;
    }
    this.adaptivePSCounter ??= 0;
    this.adaptivePSErrors ??= 0;
    this.lastRTFlag = -1;
    return this;
  }

  setExtendedCheck(value) { this.extendedCheck = Boolean(value); return this; }
  getExtendedCheck() { return this.extendedCheck; }
  setTextCorrection(text, type, error) {
    validateIndex(text, 3, 'text');
    validateIndex(type, 2, 'block type');
    if (!Number.isInteger(error) || error < 0) throw new RangeError('Invalid error level');
    this.correction[text][type] = Math.min(2, error);
    return this;
  }
  getTextCorrection(text, type) { validateIndex(text, 3, 'text'); validateIndex(type, 2, 'block type'); return this.correction[text][type]; }
  setTextProgressive(text, mode) {
    validateIndex(text, 3, 'text');
    if (![0, 1, 2].includes(mode)) throw new RangeError('Invalid progressive mode');
    this.progressive[text] = mode !== PROGRESSIVE.DISABLED;
    if (text === TEXT.PS) {
      this.adaptivePS = mode === PROGRESSIVE.AUTO;
      this.adaptivePSCounter = 0;
    }
    return this;
  }
  getTextProgressive(text) { validateIndex(text, 3, 'text'); return this.progressive[text]; }

  _set(field, value) {
    if (this.used[field] === value || (this.extendedCheck && this.temp[field] !== value)) {
      this.temp[field] = value;
      return;
    }
    this.used[field] = value;
    this._emit(field, value);
  }

  _addAF(value) {
    if (value < 1 || value > 204 || this.used.af.has(value)) return;
    if (this.extendedCheck && !this.temp.af.has(value)) {
      this.temp.af.add(value);
      return;
    }
    this.used.af.add(value);
    this._emit('af', 87500 + value * 100);
  }

  _updateString(string, kind, block, data, errors, position) {
    const currError = Math.max(0, 2 * errors[1] + 3 * errors[block] - 1);
    this.adaptivePSErrors += currError === 0 ? -1 : 1;
    this.adaptivePSErrors = Math.max(0, Math.min(4, this.adaptivePSErrors));

    if (errors[1] > this.correction[kind][BLOCK_TYPE.INFO] ||
        errors[block] > this.correction[kind][BLOCK_TYPE.DATA]) return false;

    const prevError = Math.max(string.errors[position], string.errors[position + 1]);
    const input = [data[block] >>> 8, data[block] & 0xff];
    let changed = false;
    for (let i = 0; i < 2; i++)
      changed = string.update(position + i, input[i], currError, this.progressive[kind], kind === TEXT.RT, false) || changed;

    if (kind === TEXT.PS && this.adaptivePS && currError === 0 && prevError === 0) {
      if (changed) {
        if (this.progressive[kind] && this.adaptivePSCounter >= 20 && this.adaptivePSErrors) {
          this.adaptivePSCounter = 6;
          return false;
        }
        this.progressive[kind] = false;
        this.adaptivePSCounter = 0;
      } else if (this.adaptivePSCounter !== 20) {
        this.adaptivePSCounter++;
        if (!this.progressive[kind] && this.adaptivePSCounter === 6) {
          this.progressive[kind] = true;
          changed = true;
        }
      }
    }

    for (let i = 0; i < 2; i++)
      changed = string.update(position + i, input[i], currError, this.progressive[kind], kind === TEXT.RT, true) || changed;
    return changed;
  }

  _updateLPS(position, value) {
    this.lpsBytes[position] = value === 13 ? 0 : value;
    this.lpsValid[position] = 1;
  }
  _lpsAvailable() {
    for (let i = 0; i < 32; i++) {
      if (!this.lpsValid[i]) return false;
      if (this.lpsBytes[i] === 0) return true;
    }
    return true;
  }
  getLPS() {
    let len = 32;
    for (let i = 0; i < 32; i++) {
      if (!this.lpsValid[i]) return '';
      if (this.lpsBytes[i] === 0) { len = i; break; }
    }
    return new TextDecoder('utf-8').decode(this.lpsBytes.subarray(0, len));
  }

  _parseGroup4(data, errors) {
    if (errors[1] || errors[2] || errors[3]) return;
    let mjd = ((data[1] & 3) << 15) | (data[2] >>> 1);
    let hour = ((data[2] & 1) << 4) | (data[3] >>> 12);
    let minute = (data[3] & 0xfc0) >>> 6;
    const offset = ((data[3] & 0x20) ? -1 : 1) * (data[3] & 0x1f);
    if (hour >= 24 || minute >= 60) return;
    minute += (offset % 2) * 30;
    if (minute >= 60) { hour++; minute %= 60; }
    else if (minute < 0) { hour--; minute += 60; }
    hour += Math.trunc(offset / 2);
    if (hour >= 24) { mjd++; hour %= 24; }
    else if (hour < 0) { mjd--; hour += 24; }
    const y = Math.trunc((mjd * 100 - 1507820) / 36525);
    const yearTmp = Math.trunc(y * 36525 / 100);
    const monthValue = Math.trunc(((mjd * 100 - 1495610) - yearTmp * 100) * 100 / 306001);
    const monthTmp = Math.trunc(monthValue * 306001 / 10000);
    const day = mjd - 14956 - yearTmp - monthTmp;
    const k = monthValue === 14 || monthValue === 15 ? 1 : 0;
    const ct = { year: 1900 + y + k, month: monthValue - 1 - k * 12,
      day, hour, minute, offset: offset * 30 };
    this._emit('ct', ct);
  }

  /** Process four 16-bit words and optional four receiver correction levels (0..3). */
  parse(dataOrGroup, optionalErrors) {
    const data = Array.isArray(dataOrGroup) || ArrayBuffer.isView(dataOrGroup)
      ? dataOrGroup : dataOrGroup?.blocks;
    const errors = optionalErrors ?? dataOrGroup?.errors ?? [0, 0, 0, 0];
    if (!data || data.length !== 4 || !errors || errors.length !== 4 ||
        !Array.from(data).every(v => Number.isInteger(v) && v >= 0 && v <= 0xffff) ||
        !Array.from(errors).every(v => Number.isInteger(v) && v >= 0 && v <= 3))
      throw new TypeError('Expected four uint16 blocks and four error levels (0..3)');
    if (errors[0] === 0) this._set('pi', data[0]);
    if (errors[1] === 0) {
      this._set('pty', (data[1] & 0x03e0) >>> 5);
      this._set('tp', (data[1] & 0x0400) >>> 10);
    }
    const group = (data[1] >>> 12) & 15;
    const bFlag = Boolean(data[1] & 0x0800);

    if (group === 0) {
      if (errors[1] === 0) {
        this._set('ta', (data[1] >>> 4) & 1);
        this._set('ms', (data[1] >>> 3) & 1);
      }
      if (this._updateString(this.ps, TEXT.PS, 3, data, errors, 2 * (data[1] & 3)))
        this._emit('ps', this.ps.snapshot());
      if (!bFlag && errors[1] === 0 && errors[2] === 0) {
        const first = data[2] >>> 8;
        if (first !== 250) { this._addAF(first); this._addAF(data[2] & 0xff); }
      }
    } else if (group === 1 && !bFlag) {
      if (errors[1] === 0 && errors[2] === 0 && ((data[2] >>> 12) & 7) === 0) {
        const ecc = data[2] & 0xff;
        this._set('ecc', ecc);
        this._set('country', lookupCountry(this.used.pi, ecc));
      }
    } else if (group === 2) {
      const rtFlag = (data[1] >>> 4) & 1;
      let changed = false;
      if (errors[1] === 0 && rtFlag !== this.lastRTFlag) {
        if (this.lastRTFlag !== -1 && this.rt[rtFlag].available) {
          this.rt[rtFlag].clear();
          changed = true;
        }
        this.lastRTFlag = rtFlag;
      }
      if (errors[1] !== 0 && rtFlag !== this.lastRTFlag && this.lastRTFlag !== -1) return this;
      const pos = (data[1] & 15) * (bFlag ? 2 : 4);
      if (!bFlag)
        changed = this._updateString(this.rt[rtFlag], TEXT.RT, 2, data, errors, pos) || changed;
      changed = this._updateString(this.rt[rtFlag], TEXT.RT, 3, data, errors, pos + (bFlag ? 0 : 2)) || changed;
      if (changed) this._emit('rt', this.rt[rtFlag].snapshot(), rtFlag);
    } else if (group === 4 && !bFlag) {
      this._parseGroup4(data, errors);
    } else if (group === 10 && !bFlag) {
      const pos = 4 * (data[1] & 1);
      let changed = this._updateString(this.ptyn, TEXT.PTYN, 2, data, errors, pos);
      changed = this._updateString(this.ptyn, TEXT.PTYN, 3, data, errors, pos + 2) || changed;
      if (changed) this._emit('ptyn', this.ptyn.snapshot());
    } else if (group === 15 && !bFlag && errors[1] === 0) {
      const position = 4 * (data[1] & 7);
      const wasAvailable = this._lpsAvailable();
      if (errors[2] === 0) {
        this._updateLPS(position, data[2] >>> 8);
        this._updateLPS(position + 1, data[2] & 0xff);
      }
      if (errors[3] === 0) {
        this._updateLPS(position + 2, data[3] >>> 8);
        this._updateLPS(position + 3, data[3] & 0xff);
      }
      if (!wasAvailable && this._lpsAvailable()) this._emit('lps', this.getLPS());
    }
    return this;
  }

  /** Native librdsparser format: 16 hex digits; optional 2 hex-digit packed error byte. */
  parseString(input) {
    if (typeof input !== 'string' || !/^(?:[0-9a-fA-F]{16})(?:[0-9a-fA-F]{2})?$/.test(input)) return false;
    const data = [0, 4, 8, 12].map(i => parseInt(input.slice(i, i + 4), 16));
    const packed = input.length === 18 ? parseInt(input.slice(16), 16) : 0;
    const errors = [6, 4, 2, 0].map(i => (packed >>> i) & 3);
    this.parse(data, errors);
    return true;
  }

  getPI() { return this.used.pi; }
  getPTY() { return this.used.pty; }
  getTP() { return this.used.tp; }
  getTA() { return this.used.ta; }
  getMS() { return this.used.ms; }
  getECC() { return this.used.ecc; }
  getCountry() { return this.used.country; }
  getAF() { return [...this.used.af].sort((a, b) => a - b).map(v => 87500 + v * 100); }
  getPS() { return this.ps.snapshot(); }
  getRT(flag = 0) { validateIndex(flag, 2, 'RT flag'); return this.rt[flag].snapshot(); }
  getPTYN() { return this.ptyn.snapshot(); }
  getState() {
    return { pi: this.getPI(), pty: this.getPTY(), tp: this.getTP(), ta: this.getTA(), ms: this.getMS(),
      ecc: this.getECC(), country: this.getCountry(), countryName: countryName(this.getCountry()),
      af: this.getAF(), ps: this.getPS(), rtA: this.getRT(0), rtB: this.getRT(1),
      ptyn: this.getPTYN(), lps: this.getLPS(), progressivePS: this.getTextProgressive(TEXT.PS) };
  }
}
