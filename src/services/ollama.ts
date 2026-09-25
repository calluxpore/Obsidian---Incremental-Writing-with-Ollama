import { Notice, requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { IncrementalWritingSettings } from '../settings';
import type { ChatMessage } from '../types';

/** JSON schema object or the literal "json" accepted by Ollama's `format` field. */
export type OllamaFormat = 'json' | Record<string, unknown>;

export interface ChatOptions {
	/** Constrain output to JSON (optionally matching a schema). */
	format?: OllamaFormat;
	/** Overrides the configured temperature for this call. */
	temperature?: number;
}

type FailureKind = 'unreachable' | 'model' | 'http' | 'timeout' | 'response';

export class OllamaError extends Error {
	constructor(
		message: string,
		readonly kind: FailureKind,
	) {
		super(message);
		this.name = 'OllamaError';
	}
}

interface TagsResponse {
	models: { name: string }[];
}

interface ChatResponse {
	message: { role: string; content: string };
}

/** How long a successful model resolution is trusted before re-checking /api/tags. */
const MODEL_CACHE_MS = 5 * 60 * 1000;
const NOTICE_MS = 8000;

function isTagsResponse(value: unknown): value is TagsResponse {
	if (typeof value !== 'object' || value === null) return false;
	const models = (value as { models?: unknown }).models;
	return (
		Array.isArray(models) &&
		models.every((m) => typeof m === 'object' && m !== null && typeof (m as { name?: unknown }).name === 'string')
	);
}

function isChatResponse(value: unknown): value is ChatResponse {
	if (typeof value !== 'object' || value === null) return false;
	const message = (value as { message?: unknown }).message;
	return (
		typeof message === 'object' &&
		message !== null &&
		typeof (message as { content?: unknown }).content === 'string'
	);
}

/** Does an installed model name satisfy the requested name? ("mistral-nemo" matches "mistral-nemo:latest"). */
function modelMatches(installed: string, wanted: string): boolean {
	if (installed === wanted) return true;
	if (wanted.includes(':')) return false;
	return installed === `${wanted}:latest` || installed.startsWith(`${wanted}:`);
}

/**
 * Thin client for a local Ollama server. Uses Obsidian's `requestUrl`, which
 * bypasses CORS and works on desktop and mobile.
 */
export class OllamaService {
	private cachedModel: { requested: string; name: string; at: number } | null = null;

	constructor(private readonly getSettings: () => IncrementalWritingSettings) {}

	/** Forget the resolved model (call after settings change). */
	invalidate(): void {
		this.cachedModel = null;
	}

	private get baseUrl(): string {
		return this.getSettings().ollamaHost.trim().replace(/\/+$/, '');
	}

	private async request(params: RequestUrlParam): Promise<RequestUrlResponse> {
		const timeoutMs = Math.max(10, this.getSettings().requestTimeoutSec) * 1000;
		let timer: number | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = window.setTimeout(
				() => reject(new OllamaError(`Ollama did not respond within ${timeoutMs / 1000} s.`, 'timeout')),
				timeoutMs,
			);
		});
		try {
			return await Promise.race([
				requestUrl({ ...params, throw: false }).catch((err: unknown) => {
					const detail = err instanceof Error ? err.message : String(err);
					throw new OllamaError(`Cannot reach Ollama at ${this.baseUrl} (${detail}).`, 'unreachable');
				}),
				timeout,
			]);
		} finally {
			window.clearTimeout(timer);
		}
	}

	/** List installed model names via GET /api/tags. */
	async listModels(): Promise<string[]> {
		const res = await this.request({ url: `${this.baseUrl}/api/tags`, method: 'GET' });
		if (res.status !== 200) {
			throw new OllamaError(`Ollama returned HTTP ${res.status} for /api/tags.`, 'http');
		}
		const body: unknown = res.json;
		if (!isTagsResponse(body)) throw new OllamaError('Unexpected response from /api/tags.', 'response');
		return body.models.map((m) => m.name);
	}

	/**
	 * Find an installed model: the configured one first, then the fallback.
	 * Shows a notice and returns null when neither is available.
	 */
	async resolveModel(force = false): Promise<string | null> {
		const { model, fallbackModel } = this.getSettings();
		const cached = this.cachedModel;
		if (!force && cached && cached.requested === model && Date.now() - cached.at < MODEL_CACHE_MS) {
			return cached.name;
		}

		let installed: string[];
		try {
			installed = await this.listModels();
		} catch (err) {
			this.notifyError(err);
			return null;
		}

		for (const candidate of [model, fallbackModel].filter((m) => m.length > 0)) {
			const match = installed.find((name) => modelMatches(name, candidate));
			if (match) {
				if (candidate !== model) {
					new Notice(`Model "${model}" is not installed; falling back to "${match}".`, NOTICE_MS);
				}
				this.cachedModel = { requested: model, name: match, at: Date.now() };
				return match;
			}
		}

		new Notice(
			`Model "${model}" is not installed in Ollama. Run "ollama pull ${model}" or set a fallback model in settings.`,
			NOTICE_MS,
		);
		return null;
	}

	/**
	 * Send a non-streaming chat request. Returns the assistant's reply, or null
	 * after showing a notice when anything goes wrong.
	 */
	async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string | null> {
		const model = await this.resolveModel();
		if (!model) return null;

		const settings = this.getSettings();
		const payload: Record<string, unknown> = {
			model,
			messages,
			stream: false,
			options: { temperature: options.temperature ?? settings.temperature },
		};
		if (options.format) payload.format = options.format;

		try {
			const res = await this.request({
				url: `${this.baseUrl}/api/chat`,
				method: 'POST',
				contentType: 'application/json',
				body: JSON.stringify(payload),
			});
			if (res.status === 404) {
				this.invalidate();
				throw new OllamaError(`Model "${model}" was not found by Ollama.`, 'model');
			}
			if (res.status === 403) {
				throw new OllamaError(
					'Ollama rejected the request (HTTP 403). Allow Obsidian via the OLLAMA_ORIGINS environment variable.',
					'http',
				);
			}
			if (res.status !== 200) {
				throw new OllamaError(`Ollama returned HTTP ${res.status}: ${res.text.slice(0, 200)}`, 'http');
			}
			const body: unknown = res.json;
			if (!isChatResponse(body)) throw new OllamaError('Unexpected response from /api/chat.', 'response');
			const content = body.message.content.trim();
			if (!content) throw new OllamaError('Ollama returned an empty response.', 'response');
			return content;
		} catch (err) {
			this.notifyError(err);
			return null;
		}
	}

	private notifyError(err: unknown): void {
		if (err instanceof OllamaError) {
			const hint = err.kind === 'unreachable' ? ' Is "ollama serve" running?' : '';
			new Notice(`${err.message}${hint}`, NOTICE_MS);
		} else {
			new Notice(`Ollama request failed: ${err instanceof Error ? err.message : String(err)}`, NOTICE_MS);
		}
		console.error('[incremental-writing]', err);
	}
}
