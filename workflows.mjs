import {validateStack} from './compiler.mjs';
export const STORAGE_KEY = 'ai-command-center.workflows.v1';
export function recipe(name, ids, commands) {
  name = String(name ?? '').trim();
  if (!name || name.length > 80) throw new Error('Use a workflow name between 1 and 80 characters.');
  const chosen = validateStack(ids, commands);
  return {name, steps: chosen.map(c => ({id:c.id, version:c.version}))};
}
export function readRecipes(storage, commands) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 50) throw new Error('Saved workflows could not be read.');
  return data.map(r => {
    if (!Array.isArray(r.steps) || r.steps.some(s => commands.find(c=>c.id===s.id)?.version !== s.version)) throw new Error('A saved workflow uses unavailable command versions.');
    return recipe(r.name, r.steps.map(s=>s.id), commands);
  });
}
export function writeRecipes(storage, recipes, commands) {
  if (recipes.length > 50) throw new Error('You can save up to 50 workflows. Delete one first.');
  // Rebuild from an allowlist: working material and context can never be persisted.
  const clean = recipes.map(r=>recipe(r.name,r.steps.map(s=>s.id),commands));
  storage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}
