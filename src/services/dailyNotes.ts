import { App, moment, normalizePath, TFile, TFolder } from 'obsidian';
import type { IncrementalWritingSettings } from '../settings';
import { DATE_FORMAT, todayString } from '../utils/dates';

/** Tag that marks tasks written by this plugin, so they can be found again. */
export const REVIEW_TAG = '#iw-review';

interface DailyNoteConfig {
	folder: string;
	format: string;
	template: string;
}

const DEFAULT_DAILY_FORMAT = 'YYYY-MM-DD';
const TASK_RE = /^(\s*[-*+] \[)(.)(\].*)$/;
const EMPTY_TASK_RE = /^\s*[-*+] \[ \]\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
/** Template tokens understood by the core Daily notes plugin and the Calendar plugin. */
const DATE_TOKEN_RE = /{{\s*(date|time)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Writes a review task into the daily note for a note's next due date,
 * creating that daily note (from the core Daily notes template) when needed.
 */
export class DailyNoteTasks {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => IncrementalWritingSettings,
	) {}

	get enabled(): boolean {
		return this.getSettings().dailyNoteTasks;
	}

	/** Read folder, format and template from the core Daily notes plugin settings. */
	private async readConfig(): Promise<DailyNoteConfig> {
		const config: DailyNoteConfig = { folder: '', format: DEFAULT_DAILY_FORMAT, template: '' };
		const path = normalizePath(`${this.app.vault.configDir}/daily-notes.json`);
		try {
			if (!(await this.app.vault.adapter.exists(path))) return config;
			const raw: unknown = JSON.parse(await this.app.vault.adapter.read(path));
			if (typeof raw === 'object' && raw !== null) {
				const data = raw as Record<string, unknown>;
				if (typeof data.folder === 'string') config.folder = data.folder.trim();
				if (typeof data.format === 'string' && data.format.trim()) config.format = data.format.trim();
				if (typeof data.template === 'string') config.template = data.template.trim();
			}
		} catch (err) {
			console.error('[incremental-writing] Could not read daily note settings', err);
		}
		return config;
	}

	private pathFor(date: string, config: DailyNoteConfig): string {
		const name = moment(date, DATE_FORMAT, true).format(config.format);
		return normalizePath(config.folder ? `${config.folder}/${name}.md` : `${name}.md`);
	}

	private async findDailyNote(date: string): Promise<TFile | null> {
		const file = this.app.vault.getAbstractFileByPath(this.pathFor(date, await this.readConfig()));
		return file instanceof TFile ? file : null;
	}

	private async renderTemplate(config: DailyNoteConfig, date: string, title: string): Promise<string> {
		if (!config.template) return '';
		const templateFile =
			this.app.metadataCache.getFirstLinkpathDest(config.template, '') ??
			this.app.vault.getAbstractFileByPath(normalizePath(`${config.template}.md`));
		if (!(templateFile instanceof TFile)) return '';

		const content = await this.app.vault.cachedRead(templateFile);
		const now = moment();
		const base = moment(date, DATE_FORMAT, true).set({ hour: now.hour(), minute: now.minute(), second: now.second() });
		return content
			.replace(DATE_TOKEN_RE, (_match: string, kind: string, calc?: string, delta?: string, unit?: string, fmt?: string) => {
				const value = base.clone();
				if (calc && delta && unit) value.add(Number.parseInt(delta, 10), unit as moment.unitOfTime.DurationConstructor);
				const format = fmt ? fmt.substring(1).trim() : kind.toLowerCase() === 'time' ? 'HH:mm' : config.format;
				return value.format(format);
			})
			.replace(/{{\s*title\s*}}/gi, title)
			.replace(/{{\s*yesterday\s*}}/gi, base.clone().subtract(1, 'day').format(config.format))
			.replace(/{{\s*tomorrow\s*}}/gi, base.clone().add(1, 'day').format(config.format));
	}

	private async ensureFolder(path: string): Promise<void> {
		const folder = path.split('/').slice(0, -1).join('/');
		if (!folder || this.app.vault.getAbstractFileByPath(folder) instanceof TFolder) return;
		await this.app.vault.createFolder(folder);
	}

	private async getOrCreate(date: string): Promise<TFile> {
		const config = await this.readConfig();
		const path = this.pathFor(date, config);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		await this.ensureFolder(path);
		const title = path.split('/').pop()?.replace(/\.md$/, '') ?? date;
		return this.app.vault.create(path, await this.renderTemplate(config, date, title));
	}

	/** Does `line` hold this plugin's review task for `note`? */
	private matches(line: string, note: TFile, dailyPath: string): boolean {
		if (!TASK_RE.test(line) || !line.includes(REVIEW_TAG)) return false;
		const link = escapeRegExp(this.app.metadataCache.fileToLinktext(note, dailyPath, true));
		return new RegExp(`\\[\\[${link}(\\|[^\\]]*)?\\]\\]`).test(line);
	}

	/** Add "- [ ] Review [[note]] #iw-review 📅 date" to the daily note for `date`. */
	async addReviewTask(note: TFile, date: string): Promise<void> {
		if (!this.enabled) return;
		const daily = await this.getOrCreate(date);
		const link = this.app.metadataCache.fileToLinktext(note, daily.path, true);
		const task = `- [ ] Review [[${link}]] ${REVIEW_TAG} 📅 ${date}`;
		const heading = this.getSettings().dailyNoteHeading.trim();

		await this.app.vault.process(daily, (content) => {
			const lines = content.split('\n');
			const alreadyThere = lines.some(
				(line) => this.matches(line, note, daily.path) && TASK_RE.exec(line)?.[2] === ' ',
			);
			if (alreadyThere) return content;
			return insertUnderHeading(lines, heading, task).join('\n');
		});
	}

	/** Tick off the open review task for `note` in the daily note for `date`, if present. */
	async completeReviewTask(note: TFile, date: string): Promise<void> {
		if (!this.enabled) return;
		const daily = await this.findDailyNote(date);
		if (!daily) return;
		const done = todayString();
		await this.app.vault.process(daily, (content) =>
			content
				.split('\n')
				.map((line) => {
					const m = TASK_RE.exec(line);
					if (!m || m[2] !== ' ' || !this.matches(line, note, daily.path)) return line;
					return `${m[1] ?? ''}x${m[3] ?? ''} ✅ ${done}`;
				})
				.join('\n'),
		);
	}

	/** Remove the open review task for `note` from the daily note for `date`, if present. */
	async removeReviewTask(note: TFile, date: string): Promise<void> {
		if (!this.enabled) return;
		const daily = await this.findDailyNote(date);
		if (!daily) return;
		await this.app.vault.process(daily, (content) =>
			content
				.split('\n')
				.filter((line) => !(this.matches(line, note, daily.path) && TASK_RE.exec(line)?.[2] === ' '))
				.join('\n'),
		);
	}
}

/**
 * Insert `task` at the end of the section under `heading` (case-insensitive).
 * An empty "- [ ]" placeholder in that section is filled instead. Without the
 * heading, the section is appended to the end of the note.
 */
function insertUnderHeading(lines: string[], heading: string, task: string): string[] {
	const wanted = heading.replace(/^#+\s*/, '').toLowerCase();
	const start = wanted
		? lines.findIndex((line) => HEADING_RE.exec(line)?.[2]?.toLowerCase() === wanted)
		: -1;

	if (start === -1) {
		const out = [...lines];
		while (out.length > 0 && out[out.length - 1]?.trim() === '') out.pop();
		if (wanted) out.push('', `## ${heading.replace(/^#+\s*/, '')}`);
		else if (out.length > 0) out.push('');
		out.push(task, '');
		return out;
	}

	const level = HEADING_RE.exec(lines[start] ?? '')?.[1]?.length ?? 2;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const h = HEADING_RE.exec(lines[i] ?? '');
		if ((h && (h[1]?.length ?? 7) <= level) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i] ?? '')) {
			end = i;
			break;
		}
	}

	const out = [...lines];
	for (let i = start + 1; i < end; i++) {
		if (EMPTY_TASK_RE.test(out[i] ?? '')) {
			out[i] = task;
			return out;
		}
	}

	let insertAt = start + 1;
	for (let i = end - 1; i > start; i--) {
		if (out[i]?.trim()) {
			insertAt = i + 1;
			break;
		}
	}
	out.splice(insertAt, 0, task);
	return out;
}
