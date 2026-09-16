// Pure compiler and state operations shared by the UI and offline tests.
export const IDS = Object.freeze(['eli10', 'human', 'redteam', 'verify', 'audit', 'specificity', 'firstprinciples', 'contrastmode', 'guidedquestions', 'quizme']);
const NAMES = ['ELI10', '/human', 'REDTEAM', '/VERIFY', '/AUDIT', 'Specificity', 'First Principles', 'Compare', 'Guided Questions', 'Quiz Me'];
export const CONTEXT_ORDER = Object.freeze(['audience', 'tone', 'constraints', 'criteria', 'evidence', 'as_of_date']);
const OPTIONAL = new Set([...CONTEXT_ORDER, 'goal']);
const POLICY_KEYS = ['title', 'data_policy', 'evidence_policy', 'flow_policy', 'output_transform', 'output_reviews', 'output_review_only', 'output_no_execution_claim', 'output_interactive'];

export function validateCommands(records) {
  if (!Array.isArray(records) || records.length !== IDS.length) throw new Error('The ten command records could not be loaded.');
  return IDS.map((id, index) => {
    const matches = records.filter(c => c?.id === id);
    const c = matches[0];
    if (matches.length !== 1 || c.version !== '0.2.0' || c.name !== NAMES[index] || c.schema_version !== '1.0.0') throw new Error(`The pinned ${NAMES[index]} record is missing or invalid.`);
    for (const key of ['expanded_instruction', 'product_interpretation', 'changes', 'preserves']) {
      if (typeof c[key] !== 'string' || !c[key].trim()) throw new Error(`${c.name} is missing ${key}.`);
    }
    if (c.testing?.status !== 'untested' || c.status !== 'draft') throw new Error(`${c.name} must retain its draft, untested label.`);
    if (c.origin !== (['verify', 'audit'].includes(id) ? 'david_specific' : 'sabrina_derived')) throw new Error(`${c.name} has unexpected provenance.`);
    if (!Array.isArray(c.inputs?.required) || c.inputs.required.length !== 1 || c.inputs.required[0] !== 'material' || !Array.isArray(c.inputs.optional) || c.inputs.optional.some(x => !OPTIONAL.has(x))) throw new Error(`${c.name} has unsupported input fields.`);
    const role = ['guidedquestions','quizme'].includes(id) ? 'interactive' : ['eli10','human','specificity'].includes(id) ? 'transform' : 'review';
    if (c.stack?.role !== role || c.stack.consumes !== 'working_material' || c.stack.output !== (role === 'interactive' ? 'conversation_turn' : role === 'transform' ? 'transformed_material' : 'review_report') || !Array.isArray(c.stack.compatible_with) || c.stack.compatible_with.some(x => !IDS.includes(x) || x === id)) throw new Error(`${c.name} has an invalid workflow definition.`);
    return c;
  });
}

export function validatePolicy(policy) {
  if (policy?.version !== '1.1.0' || POLICY_KEYS.some(k => typeof policy[k] !== 'string' || !policy[k].trim())) throw new Error('The prompt assembly policy could not be loaded.');
  return policy;
}

export async function loadResources(fetcher) {
  const responses = await Promise.all([fetcher('./commands.json'), fetcher('./prompts/compiler-policy-1.1.0.json')]);
  if (responses.some(r => !r.ok)) throw new Error('Unable to load command files. Reload the page and try again.');
  const [records, policy] = await Promise.all(responses.map(r => r.json()));
  return {commands: validateCommands(records), policy: validatePolicy(policy)};
}

export function validateStack(ids, commands, requireSelection = true) {
  if (!Array.isArray(ids) || ids.length > 5) throw new Error('Choose no more than five steps.');
  if (requireSelection && ids.length === 0) throw new Error('Choose at least one command.');
  if (new Set(ids).size !== ids.length) throw new Error('Each command can appear only once.');
  const chosen = ids.map(id => {
    const command = commands.find(c => c.id === id);
    if (!command || command.version !== '0.2.0') throw new Error('Choose a supported command version.');
    return command;
  });
  if (chosen.length > 1 && chosen.some(c => c.stack.role === 'interactive')) throw new Error('Guided Questions and Quiz Me run on their own. Use either one by itself, or remove it before adding other commands.');
  for (const a of chosen) for (const b of chosen) {
    if (a !== b && (!a.stack.compatible_with.includes(b.id) || !b.stack.compatible_with.includes(a.id))) throw new Error(`${a.name} and ${b.name} cannot be combined.`);
  }
  return chosen;
}

export function addStep(ids, id, commands) {
  const next = [...ids, id]; validateStack(next, commands); return next;
}
export function moveStep(ids, index, offset) {
  const target = index + offset;
  if (![1, -1].includes(offset) || index < 0 || index >= ids.length || target < 0 || target >= ids.length) throw new Error('That step cannot move further.');
  const next = [...ids]; [next[index], next[target]] = [next[target], next[index]]; return next;
}
export function relevantFields(chosen) {
  return CONTEXT_ORDER.filter(key => chosen.some(c => c.inputs.optional.includes(key)));
}
export function retainRelevantContext(context, chosen) {
  const fields = new Set(relevantFields(chosen));
  return Object.fromEntries(Object.entries(context).filter(([key]) => fields.has(key)));
}
export function searchCommands(commands, query) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return commands.filter(c => words.every(word => `${c.name} ${c.product_interpretation} ${c.changes} ${c.preserves} ${c.inputs.optional.join(' ')}`.toLocaleLowerCase().includes(word)));
}
export function dataFlow(chosen) {
  let target = 'original material';
  return chosen.map((c, i) => {
    const input = target;
    if (c.stack.role === 'transform') target = `material from step ${i + 1} (${c.name})`;
    return {step: i + 1, id: c.id, name: c.name, role: c.stack.role, input, output: c.stack.role === 'interactive' ? 'one question, then wait for your answer' : c.stack.role === 'transform' ? target : `review report ${i + 1}`, replacesMaterial: c.stack.role === 'transform'};
  });
}
// Escaping '<' and '>' means no supplied text can terminate XML-like boundaries.
// JSON escaping also preserves literal backslashes, newlines and Unicode on decode.
export function encodeData(data) {
  return JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export function compilePrompt({commands, policy, ids, material, goal = '', context = {}}) {
  const chosen = validateStack(ids, commands);
  validatePolicy(policy);
  if (typeof material !== 'string' || !material.trim()) throw new Error('Add working material to build your prompt.');
  if (typeof goal !== 'string') throw new Error('Goal must be text.');
  const fields = relevantFields(chosen);
  const optional = {};
  for (const key of fields) {
    const value = context[key] ?? '';
    if (typeof value !== 'string') throw new Error(`${key} must be text.`);
    optional[key] = value.trim() ? value : null;
  }
  const data = {goal: goal.trim() ? goal : null, material, context: optional};
  const flow = dataFlow(chosen);
  const lines = [policy.title, `Compiler policy: ${policy.version}`, '', '<WORKFLOW_RULES>', policy.data_policy, policy.evidence_policy, policy.flow_policy, '</WORKFLOW_RULES>', '', '<ORDERED_STEPS>'];
  chosen.forEach((c, i) => {
    lines.push(`<STEP number="${i + 1}" command="${c.name}" version="${c.version}" role="${c.stack.role}">`, c.expanded_instruction, '</STEP>');
  });
  lines.push('</ORDERED_STEPS>', '', '<DATA_FLOW>');
  flow.forEach(f => lines.push(`${f.step}. ${f.name}: ${f.input} → ${f.output}. ${f.replacesMaterial ? 'Replaces working material.' : 'Working material stays unchanged.'}`));
  lines.push('</DATA_FLOW>', '', '<INPUT_DATA format="json">', encodeData(data), '</INPUT_DATA>', '', '<OUTPUT_REQUIREMENTS>');
  if (chosen.some(c => c.stack.role === 'interactive')) lines.push(policy.output_interactive);
  else if (chosen.some(c => c.stack.role === 'transform')) lines.push(policy.output_transform);
  else lines.push(policy.output_review_only);
  if (chosen.some(c => c.stack.role === 'review')) lines.push(policy.output_reviews);
  lines.push(policy.output_no_execution_claim, '</OUTPUT_REQUIREMENTS>');
  return lines.join('\n');
}
export async function copyPreview(preview, writer) {
  const text = preview.value;
  if (!text) throw new Error('Build a complete prompt before copying.');
  if (typeof writer !== 'function') throw new Error('Clipboard access is unavailable. Select the preview and copy it manually.');
  await writer(text);
  return text;
}
