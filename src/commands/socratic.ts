import type { Editor, MarkdownFileInfo, MarkdownView } from 'obsidian';
import type IncrementalWritingPlugin from '../main';
import { lineEndAt, readContext } from '../editor/context';
import { renderTemplate } from '../prompts';
import { neutralizeComments, runAiJob } from './aiRunner';

/**
 * Socratic adversary: critique the selection (or whole draft) and insert the
 * critique as a hidden %% AI Critique %% block below it.
 */
export async function socraticAdversary(
	plugin: IncrementalWritingPlugin,
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo,
): Promise<void> {
	const ctx = readContext(editor, info, 'selection-or-body');
	if (!ctx) return;

	const insertAt = ctx.hasSelection ? lineEndAt(ctx.view, ctx.to) : ctx.view.state.doc.length;

	await runAiJob(plugin, {
		view: ctx.view,
		insertAt,
		label: ' Socratic adversary is reading…',
		prompt: renderTemplate(plugin.settings.socraticPrompt, { title: ctx.title, text: ctx.text }),
		render: (reply) => `\n\n%% AI Critique:\n${neutralizeComments(reply)}\n%%\n`,
	});
}
