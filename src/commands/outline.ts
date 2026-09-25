import type { Editor, MarkdownFileInfo, MarkdownView } from 'obsidian';
import type IncrementalWritingPlugin from '../main';
import { lineEndAt, readContext } from '../editor/context';
import { renderTemplate } from '../prompts';
import { isRecord, neutralizeComments, oneLine, parseModelJson, runAiJob } from './aiRunner';

interface OutlinePoint {
	text: string;
	todo: string;
}

interface OutlineTier {
	tier: string;
	heading: string;
	points: OutlinePoint[];
}

const TIER_NAMES = ['Premise', 'Grounds', 'Tension', 'Resolution'] as const;
const ROMAN = ['I', 'II', 'III', 'IV'] as const;

export const OUTLINE_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string' },
		tiers: {
			type: 'array',
			minItems: 4,
			maxItems: 4,
			items: {
				type: 'object',
				properties: {
					tier: { type: 'string' },
					heading: { type: 'string' },
					points: {
						type: 'array',
						items: {
							type: 'object',
							properties: { text: { type: 'string' }, todo: { type: 'string' } },
							required: ['text', 'todo'],
						},
					},
				},
				required: ['tier', 'heading', 'points'],
			},
		},
	},
	required: ['title', 'tiers'],
};

export function parseOutline(reply: string): { title: string; tiers: OutlineTier[] } | null {
	const json = parseModelJson(reply);
	if (!isRecord(json) || !Array.isArray(json.tiers)) return null;
	const tiers: OutlineTier[] = json.tiers.filter(isRecord).map((t) => ({
		tier: oneLine(t.tier),
		heading: oneLine(t.heading),
		points: (Array.isArray(t.points) ? t.points : [])
			.map((p): OutlinePoint => (isRecord(p) ? { text: oneLine(p.text), todo: oneLine(p.todo) } : { text: oneLine(p), todo: '' }))
			.filter((p) => p.text.length > 0),
	}));
	if (tiers.length === 0) return null;
	return { title: oneLine(json.title), tiers: tiers.slice(0, 4) };
}

export function renderOutline(outline: { title: string; tiers: OutlineTier[] }): string {
	const lines: string[] = [];
	if (outline.title) lines.push(`## ${outline.title}`, '');
	outline.tiers.forEach((tier, i) => {
		const name = tier.tier || TIER_NAMES[i] || `Tier ${i + 1}`;
		const heading = tier.heading ? `${name}: ${tier.heading}` : name;
		lines.push(`### ${ROMAN[i] ?? i + 1}. ${heading}`);
		if (tier.points.length === 0) {
			lines.push(`- %% TODO: develop the ${name.toLowerCase()} %%`);
		}
		for (const point of tier.points) {
			lines.push(`- ${point.text}`);
			lines.push(`\t- %% TODO: ${point.todo || 'expand this point'} %%`);
		}
		lines.push('');
	});
	return neutralizeCommentsInText(lines.join('\n').trimEnd());
}

/** Neutralize %% inside model-provided strings while keeping our own TODO anchors intact. */
function neutralizeCommentsInText(markdown: string): string {
	return markdown
		.split('\n')
		.map((line) => {
			const anchor = /^(\s*- )%% TODO: ([\s\S]*) %%$/.exec(line);
			return anchor ? `${anchor[1] ?? ''}%% TODO: ${neutralizeComments(anchor[2] ?? '')} %%` : neutralizeComments(line);
		})
		.join('\n');
}

/**
 * Seed to outline scaffold: expand a fragment into a four-tier rhetorical
 * skeleton with %% TODO %% anchors, inserted below the seed (the seed is kept).
 */
export async function seedToOutline(
	plugin: IncrementalWritingPlugin,
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo,
): Promise<void> {
	const ctx = readContext(editor, info, 'selection-or-line');
	if (!ctx) return;

	await runAiJob(plugin, {
		view: ctx.view,
		insertAt: lineEndAt(ctx.view, ctx.to),
		label: ' Scaffolding outline…',
		prompt: renderTemplate(plugin.settings.outlinePrompt, { title: ctx.title, text: ctx.text }),
		format: OUTLINE_SCHEMA,
		render: (reply) => {
			const outline = parseOutline(reply);
			// Fall back to the raw reply so a malformed JSON answer isn't lost.
			const body = outline
				? renderOutline(outline)
				: `${neutralizeComments(reply)}\n\n%% TODO: the model did not return a structured outline; restructure this %%`;
			return `\n\n${body}\n`;
		},
	});
}
