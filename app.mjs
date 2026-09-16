import {recipe, readRecipes, writeRecipes} from './workflows.mjs';
import {loadResources, addStep, moveStep, validateStack, relevantFields, retainRelevantContext, searchCommands, dataFlow, compilePrompt, copyPreview} from './compiler.mjs';

const $ = id => document.getElementById(id);
const state = {commands: [], policy: null, ids: [], context: {}};
let copying = false;
const labels = {audience: 'Audience', tone: 'Tone', constraints: 'Constraints', criteria: 'Review criteria', evidence: 'Evidence', as_of_date: 'As-of date'};
const hints = {audience: 'Who is this for?', tone: 'For example: warm, direct, or formal', constraints: 'What must stay the same or be avoided?', criteria: 'What requirements should the audit check?', evidence: 'Paste supporting sources or excerpts. A link alone is not checked evidence.', as_of_date: 'Optional date for time-sensitive claims'};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function announce(text, error = false) {
  $('stack-status').textContent = text;
  $('stack-status').classList.toggle('error', error);
}
function renderCommands() {
  const matches = searchCommands(state.commands, $('search').value).filter(c => !$('category').value || c.category === $('category').value);
  $('search-count').textContent = `${matches.length} of ${state.commands.length} commands · choose any to add`;
  $('command-list').replaceChildren();
  if (!matches.length) $('command-list').append(element('p', 'No matching commands. Try a name or a simpler outcome, such as “explain” or “evidence”.', 'empty'));
  matches.forEach(c => {
    const selected = state.ids.includes(c.id);
    const card = element('article', undefined, `command-card${selected ? ' selected' : ''}`);
    const top = element('div', undefined, 'command-top');
    top.append(element('h3', c.name));
    const button = element('button', selected ? 'Added' : 'Add', 'add-button');
    button.id = `add-${c.id}`;
    button.setAttribute('aria-label', `${selected ? 'Already added' : 'Add'} ${c.name}`);
    button.disabled = selected;
    button.addEventListener('click', () => {
      try {
        state.ids = addStep(state.ids, c.id, state.commands);
        renderSelection();
        announce(`${c.name} added as step ${state.ids.length}.`);
        $(`details-${c.id}`).focus();
      } catch (error) { announce(error.message, true); }
    });
    top.append(button);
    const badges = element('div', undefined, 'badges');
    badges.append(element('span', c.stack.role === 'interactive' ? 'Interactive · use alone' : c.category, 'badge'));
    const details = element('details');
    // Search includes these fields: reveal them so matches are explainable.
    details.open = Boolean($('search').value.trim());
    const summary = element('summary', 'Changes, preserves & needs');
    summary.id = `details-${c.id}`;
    details.append(summary);
    const dl = element('dl');
    for (const [title, text] of [['Changes', c.changes], ['Preserves', c.preserves], ['Requires', 'Working material'], ['Optional context', c.inputs.optional.map(k => labels[k] ?? 'Goal').join(', ')], ['Behavior', c.stack.role === 'interactive' ? 'Asks one question at a time in your AI tool; use alone.' : c.stack.role === 'transform' ? 'Transform: rewrites the working material.' : 'Review: adds a report without rewriting the material.'], ['Version', c.version]]) {
      dl.append(element('dt', title), element('dd', text));
    }
    details.append(dl);
    card.append(top, element('p', c.product_interpretation), badges, details);
    $('command-list').append(card);
  });
}
function renderStack() {
  $('stack-list').replaceChildren();
  $('stack-empty').hidden = state.ids.length > 0;
  $('step-count').textContent = `${state.ids.length} / 5`;
  state.ids.forEach((id, index) => {
    const c = state.commands.find(c => c.id === id);
    const li = element('li', undefined, 'stack-item');
    const name = element('div', undefined, 'stack-name');
    name.append(element('span', `${index + 1}.`, 'stack-index'), element('span', c.name), element('span', c.stack.role === 'interactive' ? 'Interactive' : c.stack.role === 'transform' ? 'Transform' : 'Review', 'stack-role'));
    const actions = element('div', undefined, 'stack-actions');
    for (const [offset, symbol, direction] of [[-1, '↑', 'up'], [1, '↓', 'down']]) {
      const b = element('button', symbol);
      b.id = `${direction}-${id}`;
      b.setAttribute('aria-label', `Move ${c.name} ${direction}`);
      b.disabled = index + offset < 0 || index + offset >= state.ids.length;
      b.addEventListener('click', () => {
        state.ids = moveStep(state.ids, index, offset);
        renderSelection();
        announce(`${c.name} moved to step ${index + offset + 1}.`);
        const next = $(`${direction}-${id}`);
        (next.disabled ? $(`remove-${id}`) : next).focus();
      });
      actions.append(b);
    }
    const remove = element('button', 'Remove');
    remove.id = `remove-${id}`; remove.setAttribute('aria-label', `Remove ${c.name}`);
    remove.addEventListener('click', () => {
      state.ids = state.ids.filter(value => value !== id);
      const retained = retainRelevantContext(state.context, validateStack(state.ids, state.commands, false));
      const cleared = Object.keys(state.context).filter(key => !(key in retained) && state.context[key]);
      state.context = retained;
      renderSelection(); announce(`${c.name} removed.${cleared.length ? ' Cleared unused context: ' + cleared.map(key => labels[key]).join(', ') + '.' : ''}`);
      const neighbor = state.ids[Math.min(index, state.ids.length - 1)];
      (neighbor ? $(`remove-${neighbor}`) : $(`add-${id}`) ?? $('search')).focus();
    });
    actions.append(remove); li.append(name, actions); $('stack-list').append(li);
  });
  const chosen = validateStack(state.ids, state.commands, false);
  $('flow-wrap').hidden = !chosen.length; $('flow-list').replaceChildren();
  for (const f of dataFlow(chosen)) {
    const li = element('li');
    li.append(element('strong', `${f.step}. ${f.name}`), element('span', `${f.input} → ${f.output}. ${f.replacesMaterial ? 'This becomes the next step’s material.' : 'The material stays unchanged.'}`));
    $('flow-list').append(li);
  }
}
function renderContext() {
  const fields = relevantFields(validateStack(state.ids, state.commands, false));
  $('context-wrap').hidden = !fields.length;
  $('context-fields').replaceChildren();
  for (const key of fields) {
    const wrap = element('div');
    const label = element('label', labels[key]); label.htmlFor = `context-${key}`;
    const input = element(key === 'as_of_date' ? 'input' : 'textarea');
    input.id = `context-${key}`;
    if (key === 'as_of_date') input.type = 'date'; else input.rows = key === 'evidence' ? 4 : 2;
    input.value = state.context[key] ?? '';
    input.setAttribute('aria-describedby', `help-${key}`);
    input.addEventListener('input', () => { state.context[key] = input.value; updatePreview(); });
    const hint = element('p', hints[key], 'hint'); hint.id = `help-${key}`;
    wrap.append(label, input, hint); $('context-fields').append(wrap);
  }
}
function updatePreview() {
  $('copy-status').textContent = ''; $('copy-status').classList.remove('error');
  try {
    const prompt = compilePrompt({commands: state.commands, policy: state.policy, ids: state.ids, material: $('material').value, goal: $('goal').value, context: state.context});
    // This readonly field is the single source of truth for copying.
    $('preview').value = prompt;
    $('validation').textContent = 'Ready to copy. Review the full prompt below.';
    $('validation').classList.add('ready');
    $('material').setAttribute('aria-invalid', 'false');
    $('copy').disabled = copying;
  } catch (error) {
    $('preview').value = '';
    $('validation').textContent = error.message;
    $('validation').classList.remove('ready');
    $('material').setAttribute('aria-invalid', String(state.ids.length > 0 && !$('material').value.trim()));
    $('copy').disabled = true;
  }
  $('character-count').textContent = `${$('preview').value.length.toLocaleString()} characters`;
}
function renderSelection() { renderCommands(); renderStack(); renderContext(); updatePreview(); }

let saved = [];
let savingAvailable = true;
function workflowStatus(message, error=false) {
  $('workflow-status').textContent=message;
  $('workflow-status').classList.toggle('error',error);
}
function showSaved() {
  $('saved-workflows').replaceChildren(new Option(saved.length ? 'Choose a workflow' : 'No saved workflows',''));
  saved.forEach((r,i)=>$('saved-workflows').append(new Option(r.name,String(i))));
  $('load-workflow').disabled=true; $('delete-workflow').disabled=true;
}
function hasDraft() { return state.ids.length || $('material').value || $('goal').value || Object.values(state.context).some(Boolean); }
function resetDraft() {
  state.ids=[]; state.context={};
  for (const id of ['material','goal','search','category','workflow-name']) $(id).value='';
  renderSelection(); announce('');
}
for (const button of document.querySelectorAll('.help-toggle')) {
  button.addEventListener('click',()=>{
    const panel=$(button.getAttribute('aria-controls'));
    panel.hidden=!panel.hidden;
    button.setAttribute('aria-expanded',String(!panel.hidden));
  });
}
$('start-over').addEventListener('click',()=>{
  if (hasDraft() && !window.confirm('Clear your current commands, goal, material and context? Saved workflows will remain.')) return;
  resetDraft(); $('workspace-status').textContent='Workspace cleared. Saved workflows are unchanged.'; $('goal').focus();
});
$('try-example').addEventListener('click',()=>{
  if (hasDraft() && !window.confirm('Replace this draft with a fictional example? Unsaved inputs will be cleared.')) return;
  resetDraft(); state.ids=['specificity'];
  $('goal').value='Make this proposal actionable without inventing missing details.';
  $('material').value='We should replace customer onboarding calls with an automated checklist. We have not tested it or asked customers for feedback.';
  renderSelection(); $('workspace-status').textContent='Fictional example loaded. Edit it or copy the prompt to your AI tool.'; $('material').focus();
});
$('save-workflow').addEventListener('click',()=>{
  if (!savingAvailable) return;
  try {
    const r=recipe($('workflow-name').value,state.ids,state.commands);
    const existing=saved.findIndex(x=>x.name.toLowerCase()===r.name.toLowerCase());
    if (existing>=0 && !window.confirm('Replace the saved workflow “'+saved[existing].name+'”?')) return;
    const next=[...saved]; if(existing>=0) next[existing]=r; else next.push(r);
    saved=writeRecipes(window.localStorage,next,state.commands); showSaved();
    workflowStatus('Saved “'+r.name+'”. Only command choices and order were saved.');
  } catch(error) { workflowStatus('Could not save: '+error.message,true); }
});
$('saved-workflows').addEventListener('change',()=>{
  const empty=$('saved-workflows').value==='';
  $('load-workflow').disabled=empty; $('delete-workflow').disabled=empty;
});
$('load-workflow').addEventListener('click',()=>{
  const r=saved[Number($('saved-workflows').value)]; if (!r) return;
  if (hasDraft() && !window.confirm('Load “'+r.name+'” with fresh inputs? Your current material, goal and context will be cleared.')) return;
  resetDraft(); state.ids=r.steps.map(s=>s.id); $('workflow-name').value=r.name; renderSelection();
  workflowStatus('Loaded “'+r.name+'”. Add fresh material and context.'); $('material').focus();
});
$('delete-workflow').addEventListener('click',()=>{
  const index=Number($('saved-workflows').value); const r=saved[index]; if (!r) return;
  if (!window.confirm('Delete saved workflow “'+r.name+'”? Your current draft will stay.')) return;
  try { saved=writeRecipes(window.localStorage,saved.filter((_,i)=>i!==index),state.commands); showSaved(); workflowStatus('Workflow deleted.'); }
  catch(error) { workflowStatus('Could not delete: '+error.message,true); }
});

$('search').addEventListener('input', renderCommands);
$('category').addEventListener('change', renderCommands);
$('goal').addEventListener('input', updatePreview);
$('material').addEventListener('input', updatePreview);
$('copy').addEventListener('click', async () => {
  copying = true; $('copy').disabled = true;
  try {
    const copied = await copyPreview($('preview'), navigator.clipboard?.writeText?.bind(navigator.clipboard));
    $('copy-status').textContent = copied === $('preview').value ? 'Copied. Paste this prompt into your chosen AI tool.' : 'The previous preview was copied. Copy again for your latest changes.';
    $('copy-status').classList.remove('error');
  } catch {
    $('copy-status').textContent = 'Copy failed. Select the preview and use your keyboard’s copy shortcut.';
    $('copy-status').classList.add('error'); $('preview').focus(); $('preview').select();
  } finally { copying = false; $('copy').disabled = !$('preview').value; }
});
try {
  const resources = await loadResources(window.fetch.bind(window));
  state.commands = resources.commands; state.policy = resources.policy;
  $('workspace').hidden = false; $('load-status').hidden = true; renderSelection();
  try { saved=readRecipes(window.localStorage,state.commands); showSaved(); }
  catch { savingAvailable=false; $('save-workflow').disabled=true; workflowStatus('Saved workflows are unavailable in this browser, or contain incompatible data. Your existing storage has not been changed. You can still build and copy prompts.',true); }
} catch (error) {
  $('load-status').textContent = `${error.message} Reload this page to try again.`;
  $('load-status').classList.add('error');
}

// The hero uses the same tested example action as the workspace.
document.getElementById("hero-example").addEventListener("click", () => {
  document.getElementById("try-example").click();
  document.getElementById("goal-heading").scrollIntoView({block: "start"});
});
