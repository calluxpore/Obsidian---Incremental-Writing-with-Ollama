import type { TFile } from 'obsidian';

/** Lifecycle stage of a draft in the incremental writing queue. */
export type DraftStatus = 'seed' | 'draft' | 'evergreen';

export const DRAFT_STATUSES: readonly DraftStatus[] = ['seed', 'draft', 'evergreen'];

/** Frontmatter keys owned by this plugin. */
export const FM = {
	status: 'iw_status',
	due: 'iw_due',
	interval: 'iw_interval',
	lastReviewed: 'iw_last_reviewed',
	parent: 'iw_parent',
} as const;

/** Review grades offered in the queue view. */
export type ReviewGrade = 'hard' | 'good' | 'easy';

/** A normalized queue entry derived from a note's frontmatter. */
export interface QueueItem {
	file: TFile;
	status: DraftStatus;
	/** Due date as YYYY-MM-DD, or null when the note has never been scheduled. */
	due: string | null;
	interval: number;
	lastReviewed: string | null;
	/** Whole days overdue (negative = days until due). */
	daysOverdue: number;
}

/** A single chat message for the Ollama /api/chat endpoint. */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export function isDraftStatus(value: unknown): value is DraftStatus {
	return typeof value === 'string' && (DRAFT_STATUSES as readonly string[]).includes(value);
}
