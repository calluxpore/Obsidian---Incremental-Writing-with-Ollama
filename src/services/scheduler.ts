import { App, Notice, TFile } from 'obsidian';
import type { IncrementalWritingSettings } from '../settings';
import { DraftStatus, FM, isDraftStatus, QueueItem, ReviewGrade } from '../types';
import { addDays, dayDiff, parseDate, todayString } from '../utils/dates';
import { DailyNoteTasks } from './dailyNotes';

function parsePositiveNumber(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** Frontmatter written for a note entering the queue. */
export function initialFrontmatter(settings: IncrementalWritingSettings, status: DraftStatus = 'seed'): Record<string, string | number> {
	const today = todayString();
	return {
		[FM.status]: status,
		[FM.due]: addDays(today, settings.initialInterval),
		[FM.interval]: settings.initialInterval,
		[FM.lastReviewed]: today,
	};
}

/** Next interval for a grade; good/easy always grow by at least one day. */
export function nextInterval(current: number, grade: ReviewGrade, settings: IncrementalWritingSettings): number {
	const multiplier = {
		hard: settings.hardMultiplier,
		good: settings.goodMultiplier,
		easy: settings.easyMultiplier,
	}[grade];
	const floor = grade === 'hard' ? 1 : current + 1;
	const next = Math.max(floor, Math.round(current * multiplier));
	return Math.min(Math.max(1, settings.maxInterval), next);
}

/** Reads and writes the iw_* frontmatter that drives the writing queue. */
export class WritingQueue {
	readonly dailyTasks: DailyNoteTasks;

	constructor(
		private readonly app: App,
		private readonly getSettings: () => IncrementalWritingSettings,
	) {
		this.dailyTasks = new DailyNoteTasks(app, getSettings);
	}

	/**
	 * Keep daily-note review tasks in step with a schedule change. Failures are
	 * reported but never undo the frontmatter change that already happened.
	 */
	private async syncDailyTasks(steps: (() => Promise<void>)[]): Promise<void> {
		if (!this.dailyTasks.enabled) return;
		try {
			for (const step of steps) await step();
		} catch (err) {
			console.error('[incremental-writing]', err);
			new Notice('The note was rescheduled, but its daily note task could not be updated.');
		}
	}

	/** Write the review task for `file` into the daily note for `due`. */
	async scheduleTask(file: TFile, due: string): Promise<void> {
		await this.syncDailyTasks([() => this.dailyTasks.addReviewTask(file, due)]);
	}

	/** Build a queue item from cached metadata, or null if the note isn't in the queue. */
	itemFor(file: TFile, today = todayString()): QueueItem | null {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) return null;
		const status: unknown = fm[FM.status];
		if (!isDraftStatus(status)) return null;

		const due = parseDate(fm[FM.due]);
		return {
			file,
			status,
			due,
			interval: parsePositiveNumber(fm[FM.interval]) ?? this.getSettings().initialInterval,
			lastReviewed: parseDate(fm[FM.lastReviewed]),
			// Never-scheduled notes are treated as due today.
			daysOverdue: due ? dayDiff(due, today) : 0,
		};
	}

	/** All queued notes, most overdue first. */
	collect(): QueueItem[] {
		const today = todayString();
		const items: QueueItem[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const item = this.itemFor(file, today);
			if (item) items.push(item);
		}
		return items.sort(
			(a, b) => b.daysOverdue - a.daysOverdue || a.file.basename.localeCompare(b.file.basename),
		);
	}

	/** Apply a review grade: grow the interval, set the next due date, stamp the review. */
	async review(file: TFile, grade: ReviewGrade): Promise<{ interval: number; due: string }> {
		const settings = this.getSettings();
		const today = todayString();
		let result = { interval: settings.initialInterval, due: today };
		let previousDue: string | null = null;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			previousDue = parseDate(fm[FM.due]);
			const current = parsePositiveNumber(fm[FM.interval]) ?? settings.initialInterval;
			const interval = nextInterval(current, grade, settings);
			const due = addDays(today, interval);
			if (!isDraftStatus(fm[FM.status])) fm[FM.status] = 'seed';
			fm[FM.interval] = interval;
			fm[FM.due] = due;
			fm[FM.lastReviewed] = today;
			result = { interval, due };
		});
		const oldDue: string | null = previousDue;
		await this.syncDailyTasks([
			...(oldDue && oldDue !== result.due ? [() => this.dailyTasks.completeReviewTask(file, oldDue)] : []),
			() => this.dailyTasks.addReviewTask(file, result.due),
		]);
		return result;
	}

	async setStatus(file: TFile, status: DraftStatus): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[FM.status] = status;
		});
	}

	/**
	 * Take a note out of the queue by removing its scheduling properties.
	 * The note itself and its iw_parent link are left untouched.
	 */
	async dequeue(file: TFile): Promise<void> {
		let previousDue: string | null = null;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			previousDue = parseDate(fm[FM.due]);
			delete fm[FM.status];
			delete fm[FM.due];
			delete fm[FM.interval];
			delete fm[FM.lastReviewed];
		});
		const oldDue: string | null = previousDue;
		if (oldDue) await this.syncDailyTasks([() => this.dailyTasks.removeReviewTask(file, oldDue)]);
	}

	/** Add a note to the queue without overwriting existing iw_* values. Returns false if already queued. */
	async enqueue(file: TFile): Promise<boolean> {
		const defaults = initialFrontmatter(this.getSettings());
		let added = false;
		let due: string | null = null;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			added = !isDraftStatus(fm[FM.status]);
			for (const [key, value] of Object.entries(defaults)) {
				if (fm[key] === undefined || fm[key] === null || fm[key] === '') fm[key] = value;
			}
			if (!isDraftStatus(fm[FM.status])) fm[FM.status] = 'seed';
			due = parseDate(fm[FM.due]);
		});
		const newDue: string | null = due;
		if (newDue) await this.scheduleTask(file, newDue);
		return added;
	}
}
