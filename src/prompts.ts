/**
 * Default prompt templates. Placeholders use {{name}} syntax and are filled by
 * `renderTemplate`. Unknown placeholders are left untouched.
 */

export const DEFAULT_SYSTEM_PROMPT =
	'You are a rigorous writing partner for a knowledge worker who develops ideas incrementally in Obsidian. ' +
	'Be concise, concrete, and direct. Never invent citations. Write in the same language as the draft. ' +
	'Do not use Obsidian comment markers (%%) in your output.';

export const DEFAULT_SOCRATIC_PROMPT = `Act as a Socratic adversary reviewing the draft below, titled "{{title}}".

Critique it for:
1. Logical gaps — unstated assumptions, leaps, circular reasoning.
2. Weak evidence — claims that need support, vague sources, overgeneralization.
3. Counterarguments — the strongest objections a thoughtful critic would raise.

Finish with 2–3 probing questions the author must answer to strengthen the piece.
Use short markdown bullet lists under bold labels. Keep it under 250 words.

DRAFT:
"""
{{text}}
"""`;

export const DEFAULT_BRIDGE_PROMPT = `Two consecutive passages from the note "{{title}}" feel disconnected.

PASSAGE A:
"""
{{before}}
"""

PASSAGE B:
"""
{{after}}
"""

Write 2 to 3 alternative transition sentences that could sit between A and B.
Each must be a single concise sentence (under 35 words) that makes the logical relationship explicit
(contrast, consequence, elaboration, example, etc.) and matches the author's tone.
Respond as JSON: {"transitions": ["...", "..."]}`;

export const DEFAULT_OUTLINE_PROMPT = `Expand the seed idea below into a 4-tier rhetorical skeleton for an essay.

The four tiers, in order, are:
1. Premise — the core claim, stated sharply.
2. Grounds — the evidence, examples, or mechanisms that support it.
3. Tension — the strongest counterarguments, limits, or complications.
4. Resolution — the synthesis, implications, or "so what".

For each tier give a short heading and 2–4 points. Each point is one sentence the author can later expand,
plus a short instruction describing what the author should research or write to develop it.

SEED (from note "{{title}}"):
"""
{{text}}
"""

Respond as JSON: {"title": "...", "tiers": [{"tier": "Premise", "heading": "...", "points": [{"text": "...", "todo": "..."}]}]}`;

/** Replace `{{key}}` placeholders with values from `vars`. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match: string, key: string) =>
		Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? '') : match,
	);
}
