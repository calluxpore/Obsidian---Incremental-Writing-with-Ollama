import { Notice, type Editor, type MarkdownFileInfo, type MarkdownView } from 'obsidian';
import type IncrementalWritingPlugin from '../main';
import { readContext } from '../editor/context';
import { renderTemplate } from '../prompts';
import { isRecord, neutralizeComments, oneLine, parseModelJson, runAiJob } from './aiRunner';

interface Block {
	text: string;
	/** Offsets relative to the start of the selection. */
	start: number;
	end: number;
}

export const TRANSITIONS_SCHEMA = {
	type: 'object',
	properties: {
		transitions: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
	},
	required: ['transitions'],
};

const LIST_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)/;

/** Split text on a separator regex, keeping each non-empty chunk's offsets. */
function splitWithOffsets(text: string, separator: RegExp): Block[] {
	const blocks: Block[] = [];
	let cursor = 0;
	const push = (start: number, end: number): void => {
		const raw = text.slice(start, end);
		if (!raw.trim()) return;
		const lead = raw.length - raw.trimStart().length;
		const trail = raw.length - raw.trimEnd().length;
		blocks.push({ text: raw.trim(), start: start + lead, end: end - trail });
	};
	for (const match of text.matchAll(separator)) {
		const index = match.index ?? 0;
		push(cursor, index);
		cursor = index + match[0].length;
	}
	push(cursor, text.length);
	return blocks;
}

/** Find two passages: two paragraphs (blank-line separated) or two lines/bullets. */
export function findTwoBlocks(text: string): { blocks: [Block, Block]; mode: 'paragraph' | 'line' } | null {
	const paragraphs = splitWithOffsets(text, /\r?\n[ \t]*\r?\n\s*/g);
	if (paragraphs.length === 2 && paragraphs[0] && paragraphs[1]) {
		return { blocks: [paragraphs[0], paragraphs[1]], mode: 'paragraph' };
	}
	const lines = splitWithOffsets(text, /\r?\n/g);
	if (lines.length === 2 && lines[0] && lines[1]) {
		return { blocks: [lines[0], lines[1]], mode: 'line' };
	}
	return null;
}

export function parseTransitions(reply: string): string[] {
	const json = parseModelJson(reply);
	let items: unknown[] = [];
	if (isRecord(json) && Array.isArray(json.transitions)) items = json.transitions;
	else if (Array.isArray(json)) items = json;
	else items = reply.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, ''));
	return items
		.map(oneLine)
		.map((t) => t.replace(/^["“]|["”]$/g, ''))
		.filter((t) => t.length > 0)
		.slice(0, 3);
}

/**
 * Bridge draft gaps: generate 2–3 transition sentences between two selected
 * passages and insert them between the passages.
 */
export async function bridgeDraftGaps(
	plugin: IncrementalWritingPlugin,
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo,
): Promise<void> {
	const ctx = readContext(editor, info, 'selection');
	if (!ctx) return;

	const found = findTwoBlocks(ctx.text);
	if (!found) {
		new Notice('Select exactly two paragraphs, or two lines or bullet points.');
		return;
	}
	const [a, b] = found.blocks;
	const sep = found.mode === 'paragraph' ? '\n\n' : '\n';
	const aLine = ctx.view.state.doc.lineAt(ctx.from + a.start);
	const listPrefix = found.mode === 'line' ? (LIST_PREFIX_RE.exec(aLine.text)?.[1] ?? '') : '';
	const indent = found.mode === 'line' ? (/^\s*/.exec(aLine.text)?.[0] ?? '') : '';
	const mode = plugin.settings.bridgeInsertMode;

	await runAiJob(plugin, {
		view: ctx.view,
		insertAt: ctx.from + a.end,
		label: ' Bridging…',
		prompt: renderTemplate(plugin.settings.bridgePrompt, { title: ctx.title, before: a.text, after: b.text }),
		format: TRANSITIONS_SCHEMA,
		render: (reply) => {
			const transitions = parseTransitions(reply).map(neutralizeComments);
			if (transitions.length === 0) return null;
			const options = transitions.map((t) => `${indent}- ${t}`).join('\n');

			if (mode === 'comment') {
				return `${sep}${indent}%% AI Bridge options:\n${options}\n${indent}%%`;
			}
			const [first, ...rest] = transitions;
			const visible = found.mode === 'line' ? `${listPrefix || `${indent}- `}${first ?? ''}` : (first ?? '');
			const alternatives = rest.length
				? `\n${indent}%% AI Bridge alternatives:\n${rest.map((t) => `${indent}- ${t}`).join('\n')}\n${indent}%%`
				: '';
			return `${sep}${visible}${alternatives}`;
		},
	});
}
