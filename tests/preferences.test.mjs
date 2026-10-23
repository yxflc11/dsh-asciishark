import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const bundle = await build({entryPoints:['src/preferences.ts'],bundle:true,write:false,format:'cjs',platform:'node'});
const storage = new Map();
const module = {exports:{}};
runInNewContext(bundle.outputFiles[0].text, {module,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
const {parsePreferences,normalizePreferences,savePreferences,readPreferences,DEFAULT_PREFERENCES,PREFERENCES_KEY} = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('fresh or damaged storage preserves the original clear ocean defaults',()=>{
  for(const value of [null,'broken','null','[]','42','{"mode":"dynamic"}']) {
    const settings=parsePreferences(value);
    assert.equal(settings.clarity,50);
    assert.equal(settings.maxFps,60);
    assert.equal(settings.fishCount,null);
    assert.equal(settings.sharkCount,6);
  }
});

test('legacy reading choices migrate without overriding newer clarity values',()=>{
  assert.equal(parsePreferences('{"mode":"static","readable":true}').clarity,22);
  assert.equal(parsePreferences('{"mode":"static","readable":false}').clarity,50);
  assert.equal(parsePreferences('{"readable":true,"clarity":80}').clarity,80);
  assert.equal(parsePreferences('{"mode":"off","readable":false}').mode,'off');
});

test('valid zero populations and disabled options survive saving and reloading',()=>{
  const settings=normalizePreferences({mode:'static',fishCount:0,sharkCount:0,maxFps:15,speed:0.25,clarity:90,interactive:false,glass:false});
  assert.equal(savePreferences(settings),true);
  assert.deepEqual(plain(readPreferences()),plain(settings));
  assert.equal(readPreferences().fishCount,0);
  assert.equal('readable' in JSON.parse(storage.get(PREFERENCES_KEY)),false);
  savePreferences(DEFAULT_PREFERENCES);
  assert.deepEqual(plain(readPreferences()),plain(DEFAULT_PREFERENCES));
});

test('out-of-range and non-finite settings cannot create unbounded work',()=>{
  const settings=normalizePreferences({fishCount:99999,sharkCount:999,maxFps:144,speed:Infinity,clarity:NaN});
  assert.equal(settings.fishCount,600);
  assert.equal(settings.sharkCount,12);
  assert.equal(settings.maxFps,60);
  assert.equal(settings.speed,1);
  assert.equal(settings.clarity,50);
  assert.equal(normalizePreferences({fishCount:-1}).fishCount,0);
  assert.equal(normalizePreferences({fishCount:'100'}).fishCount,null);
  assert.equal(normalizePreferences({fishCount:5.6}).fishCount,6);
});
