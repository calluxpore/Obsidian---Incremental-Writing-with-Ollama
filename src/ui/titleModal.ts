import { App, Modal, Setting } from 'obsidian';

/** Ask for a note title. Resolves to the trimmed title, or null if cancelled. */
export function promptForTitle(app: App, heading: string, initial: string): Promise<string | null> {
	return new Promise((resolve) => new TitleModal(app, heading, initial, resolve).open());
}

class TitleModal extends Modal {
	private value: string;
	private settled = false;

	constructor(
		app: App,
		private readonly heading: string,
		initial: string,
		private readonly resolve: (value: string | null) => void,
	) {
		super(app);
		this.value = initial;
	}

	onOpen(): void {
		this.setTitle(this.heading);
		const submit = (): void => {
			if (!this.value.trim()) return;
			this.finish(this.value.trim());
		};

		new Setting(this.contentEl).setName('Note title').addText((text) => {
			text.setValue(this.value).onChange((v) => (this.value = v));
			text.inputEl.addClass('iw-title-input');
			text.inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
				if (evt.key === 'Enter' && !evt.isComposing) {
					evt.preventDefault();
					submit();
				}
			});
			window.setTimeout(() => text.inputEl.select(), 0);
		});

		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Create').setCta().onClick(submit));
	}

	private finish(value: string | null): void {
		if (this.settled) return;
		this.settled = true;
		this.resolve(value);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}
}
