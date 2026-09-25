import { Notice } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type IncrementalWritingPlugin from '../main';
import { reserveInsert } from '../editor/pendingInsert';
import type { OllamaFormat } from '../services/ollama';

export interface AiJob {
	view: EditorView;
	/** Where the result will be inserted (mapped through concurrent edits). */
	insertAt: number;
	/** Label for the in-editor progress marker. */
	label: string;
	prompt: string;
	format?: OllamaFormat;
	/** Turn the raw model reply into the text to insert, or null to abort. */
	render: (reply: string) => string | null;
}

/**
 * Shared pipeline for AI commands: reserve an anchor, call Ollama, render,
 * and insert non-destructively. If the editor was closed meanwhile, the result
 * is copied to the clipboard instead of being lost.
 */
export async function runAiJob(plugin: IncrementalWritingPlugin, job: AiJob): Promise<void> {
	const pending = reserveInsert(job.view, job.insertAt, job.label);
	let inserted = false;
	try {
		const reply = await plugin.ollama.chat(
			[
				{ role: 'system', content: plugin.settings.systemPrompt },
				{ role: 'user', content: job.prompt },
			],
			{ format: job.format },
		);
		if (reply === null) return;

		const text = job.render(reply);
		if (text === null) {
			new Notice('The model returned an unusable response. Try again.');
			return;
		}
		inserted = pending.commit(text);
		if (!inserted) {
			await navigator.clipboard.writeText(text);
			new Notice('The editor closed before the response arrived. The result was copied to the clipboard.');
		}
	} finally {
		if (!inserted) pending.cancel();
	}
}

/** Remove Obsidian comment delimiters so model output can't break out of a %% block. */
export function neutralizeComments(text: string): string {
	return text.replace(/%%/g, '%');
}

/** Strip a surrounding ``` fence that some models add around JSON. */
function stripFence(text: string): string {
	const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
	return match?.[1] ?? text.trim();
}

/** Parse JSON from a model reply, returning null on failure. */
export function parseModelJson(text: string): unknown {
	try {
		return JSON.parse(stripFence(text)) as unknown;
	} catch {
		return null;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collapse a model string to a single trimmed line. */
export function oneLine(value: unknown): string {
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
