import { App, Notice, PluginSettingTab, Setting, TextAreaComponent } from 'obsidian';
import type IncrementalWritingPlugin from './main';
import {
	DEFAULT_BRIDGE_PROMPT,
	DEFAULT_OUTLINE_PROMPT,
	DEFAULT_SOCRATIC_PROMPT,
	DEFAULT_SYSTEM_PROMPT,
} from './prompts';

export type BridgeInsertMode = 'comment' | 'text';

export interface IncrementalWritingSettings {
	ollamaHost: string;
	model: string;
	fallbackModel: string;
	temperature: number;
	requestTimeoutSec: number;

	initialInterval: number;
	maxInterval: number;
	hardMultiplier: number;
	goodMultiplier: number;
	easyMultiplier: number;
	upcomingDays: number;

	dailyNoteTasks: boolean;
	dailyNoteHeading: string;

	childNoteFolder: string;
	bridgeInsertMode: BridgeInsertMode;

	systemPrompt: string;
	socraticPrompt: string;
	bridgePrompt: string;
	outlinePrompt: string;
}

export const DEFAULT_SETTINGS: IncrementalWritingSettings = {
	ollamaHost: 'http://127.0.0.1:11434',
	model: 'mistral-nemo',
	fallbackModel: '',
	temperature: 0.4,
	requestTimeoutSec: 180,

	initialInterval: 1,
	maxInterval: 365,
	hardMultiplier: 1.2,
	goodMultiplier: 2.0,
	easyMultiplier: 3.0,
	upcomingDays: 7,

	dailyNoteTasks: true,
	dailyNoteHeading: 'Tasks',

	childNoteFolder: '',
	bridgeInsertMode: 'comment',

	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	socraticPrompt: DEFAULT_SOCRATIC_PROMPT,
	bridgePrompt: DEFAULT_BRIDGE_PROMPT,
	outlinePrompt: DEFAULT_OUTLINE_PROMPT,
};

/** Merge persisted data over defaults, discarding values of the wrong type. */
export function sanitizeSettings(raw: unknown): IncrementalWritingSettings {
	const out: IncrementalWritingSettings = { ...DEFAULT_SETTINGS };
	if (typeof raw !== 'object' || raw === null) return out;
	const data = raw as Record<string, unknown>;
	const target = out as unknown as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof IncrementalWritingSettings)[]) {
		const value = data[key];
		if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
			target[key] = value;
		}
	}
	if (out.bridgeInsertMode !== 'comment' && out.bridgeInsertMode !== 'text') {
		out.bridgeInsertMode = DEFAULT_SETTINGS.bridgeInsertMode;
	}
	return out;
}

type NumericKey = {
	[K in keyof IncrementalWritingSettings]: IncrementalWritingSettings[K] extends number ? K : never;
}[keyof IncrementalWritingSettings];

type PromptKey = 'systemPrompt' | 'socraticPrompt' | 'bridgePrompt' | 'outlinePrompt';

export class IncrementalWritingSettingTab extends PluginSettingTab {
	private readonly plugin: IncrementalWritingPlugin;

	constructor(app: App, plugin: IncrementalWritingPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderOllamaSection(containerEl);
		this.renderSchedulingSection(containerEl);
		this.renderDailyNotesSection(containerEl);
		this.renderRefactorSection(containerEl);
		this.renderPromptSection(containerEl);
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	private renderOllamaSection(el: HTMLElement): void {
		new Setting(el).setName('Ollama').setHeading();

		new Setting(el)
			.setName('Host URL')
			.setDesc('Base URL of your local Ollama server. Requests go to <host>/api/chat.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaHost)
					.setValue(this.plugin.settings.ollamaHost)
					.onChange(async (value) => {
						this.plugin.settings.ollamaHost = value.trim() || DEFAULT_SETTINGS.ollamaHost;
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Model')
			.setDesc('Primary model name as shown by `ollama list`.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.model)
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Fallback model')
			.setDesc('Used when the primary model is not installed. Leave empty to disable.')
			.addText((text) =>
				text
					.setPlaceholder('For example, llama3.1')
					.setValue(this.plugin.settings.fallbackModel)
					.onChange(async (value) => {
						this.plugin.settings.fallbackModel = value.trim();
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Temperature')
			.setDesc('Lower is more focused, higher is more creative.')
			.addSlider((slider) =>
				slider
					.setLimits(0, 1.5, 0.05)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.save();
					}),
			);

		this.addNumber(el, 'requestTimeoutSec', 'Request timeout (seconds)', 'How long to wait for a response before giving up.', 10, 1800, true);

		new Setting(el)
			.setName('Test connection')
			.setDesc('Check the server connection and that the model is installed.')
			.addButton((button) =>
				button.setButtonText('Test').onClick(async () => {
					button.setDisabled(true);
					try {
						const model = await this.plugin.ollama.resolveModel(true);
						if (model) new Notice(`Ollama is reachable. Using model "${model}".`);
					} finally {
						button.setDisabled(false);
					}
				}),
			);
	}

	private renderSchedulingSection(el: HTMLElement): void {
		new Setting(el).setName('Scheduling').setHeading();

		this.addNumber(el, 'initialInterval', 'Initial interval (days)', 'Interval assigned to new seeds and extracted child notes.', 1, 365, true);
		this.addNumber(el, 'maxInterval', 'Maximum interval (days)', 'Intervals never grow beyond this.', 1, 3650, true);
		this.addNumber(el, 'hardMultiplier', 'Hard multiplier', 'Interval growth factor when a review felt hard.', 0.1, 10, false);
		this.addNumber(el, 'goodMultiplier', 'Good multiplier', 'Interval growth factor for a normal review.', 0.1, 10, false);
		this.addNumber(el, 'easyMultiplier', 'Easy multiplier', 'Interval growth factor when a review felt easy.', 0.1, 10, false);
		this.addNumber(el, 'upcomingDays', 'Upcoming window (days)', 'Show drafts due within this many days below the due list. Use 0 to hide.', 0, 90, true);
	}

	private renderDailyNotesSection(el: HTMLElement): void {
		new Setting(el).setName('Daily note tasks').setHeading();

		new Setting(el)
			.setName('Add review tasks to daily notes')
			.setDesc(
				'When a note is scheduled, add a "Review [[note]]" task to the daily note for its due date, ' +
					'creating that daily note if needed. Uses the folder, date format and template from the core Daily notes settings.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dailyNoteTasks).onChange(async (value) => {
					this.plugin.settings.dailyNoteTasks = value;
					await this.save();
				}),
			);

		new Setting(el)
			.setName('Tasks heading')
			.setDesc('The task is added at the end of this section. The section is appended if the daily note lacks it.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.dailyNoteHeading)
					.setValue(this.plugin.settings.dailyNoteHeading)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteHeading = value.trim() || DEFAULT_SETTINGS.dailyNoteHeading;
						await this.save();
					}),
			);
	}

	private renderRefactorSection(el: HTMLElement): void {
		new Setting(el).setName('Editing').setHeading();

		new Setting(el)
			.setName('Child note folder')
			.setDesc('Where extracted tangents are created. Leave empty to use the parent note\'s folder.')
			.addText((text) =>
				text
					.setPlaceholder('Same folder as parent')
					.setValue(this.plugin.settings.childNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.childNoteFolder = value.trim();
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Bridge insertion')
			.setDesc('Insert transition options as a hidden comment, or as visible text.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('comment', 'Comment block')
					.addOption('text', 'Visible text')
					.setValue(this.plugin.settings.bridgeInsertMode)
					.onChange(async (value) => {
						this.plugin.settings.bridgeInsertMode = value === 'text' ? 'text' : 'comment';
						await this.save();
					}),
			);
	}

	private renderPromptSection(el: HTMLElement): void {
		new Setting(el).setName('Prompt templates').setHeading();
		el.createEl('p', {
			cls: 'setting-item-description',
			text:
				'Placeholders: {{title}} for the note title, {{text}} for the selection or draft, ' +
				'{{before}} and {{after}} for the two bridged passages. The bridge and outline prompts ' +
				'must keep asking for the JSON shape shown in their defaults.',
		});

		this.addPrompt(el, 'systemPrompt', 'System prompt', 'Sent with every request.');
		this.addPrompt(el, 'socraticPrompt', 'Socratic adversary', 'Critique of the draft or selection.');
		this.addPrompt(el, 'bridgePrompt', 'Bridge draft gaps', 'Transitions between two passages.');
		this.addPrompt(el, 'outlinePrompt', 'Seed to outline scaffold', 'Four-tier rhetorical skeleton.');
	}

	private addNumber(
		el: HTMLElement,
		key: NumericKey,
		name: string,
		desc: string,
		min: number,
		max: number,
		integer: boolean,
	): void {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = String(min);
				text.inputEl.max = String(max);
				text.inputEl.step = integer ? '1' : '0.1';
				text
					.setPlaceholder(String(DEFAULT_SETTINGS[key]))
					.setValue(String(this.plugin.settings[key]))
					.onChange(async (value) => {
						const parsed = integer ? Number.parseInt(value, 10) : Number.parseFloat(value);
						if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
							text.inputEl.addClass('iw-invalid');
							return;
						}
						text.inputEl.removeClass('iw-invalid');
						this.plugin.settings[key] = parsed;
						await this.save();
					});
			});
	}

	private addPrompt(el: HTMLElement, key: PromptKey, name: string, desc: string): void {
		let area: TextAreaComponent | null = null;
		const setting = new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addExtraButton((button) =>
				button
					.setIcon('reset')
					.setTooltip('Restore default')
					.onClick(async () => {
						this.plugin.settings[key] = DEFAULT_SETTINGS[key];
						area?.setValue(DEFAULT_SETTINGS[key]);
						await this.save();
					}),
			)
			.addTextArea((text) => {
				area = text;
				text.inputEl.rows = 8;
				text.inputEl.addClass('iw-prompt-textarea');
				text.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.save();
				});
			});
		setting.settingEl.addClass('iw-prompt-setting');
	}
}
