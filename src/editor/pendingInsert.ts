import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import type { Editor } from 'obsidian';

/**
 * Tracks insertion points for slow AI requests. Each pending request gets a
 * widget decoration; CodeMirror maps it through every edit the user makes while
 * waiting, so the final insertion lands at the right place without ever
 * overwriting text the user typed in the meantime.
 */

class PendingWidget extends WidgetType {
	constructor(
		readonly id: string,
		readonly label: string,
	) {
		super();
	}

	eq(other: PendingWidget): boolean {
		return other.id === this.id;
	}

	toDOM(): HTMLElement {
		return createSpan({ cls: 'iw-pending', text: this.label });
	}

	ignoreEvent(): boolean {
		return true;
	}
}

function specId(deco: Decoration): string | undefined {
	const spec = deco.spec as { id?: unknown };
	return typeof spec.id === 'string' ? spec.id : undefined;
}

const addPending = StateEffect.define<{ id: string; pos: number; label: string }>({
	map: (value, mapping) => ({ ...value, pos: mapping.mapPos(value.pos, 1) }),
});
const removePending = StateEffect.define<string>();

const pendingField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(set, tr) {
		let next = set.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(addPending)) {
				const widget = Decoration.widget({
					widget: new PendingWidget(effect.value.id, effect.value.label),
					side: 1,
					id: effect.value.id,
				});
				next = next.update({ add: [widget.range(effect.value.pos)] });
			} else if (effect.is(removePending)) {
				const id = effect.value;
				next = next.update({ filter: (_from, _to, deco) => specId(deco) !== id });
			}
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

/** Editor extension to register via `plugin.registerEditorExtension`. */
export const pendingInsertExtension: Extension = pendingField;

/** Obtain the CodeMirror 6 view backing an Obsidian editor. */
export function getEditorView(editor: Editor): EditorView | null {
	const cm: unknown = (editor as unknown as { cm?: unknown }).cm;
	return cm instanceof EditorView ? cm : null;
}

function findPendingPos(view: EditorView, id: string): number | null {
	const set = view.state.field(pendingField, false);
	if (!set) return null;
	let found: number | null = null;
	set.between(0, view.state.doc.length, (from, _to, deco) => {
		if (specId(deco) === id) {
			found = from;
			return false;
		}
		return undefined;
	});
	return found;
}

let counter = 0;

/** Handle for a reserved insertion point. */
export interface PendingInsert {
	/** Insert text at the (mapped) anchor. Returns false if the editor went away. */
	commit(text: string): boolean;
	/** Remove the placeholder without inserting anything. */
	cancel(): void;
}

/** Place a "thinking" marker at `pos` and return a handle to fill it later. */
export function reserveInsert(view: EditorView, pos: number, label: string): PendingInsert {
	const id = `iw-pending-${Date.now()}-${counter++}`;
	view.dispatch({ effects: addPending.of({ id, pos, label }) });

	const alive = (): boolean => view.dom.isConnected && view.state.field(pendingField, false) !== undefined;

	return {
		commit(text: string): boolean {
			if (!alive()) return false;
			const at = findPendingPos(view, id);
			if (at === null) return false;
			view.dispatch({
				changes: { from: at, to: at, insert: text },
				effects: removePending.of(id),
				userEvent: 'input.ai',
				scrollIntoView: true,
			});
			return true;
		},
		cancel(): void {
			if (alive()) view.dispatch({ effects: removePending.of(id) });
		},
	};
}

/** Insert text at a position in a single, undoable transaction. */
export function insertAt(view: EditorView, pos: number, text: string): void {
	view.dispatch({
		changes: { from: pos, to: pos, insert: text },
		userEvent: 'input.ai',
		scrollIntoView: true,
	});
}
