import { Plugin, WorkspaceLeaf } from 'obsidian';
import { registerCommands } from './commands';
import { pendingInsertExtension } from './editor/pendingInsert';
import { OllamaService } from './services/ollama';
import { WritingQueue } from './services/scheduler';
import { IncrementalWritingSettings, IncrementalWritingSettingTab, sanitizeSettings } from './settings';
import { VIEW_TYPE_QUEUE, WritingQueueView } from './views/queueView';

export default class IncrementalWritingPlugin extends Plugin {
	settings!: IncrementalWritingSettings;
	ollama!: OllamaService;
	queue!: WritingQueue;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.ollama = new OllamaService(() => this.settings);
		this.queue = new WritingQueue(this.app, () => this.settings);

		this.registerView(VIEW_TYPE_QUEUE, (leaf) => new WritingQueueView(leaf, this));
		this.registerEditorExtension(pendingInsertExtension);
		registerCommands(this);

		this.addRibbonIcon('list-checks', 'Open writing queue', () => void this.activateQueueView());
		this.addSettingTab(new IncrementalWritingSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = sanitizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.ollama.invalidate();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_QUEUE)) {
			if (leaf.view instanceof WritingQueueView) leaf.view.refresh();
		}
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.ollama.invalidate();
	}

	/** Reveal the queue view in the right sidebar, creating it if needed. */
	async activateQueueView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_QUEUE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_QUEUE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}
}
