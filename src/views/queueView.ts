import {
	ButtonComponent,
	debounce,
	DropdownComponent,
	ItemView,
	Keymap,
	Notice,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import type IncrementalWritingPlugin from '../main';
import { nextInterval } from '../services/scheduler';
import { DRAFT_STATUSES, isDraftStatus, QueueItem, ReviewGrade } from '../types';

export const VIEW_TYPE_QUEUE = 'incremental-writing-queue';

const GRADES: { grade: ReviewGrade; label: string }[] = [
	{ grade: 'hard', label: 'Hard' },
	{ grade: 'good', label: 'Good' },
	{ grade: 'easy', label: 'Easy' },
];

function describeDue(item: QueueItem): string {
	if (!item.due) return 'Unscheduled';
	const d = item.daysOverdue;
	if (d === 0) return 'Due today';
	if (d > 0) return d === 1 ? '1 day overdue' : `${d} days overdue`;
	return -d === 1 ? 'Due tomorrow' : `Due in ${-d} days`;
}

/** Sidebar view listing drafts that are due, with one-click rescheduling. */
export class WritingQueueView extends ItemView {
	private readonly plugin: IncrementalWritingPlugin;
	private readonly requestRefresh = debounce(() => this.render(), 300, true);

	constructor(leaf: WorkspaceLeaf, plugin: IncrementalWritingPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_QUEUE;
	}

	getDisplayText(): string {
		return 'Writing queue';
	}

	getIcon(): string {
		return 'list-checks';
	}

	async onOpen(): Promise<void> {
		const { metadataCache, vault } = this.app;
		this.registerEvent(metadataCache.on('changed', () => this.requestRefresh()));
		this.registerEvent(metadataCache.on('resolved', () => this.requestRefresh()));
		this.registerEvent(vault.on('delete', () => this.requestRefresh()));
		this.registerEvent(vault.on('rename', () => this.requestRefresh()));
		// Pick up the date rollover when Obsidian stays open past midnight.
		this.registerInterval(window.setInterval(() => this.requestRefresh(), 15 * 60 * 1000));
		this.render();
	}

	async onClose(): Promise<void> {
		this.requestRefresh.cancel();
		this.contentEl.empty();
	}

	/** Re-render immediately (called when settings change). */
	refresh(): void {
		this.render();
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass('iw-queue');

		const items = this.plugin.queue.collect();
		const due = items.filter((i) => i.daysOverdue >= 0);
		const horizon = this.plugin.settings.upcomingDays;
		const upcoming = items.filter((i) => i.daysOverdue < 0 && -i.daysOverdue <= horizon).reverse();

		const header = container.createDiv({ cls: 'iw-queue-header' });
		header.createEl('h4', { text: 'Writing queue' });
		header.createSpan({ cls: 'iw-queue-count', text: `${due.length} due · ${items.length} total` });
		const refresh = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Refresh' } });
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => this.render());

		this.renderSection(container, 'Due', due, 'Nothing due. Add a note with the "Add current note to writing queue" command.');
		if (horizon > 0) {
			this.renderSection(container, `Upcoming (${horizon} days)`, upcoming, 'Nothing scheduled in this window.');
		}
	}

	private renderSection(parent: HTMLElement, title: string, items: QueueItem[], emptyText: string): void {
		const section = parent.createDiv({ cls: 'iw-queue-section' });
		section.createEl('h5', { text: title });
		if (items.length === 0) {
			section.createDiv({ cls: 'iw-queue-empty', text: emptyText });
			return;
		}
		const list = section.createDiv({ cls: 'iw-queue-list' });
		for (const item of items) this.renderItem(list, item);
	}

	private renderItem(list: HTMLElement, item: QueueItem): void {
		const card = list.createDiv({ cls: 'iw-queue-item' });
		if (item.daysOverdue > 0) card.addClass('is-overdue');

		const title = card.createEl('a', { cls: 'iw-queue-title', text: item.file.basename, href: '#' });
		title.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.openFile(item.file, Keymap.isModEvent(evt) !== false);
		});

		const meta = card.createDiv({ cls: 'iw-queue-meta' });
		new DropdownComponent(meta)
			.addOptions(Object.fromEntries(DRAFT_STATUSES.map((s) => [s, s])))
			.setValue(item.status)
			.onChange(async (value) => {
				if (isDraftStatus(value)) await this.plugin.queue.setStatus(item.file, value);
			})
			.selectEl.addClass('iw-status', `iw-status-${item.status}`);
		meta.createSpan({ cls: 'iw-queue-due', text: describeDue(item) });
		meta.createSpan({ cls: 'iw-queue-interval', text: `Every ${item.interval}d` });

		const actions = card.createDiv({ cls: 'iw-queue-actions' });
		new ButtonComponent(actions)
			.setIcon('file-text')
			.setTooltip('Open note')
			.onClick(() => void this.openFile(item.file, false));

		const buttons: ButtonComponent[] = [];
		for (const { grade, label } of GRADES) {
			const next = nextInterval(item.interval, grade, this.plugin.settings);
			const button = new ButtonComponent(actions)
				.setButtonText(`${label} · ${next}d`)
				.setTooltip(`Mark reviewed, next review in ${next} day${next === 1 ? '' : 's'}`)
				.onClick(() => void this.grade(item, grade, buttons));
			button.buttonEl.addClass(`iw-grade-${grade}`);
			buttons.push(button);
		}

		const remove = new ButtonComponent(actions)
			.setIcon('x')
			.setTooltip('Remove from queue (keeps the note)')
			.onClick(() => void this.remove(item, [...buttons, remove]));
		remove.buttonEl.addClass('iw-queue-remove');
	}

	private async remove(item: QueueItem, buttons: ButtonComponent[]): Promise<void> {
		for (const b of buttons) b.setDisabled(true);
		try {
			await this.plugin.queue.dequeue(item.file);
			new Notice(`Removed "${item.file.basename}" from the writing queue.`);
		} catch (err) {
			console.error('[incremental-writing]', err);
			new Notice(`Could not remove ${item.file.basename} from the queue.`);
			for (const b of buttons) b.setDisabled(false);
		}
	}

	private async grade(item: QueueItem, grade: ReviewGrade, buttons: ButtonComponent[]): Promise<void> {
		for (const b of buttons) b.setDisabled(true);
		try {
			const result = await this.plugin.queue.review(item.file, grade);
			new Notice(`${item.file.basename}: next review ${result.due} (${result.interval}d).`);
		} catch (err) {
			console.error('[incremental-writing]', err);
			new Notice(`Could not reschedule ${item.file.basename}.`);
			for (const b of buttons) b.setDisabled(false);
		}
	}

	private async openFile(file: TFile, newTab: boolean): Promise<void> {
		const leaf = this.app.workspace.getLeaf(newTab ? 'tab' : false);
		await leaf.openFile(file);
	}
}
