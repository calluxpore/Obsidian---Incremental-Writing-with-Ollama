import {
	normalizePath,
	Notice,
	stringifyYaml,
	TFile,
	TFolder,
	type Editor,
	type MarkdownFileInfo,
	type MarkdownView,
} from 'obsidian';
import type IncrementalWritingPlugin from '../main';
import { readContext } from '../editor/context';
import { initialFrontmatter } from '../services/scheduler';
import { FM } from '../types';
import { promptForTitle } from '../ui/titleModal';

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

function sanitizeTitle(raw: string): string {
	return raw.replace(ILLEGAL_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, 100).trim();
}

/** Suggest a title from the first meaningful words of the selection. */
function suggestTitle(text: string): string {
	const firstLine = text
		.split(/\r?\n/)
		.map((l) => l.replace(/^\s*(?:#+|[-*+>]|\d+[.)])\s*/, '').trim())
		.find((l) => l.length > 0);
	const words = sanitizeTitle(firstLine ?? '').split(' ').slice(0, 8).join(' ');
	return words || 'Tangent';
}

async function ensureFolder(plugin: IncrementalWritingPlugin, path: string): Promise<void> {
	if (!path || path === '/') return;
	const existing = plugin.app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	if (existing) throw new Error(`"${path}" exists and is not a folder.`);
	await plugin.app.vault.createFolder(path);
}

function availablePath(plugin: IncrementalWritingPlugin, folder: string, title: string): string {
	const prefix = folder && folder !== '/' ? `${folder}/` : '';
	for (let n = 0; ; n++) {
		const candidate = normalizePath(`${prefix}${title}${n === 0 ? '' : ` ${n}`}.md`);
		if (!plugin.app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
}

/**
 * Extract tangent to child seed: move the selection into a new note that
 * enters the writing queue as a seed, and leave an embed (![[child]]) behind.
 */
export async function extractTangent(
	plugin: IncrementalWritingPlugin,
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo,
): Promise<void> {
	const ctx = readContext(editor, info, 'selection');
	if (!ctx) return;
	const parent = ctx.file;
	if (!parent) {
		new Notice('Save this note before extracting a tangent.');
		return;
	}

	const rawTitle = await promptForTitle(plugin.app, 'Extract tangent to child seed', suggestTitle(ctx.text));
	if (rawTitle === null) return;
	const title = sanitizeTitle(rawTitle);
	if (!title) {
		new Notice('That title has no valid filename characters.');
		return;
	}

	const { app } = plugin;
	const folder = normalizePath(plugin.settings.childNoteFolder || parent.parent?.path || '/');
	const frontmatter: Record<string, string | number> = {
		...initialFrontmatter(plugin.settings, 'seed'),
		[FM.parent]: `[[${app.metadataCache.fileToLinktext(parent, '', true)}]]`,
	};
	const content = `---\n${stringifyYaml(frontmatter)}---\n\n${ctx.text.trim()}\n`;

	let child: TFile;
	try {
		await ensureFolder(plugin, folder);
		child = await app.vault.create(availablePath(plugin, folder, title), content);
	} catch (err) {
		console.error('[incremental-writing]', err);
		new Notice(`Could not create the child note: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	const childDue = frontmatter[FM.due];
	if (typeof childDue === 'string') await plugin.queue.scheduleTask(child, childDue);

	// The document may have changed while the modal was open; only replace if the text is still there.
	const { view } = ctx;
	if (!view.dom.isConnected || view.state.sliceDoc(ctx.from, ctx.to) !== ctx.text) {
		new Notice(`Created "${child.basename}", but the selection changed, so it was left in place.`);
		return;
	}

	const link = app.metadataCache.fileToLinktext(child, parent.path, true);
	view.dispatch({
		changes: { from: ctx.from, to: ctx.to, insert: `![[${link}]]` },
		selection: { anchor: ctx.from + link.length + 5 },
		userEvent: 'input.extract',
		scrollIntoView: true,
	});
	new Notice(`Extracted to "${child.basename}" and added it to the writing queue.`);
}
