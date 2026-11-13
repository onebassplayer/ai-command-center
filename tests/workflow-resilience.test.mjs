// One saved workflow from an older command version must not hide or erase the others.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCommands} from '../compiler.mjs';
import {STORAGE_KEY, recipe, readRecipes, readSavedWorkflows, writeRecipes} from '../workflows.mjs';

const commands = validateCommands(JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8')));
const memoryStorage = (value) => { const m = new Map(value === undefined ? [] : [[STORAGE_KEY, value]]); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), raw: m}; };
const good = recipe('Review', ['specificity', 'redteam'], commands, {task: 'memo'});
const stale = {name: 'Old one', notes: {worked: 'kept'}, steps: [{id: 'specificity', version: '0.1.0'}]};
const gone = {name: 'Removed command', steps: [{id: 'no-such-command', version: '9.9.9'}]};

test('empty storage gives no workflows', () => {
  assert.deepEqual(readSavedWorkflows(memoryStorage(), commands), {usable: [], unavailable: []});
});

test('a stale or removed command hides only that workflow', () => {
  const s = memoryStorage(JSON.stringify([good, stale, gone]));
  const {usable, unavailable} = readSavedWorkflows(s, commands);
  assert.deepEqual(usable, [good]);
  assert.deepEqual(unavailable.map(r => r.name), ['Old one', 'Removed command']);
  assert.throws(() => readRecipes(s, commands), /unavailable command versions/, 'strict reader is unchanged');
});

test('saving and deleting keep hidden workflows in storage', () => {
  const s = memoryStorage(JSON.stringify([good, stale]));
  const {usable, unavailable} = readSavedWorkflows(s, commands);
  writeRecipes(s, [...usable, recipe('New', ['eli10'], commands)], commands, unavailable);
  let stored = JSON.parse(s.getItem(STORAGE_KEY));
  assert.deepEqual(stored.map(r => r.name), ['Review', 'New', 'Old one']);
  assert.deepEqual(stored[2], stale);
  writeRecipes(s, [], commands, unavailable);
  stored = JSON.parse(s.getItem(STORAGE_KEY));
  assert.deepEqual(stored, [stale]);
});

test('hidden workflows count toward the 50 limit', () => {
  const s = memoryStorage();
  const fortyNine = Array.from({length: 49}, (_, i) => recipe('W' + i, ['eli10'], commands));
  assert.throws(() => writeRecipes(s, [...fortyNine, good], commands, [stale]), /up to 50/);
  assert.equal(s.getItem(STORAGE_KEY), null, 'nothing written on failure');
});

test('hidden workflows never carry material or context back into storage', () => {
  const tainted = {...stale, material: 'PRIVATE-MATERIAL', context: {audience: 'PRIVATE'}, steps: [{id: 'eli10', version: '0.0.1', extra: 'PRIVATE'}]};
  const s = memoryStorage(JSON.stringify([tainted]));
  const {unavailable} = readSavedWorkflows(s, commands);
  writeRecipes(s, [], commands, unavailable);
  assert.doesNotMatch(s.getItem(STORAGE_KEY), /PRIVATE/);
});

test('corrupt storage still fails closed without changing storage', () => {
  for (const bad of ['not json', '{}', JSON.stringify([null]), JSON.stringify([[1]]), JSON.stringify(Array(51).fill(good))]) {
    const s = memoryStorage(bad);
    assert.throws(() => readSavedWorkflows(s, commands));
    assert.equal(s.getItem(STORAGE_KEY), bad);
  }
});

test('odd entries are hidden, not fatal, and keep their notes in full', () => {
  const longNote = 'n'.repeat(1500);
  const odd = [{name: 'No steps'}, {name: 'Number version', steps: [{id: 'eli10', version: 1}]}, {name: '', steps: good.steps}, {name: 'Long', notes: {task: longNote}, steps: [{id: 'eli10', version: '0.0.1'}]}];
  const s = memoryStorage(JSON.stringify([good, ...odd]));
  const {usable, unavailable} = readSavedWorkflows(s, commands);
  assert.deepEqual(usable, [good]);
  assert.equal(unavailable.length, 4);
  writeRecipes(s, usable, commands, unavailable);
  const stored = JSON.parse(s.getItem(STORAGE_KEY));
  assert.equal(stored.length, 5);
  assert.equal(stored[4].notes.task.length, 1500);
  assert.deepEqual(stored[2].steps, [{id: 'eli10', version: 1}]);
});
