import { MarkdownView, Notice, type Editor, type MarkdownFileInfo, type Menu } from 'obsidian';
import type IncrementalWritingPlugin from '../main';
import { bridgeDraftGaps } from './bridge';
import { extractTangent } from './extractTangent';
import { seedToOutline } from './outline';
import { socraticAdversary } from './socratic';
import { todayString } from '../utils/dates';

type EditorAction = (
	plugin: IncrementalWritingPlugin,
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo,
) => Promise<void>;

interface EditorCommandDef {
	id: string;
	name: string;
	icon: string;
	needsSelection: boolean;
	run: EditorAction;
}

const EDITOR_COMMANDS: EditorCommandDef[] = [
	{ id: 'socratic-adversary', name: 'Socratic adversary: critique draft or selection', icon: 'swords', needsSelection: false, run: socraticAdversary },
	{ id: 'bridge-draft-gaps', name: 'Bridge draft gaps between two passages', icon: 'git-merge', needsSelection: true, run: bridgeDraftGaps },
	{ id: 'seed-to-outline', name: 'Seed to outline scaffold', icon: 'list-tree', needsSelection: false, run: seedToOutline },
	{ id: 'extract-tangent', name: 'Extract tangent to child seed', icon: 'scissors', needsSelection: true, run: extractTangent },
];

function invoke(plugin: IncrementalWritingPlugin, def: EditorCommandDef, editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
	def.run(plugin, editor, info).catch((err: unknown) => {
		console.error('[incremental-writing]', err);
		new Notice(`${def.name} failed: ${err instanceof Error ? err.message : String(err)}`);
	});
}

export function registerCommands(plugin: IncrementalWritingPlugin): void {
	for (const def of EDITOR_COMMANDS) {
		plugin.addCommand({
			id: def.id,
			name: def.name,
			icon: def.icon,
			editorCheckCallback: (checking, editor, info) => {
				if (def.needsSelection && !editor.somethingSelected()) return false;
				if (!checking) invoke(plugin, def, editor, info);
				return true;
			},
		});
	}

	plugin.addCommand({
		id: 'open-writing-queue',
		name: 'Open writing queue',
		icon: 'list-checks',
		callback: () => void plugin.activateQueueView(),
	});

	plugin.addCommand({
		id: 'add-to-writing-queue',
		name: 'Add current note to writing queue',
		icon: 'sprout',
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!file || file.extension !== 'md') return false;
			if (!checking) {
				plugin.queue
					.enqueue(file)
					.then((added) =>
						new Notice(added ? `Added "${file.basename}" to the writing queue.` : `"${file.basename}" is already in the queue.`),
					)
					.catch((err: unknown) => {
						console.error('[incremental-writing]', err);
						new Notice('Could not update the note\'s properties.');
					});
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'remove-from-writing-queue',
		name: 'Remove current note from writing queue',
		icon: 'list-x',
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!file || !plugin.queue.itemFor(file)) return false;
			if (!checking) {
				plugin.queue
					.dequeue(file)
					.then(() => new Notice(`Removed "${file.basename}" from the writing queue.`))
					.catch((err: unknown) => {
						console.error('[incremental-writing]', err);
						new Notice('Could not update the note\'s properties.');
					});
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'sync-daily-note-tasks',
		name: 'Add review tasks to daily notes for all queued notes',
		icon: 'calendar-check',
		callback: async () => {
			if (!plugin.settings.dailyNoteTasks) {
				new Notice('Daily note tasks are turned off in settings.');
				return;
			}
			const today = todayString();
			const items = plugin.queue.collect();
			let count = 0;
			for (const item of items) {
				// Unscheduled or overdue notes get their task in today's daily note.
				const due = item.due && item.due > today ? item.due : today;
				await plugin.queue.scheduleTask(item.file, due);
				count++;
			}
			new Notice(`Checked review tasks for ${count} queued note${count === 1 ? '' : 's'}.`);
		},
	});

	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
			const hasSelection = editor.somethingSelected();
			menu.addSeparator();
			for (const def of EDITOR_COMMANDS) {
				if (def.needsSelection && !hasSelection) continue;
				menu.addItem((item) =>
					item
						.setTitle(def.name)
						.setIcon(def.icon)
						.setSection('incremental-writing')
						.onClick(() => invoke(plugin, def, editor, info)),
				);
			}
		}),
	);
}
