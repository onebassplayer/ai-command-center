import {validateStack} from './compiler.mjs';
export const STORAGE_KEY = 'ai-command-center.workflows.v1';
export function recipe(name, ids, commands, notes = {}) {
  name = String(name ?? '').trim();
  if (!name || name.length > 80) throw new Error('Use a workflow name between 1 and 80 characters.');
  const chosen = validateStack(ids, commands);
  const cleanNotes = {};
  for (const key of ['task', 'worked', 'nextTime']) {
    const value = notes?.[key] ?? '';
    if (typeof value !== 'string' || value.length > 1000) throw new Error('Each workflow note must be text of at most 1,000 characters.');
    if (value.trim()) cleanNotes[key] = value.trim();
  }
  return {...(Object.keys(cleanNotes).length ? {notes: cleanNotes} : {}), name, steps: chosen.map(c => ({id:c.id, version:c.version}))};
}
export function readRecipes(storage, commands) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 50) throw new Error('Saved workflows could not be read.');
  return data.map(r => {
    if (!Array.isArray(r.steps) || r.steps.some(s => commands.find(c=>c.id===s.id)?.version !== s.version)) throw new Error('A saved workflow uses unavailable command versions.');
    return recipe(r.name, r.steps.map(s=>s.id), commands, r.notes);
  });
}
// Like readRecipes, but one workflow saved with an older command version no longer
// hides every other workflow. Unusable entries are returned separately, reduced to
// their allowlisted fields, so writeRecipes can keep them in storage unchanged.
export function readSavedWorkflows(storage, commands) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {usable: [], unavailable: []};
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 50) throw new Error('Saved workflows could not be read.');
  const usable = [], unavailable = [];
  for (const r of data) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('Saved workflows could not be read.');
    try {
      if (!Array.isArray(r.steps) || r.steps.some(s => !s || typeof s !== 'object')) throw new Error('malformed');
      if (r.steps.some(s => commands.find(c=>c.id===s.id)?.version !== s.version)) throw new Error('stale');
      usable.push(recipe(r.name, r.steps.map(s=>s.id), commands, r.notes));
    } catch {
      unavailable.push(keepUnavailable(r));
    }
  }
  return {usable, unavailable};
}
function keepUnavailable(r) {
  // Allowlisted fields only, values copied as stored (no truncation), so notes survive.
  const steps = Array.isArray(r.steps) ? r.steps.filter(s => s && typeof s === 'object').map(s => ({id: s.id, version: s.version})) : [];
  const kept = {name: r.name, steps};
  const notes = {};
  for (const key of ['task', 'worked', 'nextTime']) if (typeof r.notes?.[key] === 'string') notes[key] = r.notes[key];
  return Object.keys(notes).length ? {notes, ...kept} : kept;
}
export function writeRecipes(storage, recipes, commands, unavailable = []) {
  unavailable = unavailable.filter(r => r && typeof r === 'object');
  if (recipes.length + unavailable.length > 50) throw new Error('You can save up to 50 workflows. Delete one first.');
  // Rebuild from an allowlist: working material and context can never be persisted.
  const clean = recipes.map(r=>recipe(r.name,r.steps.map(s=>s.id),commands,r.notes));
  storage.setItem(STORAGE_KEY, JSON.stringify([...clean, ...unavailable.map(keepUnavailable)]));
  return clean;
}
