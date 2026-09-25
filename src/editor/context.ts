import { Notice, type Editor, type MarkdownFileInfo, type MarkdownView, type TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { getEditorView } from './pendingInsert';

/** Snapshot of the text a command operates on, with document offsets. */
export interface EditorContext {
	view: EditorView;
	file: TFile | null;
	title: string;
	/** Selected text, or the whole body (minus frontmatter) when nothing is selected. */
	text: string;
	from: number;
	to: number;
	hasSelection: boolean;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export type Scope = 'selection-or-body' | 'selection-or-line' | 'selection';

/**
 * Resolve the working text for a command. Shows a notice and returns null
 * when the editor isn't CodeMirror 6 or the required selection is missing.
 */
export function readContext(editor: Editor, info: MarkdownView | MarkdownFileInfo, scope: Scope): EditorContext | null {
	const view = getEditorView(editor);
	if (!view) {
		new Notice('This command needs the Markdown editor (live preview or source mode).');
		return null;
	}
	const file = info.file ?? null;
	const title = file?.basename ?? 'Untitled';
	const { state } = view;
	const sel = state.selection.main;

	if (!sel.empty) {
		const text = state.sliceDoc(sel.from, sel.to);
		if (text.trim()) return { view, file, title, text, from: sel.from, to: sel.to, hasSelection: true };
	}

	if (scope === 'selection') {
		new Notice('Select some text first.');
		return null;
	}

	if (scope === 'selection-or-line') {
		const line = state.doc.lineAt(sel.head);
		if (!line.text.trim()) {
			new Notice('Select a fragment first, or click inside a line of text.');
			return null;
		}
		return { view, file, title, text: line.text, from: line.from, to: line.to, hasSelection: false };
	}

	const doc = state.doc.toString();
	const bodyStart = FRONTMATTER_RE.exec(doc)?.[0].length ?? 0;
	const text = doc.slice(bodyStart);
	if (!text.trim()) {
		new Notice('The note is empty.');
		return null;
	}
	return { view, file, title, text, from: bodyStart, to: doc.length, hasSelection: false };
}

/** Offset of the end of the line containing `pos`. */
export function lineEndAt(view: EditorView, pos: number): number {
	return view.state.doc.lineAt(pos).to;
}
