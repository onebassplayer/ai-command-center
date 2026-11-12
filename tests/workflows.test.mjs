// Saved workflows must hold command choices and notes only, never pasted material.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCommands} from '../compiler.mjs';
import {STORAGE_KEY, recipe, readRecipes, writeRecipes} from '../workflows.mjs';

const commands = validateCommands(JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8')));
const memoryStorage = () => { const m = new Map(); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), raw: m}; };

test('round trip keeps name, steps and notes', () => {
  const s = memoryStorage();
  writeRecipes(s, [recipe('Review', ['specificity', 'redteam'], commands, {task: 'memo'})], commands);
  const back = readRecipes(s, commands);
  assert.deepEqual(back, [{notes: {task: 'memo'}, name: 'Review', steps: [{id: 'specificity', version: '0.2.0'}, {id: 'redteam', version: '0.2.0'}]}]);
});

test('extra fields such as material or context are never written', () => {
  const s = memoryStorage();
  const tainted = {...recipe('X', ['eli10'], commands), material: 'PRIVATE-MATERIAL', context: {audience: 'PRIVATE'}};
  writeRecipes(s, [tainted], commands);
  assert.ok(!s.raw.get(STORAGE_KEY).includes('PRIVATE'));
});

test('empty storage reads as no workflows; corrupt or oversized data is rejected', () => {
  assert.deepEqual(readRecipes(memoryStorage(), commands), []);
  const bad = memoryStorage(); bad.setItem(STORAGE_KEY, '{not json');
  assert.throws(() => readRecipes(bad, commands));
  const big = memoryStorage(); big.setItem(STORAGE_KEY, JSON.stringify(Array(51).fill({name: 'a', steps: [{id: 'eli10', version: '0.2.0'}]})));
  assert.throws(() => readRecipes(big, commands), /could not be read/);
  const stale = memoryStorage(); stale.setItem(STORAGE_KEY, JSON.stringify([{name: 'a', steps: [{id: 'eli10', version: '0.1.0'}]}]));
  assert.throws(() => readRecipes(stale, commands), /unavailable command versions/);
});

test('name and note limits are enforced', () => {
  assert.throws(() => recipe('', ['eli10'], commands), /between 1 and 80/);
  assert.throws(() => recipe('x'.repeat(81), ['eli10'], commands), /between 1 and 80/);
  assert.throws(() => recipe('ok', ['eli10'], commands, {task: 'x'.repeat(1001)}), /1,000 characters/);
  assert.throws(() => writeRecipes(memoryStorage(), Array(51).fill(recipe('a', ['eli10'], commands)), commands), /up to 50/);
});
