import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RDSParser, TEXT, BLOCK_TYPE, PROGRESSIVE,
  lookupCountry, countryName, countryISO, ptyName } from '../src/index.js';
const group = (pi,b,c,d,errors=[0,0,0,0]) => ({blocks:[pi,b,c,d],errors});
const hex = (a,b,c,d,e=0) => [a,b,c,d].map(x=>x.toString(16).padStart(4,'0')).join('') + e.toString(16).padStart(2,'0');

test('defaults, 4-block words and error byte input', () => {
  const p = new RDSParser();
  assert.equal(p.getPI(), -1);
  assert.equal(p.getPS().available, false);
  assert.equal(p.parseString('34DD054AE3054F2015'), true);
  assert.equal(p.getPI(),0x34dd);
  assert.equal(p.parseString('not hex'),false);
  assert.equal(p.parseString('1234000041424344'),true);
  assert.throws(() => p.parse([0,0,0]),TypeError);
  assert.throws(() => p.parse([0,0,0,0],[0,0,0,4]),TypeError);
});

test('PI, PTY, TP, TA, MS, PS and distinct AF with error filtering', () => {
  const p = new RDSParser();
  const events = [];
  for (const type of ['pi','pty','tp','ta','ms','ps','af']) p.on(type, (...args) => events.push([type,...args]));
  for (let i=0;i<4;i++) {
    const ps=['TE','ST',' F','M '][i];
    const d=(ps.charCodeAt(0)<<8)|ps.charCodeAt(1);
    p.parse(group(0x1234, 0x0408|i, (1<<8)|2, d));
  }
  assert.equal(p.getPI(), 0x1234);
  assert.equal(p.getPTY(),0);
  assert.equal(p.getTP(),1);
  assert.equal(p.getTA(),0);
  assert.equal(p.getMS(),1);
  assert.equal(p.getPS().text,'TEST FM ');
  assert.deepEqual(p.getAF(),[87600,87700]);
  assert.deepEqual(events.filter(e=>e[0]==='af').map(e=>e[1]),[87600,87700]);
  p.parse(group(0xabcd,0x0001,0,0,[3,3,0,3]));
  assert.equal(p.getPI(),0x1234);
});

test('RT 2A, 2B, A/B flag changes and line-ending', () => {
  const p=new RDSParser(); const events=[];
  p.on('rt',(snapshot, flag)=>events.push([snapshot.text,flag]));
  p.parse(group(0x1234,0x2000,0x4845,0x4c4c)); // HELL
  p.parse(group(0x1234,0x2001,0x4f0d,0x4142)); // O<CR>AB
  assert.equal(p.getRT(0).text,'HELLO');
  p.parse(group(0x1234,0x2810,0,0x5859)); // group 2B, flag B, position 0
  assert.equal(p.getRT(1).text.slice(0,2),'XY');
  assert.equal(events.at(-1)[1],1);
});

test('PTYN group 10A, LPS group 15A, and UTF8', () => {
  const p=new RDSParser();
  p.parse(group(0x1234,0xa000,0x4142,0x4344));
  p.parse(group(0x1234,0xa001,0x4546,0x4748));
  assert.equal(p.getPTYN().text,'ABCDEFGH');
  let got;
  p.on('lps',value=>got=value);
  p.parse(group(0x1234,0xf000,0x4869,0x210d));
  assert.equal(got,'Hi!');
  assert.equal(p.getLPS(),'Hi!');
});

test('CT 4A MJD+half-hour offset', () => {
  const p=new RDSParser(); let ct;
  p.on('ct', value => ct=value);
  p.parse(group(0x1234,0x4541,0xd6e6,0xb9c2));
  assert.deepEqual(ct,{year:2023,month:11,day:27,hour:12,minute:39,offset:60});
  ct=null;
  p.parse(group(0x1234,0x4541,0xd6e6,0xb9c2,[0,0,1,0]));
  assert.equal(ct,null);
});

test('ECC/country lookup, PTY names', () => {
  const p=new RDSParser();
  p.parse(group(0x34dd,0x1000,0x00e0,0));
  assert.equal(p.getECC(), 0xe0);
  assert.equal(p.getCountry(),lookupCountry(0x34dd,0xe0));
  assert.equal(countryName(0),'Unknown');
  assert.equal(countryISO(0),'??');
  assert.equal(ptyName(1,false),'News');
  assert.equal(ptyName(-1),'Unknown');
});

test('extended-check requires repeated field and AF values', () => {
  const p=new RDSParser().setExtendedCheck(true);
  p.parse(group(0x1234,0x0000,0x0102,0x4142));
  assert.equal(p.getPI(),-1);
  assert.equal(p.getAF().length,0);
  p.parse(group(0x1234,0x0000,0x0102,0x4142));
  assert.equal(p.getPI(),0x1234);
  assert.deepEqual(p.getAF(),[87600,87700]);
});

test('progressive text preserves cleaner data; AF and strings are cleared without losing settings',()=>{
  const p=new RDSParser();
  p.setTextCorrection(TEXT.PS,BLOCK_TYPE.INFO,2);
  p.setTextCorrection(TEXT.PS,BLOCK_TYPE.DATA,2);
  p.setTextProgressive(TEXT.PS,PROGRESSIVE.ENABLED);
  p.parse(group(0x1234,0x0000,0,0x4142));
  p.parse(group(0x1234,0x0000,0,0x4344,[0,0,0,1]));
  assert.equal(p.getPS().text.slice(0,2),'AB');
  p.clear();
  assert.equal(p.getTextCorrection(TEXT.PS,BLOCK_TYPE.DATA),2);
  assert.equal(p.getTextProgressive(TEXT.PS),true);
  assert.equal(p.getPS().available,false);
});

function state(p) {
  const out=s=>[s.chars.map(ch=>ch.codePointAt(0)).join(','),s.errors.join(',')];
  const af=p.getAF();
  return [[p.getPI(),p.getPTY(),p.getTP(),p.getTA(),p.getMS(),p.getECC(),p.getCountry()].join(','),
    ...out(p.ps),...out(p.rt[0]),...out(p.rt[1]),...out(p.ptyn),
    p.getTextProgressive(TEXT.PS)?'1':'0',af.map(String).join(',')+(af.length?',':'')].join('|');
}

for(const mode of ['a','default']) {
  test(`all 61,065 TEF6687 groups agree with C reference at checkpoints (${mode})`,()=>{
    const data=readFileSync(new URL('./fixtures/tef6687_static_ps.txt',import.meta.url),'utf8').trim().split('\n');
    const checkpoints=JSON.parse(readFileSync(new URL('./fixtures/checkpoints.json',import.meta.url),'utf8'))[mode];
    const p=new RDSParser();
    if(mode==='a')p.setTextCorrection(TEXT.PS,BLOCK_TYPE.INFO,2)
      .setTextCorrection(TEXT.PS,BLOCK_TYPE.DATA,2)
      .setTextProgressive(TEXT.PS,PROGRESSIVE.AUTO);
    let j=0;
    for(let i=0;i<data.length;i++) {
      assert.equal(p.parseString(data[i]),true);
      if(j<checkpoints.length && checkpoints[j].index===i) {
        assert.equal(state(p),checkpoints[j].state,`C parity at group ${i}`);
        j++;
      }
    }
    assert.equal(j,checkpoints.length);
    assert.equal(p.getPS().text,'RADIO 7 ');
  });
}
