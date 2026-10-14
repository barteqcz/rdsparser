import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { RDSParser as ImportedRDSParser, TEXT as ImportedText } from '@barteqcz/rdsparser';
const require = createRequire(import.meta.url);
const { RDSParser: RequiredRDSParser, TEXT: RequiredText } = require('rdsparser');

// Both formats are public entrypoints, not relative source imports.
test('npm exports work from require() and import', () => {
  assert.equal(typeof RequiredRDSParser, 'function');
  assert.equal(typeof ImportedRDSParser, 'function');
  assert.deepEqual(RequiredText, ImportedText);
  assert.equal(new RequiredRDSParser().parseString('34DD054AE3054F2015'), true);
  assert.equal(new ImportedRDSParser().parseString('34DD054AE3054F2015'), true);
});

test('CommonJS and ES modules decode identically across real RDS groups', () => {
  const a = new RequiredRDSParser();
  const b = new ImportedRDSParser();
  const frames = readFileSync(new URL('./fixtures/tef6687_static_ps.txt', import.meta.url), 'utf8').trim().split('\n');
  for (const frame of frames) {
    assert.equal(a.parseString(frame), true);
    assert.equal(b.parseString(frame), true);
  }
  assert.deepEqual(a.getState(), b.getState());
});

test('FM-DX receiver adapter example can be loaded and receives events', () => {
  const { createRDSReceiver } = require('../examples/fm-dx-webserver-receiver.cjs');
  const payload = {af:[]};
  const parser = createRDSReceiver(payload);
  parser.parseString('1234040801024142');
  assert.equal(payload.ps.slice(0,2), 'AB');
  assert.equal(payload.tp, 1);
});
