import { moment } from 'obsidian';

export const DATE_FORMAT = 'YYYY-MM-DD';

export function todayString(): string {
	return moment().format(DATE_FORMAT);
}

export function addDays(date: string, days: number): string {
	return moment(date, DATE_FORMAT, true).add(days, 'days').format(DATE_FORMAT);
}

/** Parse a YYYY-MM-DD frontmatter value; tolerates a trailing time component. */
export function parseDate(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const m = moment(value.trim().slice(0, 10), DATE_FORMAT, true);
	return m.isValid() ? m.format(DATE_FORMAT) : null;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function dayDiff(from: string, to: string): number {
	return moment(to, DATE_FORMAT, true).diff(moment(from, DATE_FORMAT, true), 'days');
}
