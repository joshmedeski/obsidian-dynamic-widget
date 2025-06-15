import {
	App,
	Editor,
	ItemView,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
} from "obsidian";

export const VIEW_TYPE_DYNAMIC_WIDGET = "dynamic-widget-view";

interface DynamicWidgetSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: DynamicWidgetSettings = {
	mySetting: "default",
};

export class DynamicWidgetView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DYNAMIC_WIDGET;
	}

	getDisplayText(): string {
		return "Dynamic Widget";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("dynamic-widget-container");

		const content = container.createEl("div", {
			cls: "dynamic-widget-content",
		});

		content.createEl("h4", {
			text: "Dynamic Widget",
			cls: "dynamic-widget-title",
		});

		const infoEl = content.createEl("div", { cls: "dynamic-widget-info" });
		infoEl.createEl("p", { text: "This is your dynamic widget!" });

		const currentTime = content.createEl("div", {
			cls: "dynamic-widget-time",
		});
		currentTime.createEl("strong", { text: "Current Time: " });
		currentTime.createEl("span", {
			text: new Date().toLocaleTimeString(),
			cls: "time-display",
		});

		const actionButton = content.createEl("button", {
			text: "Refresh",
			cls: "dynamic-widget-button",
		});

		actionButton.addEventListener("click", () => {
			const timeSpan = currentTime.querySelector(".time-display");
			if (timeSpan) {
				timeSpan.textContent = new Date().toLocaleTimeString();
			}
		});
	}

	async onClose(): Promise<void> {
		// Cleanup when view is closed
	}
}

export default class DynamicWidget extends Plugin {
	settings: DynamicWidgetSettings;

	async onload() {
		await this.loadSettings();

		// Register the dynamic widget view
		this.registerView(
			VIEW_TYPE_DYNAMIC_WIDGET,
			(leaf) => new DynamicWidgetView(leaf),
		);

		// Auto-activate the widget in the right sidebar
		await this.activateView();

		// Add command to toggle the dynamic widget
		this.addCommand({
			id: "open-dynamic-widget",
			name: "Open Dynamic Widget",
			callback: () => {
				this.activateView();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	async activateView() {
		// Remove any existing instances
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DYNAMIC_WIDGET);

		// Create and activate the view in right sidebar
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({
			type: VIEW_TYPE_DYNAMIC_WIDGET,
			active: true,
		});

		// Ensure the view is visible
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_DYNAMIC_WIDGET,
		);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
		}
	}

	onunload() {
		// Clean up the view when plugin is disabled
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DYNAMIC_WIDGET);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: DynamicWidget;

	constructor(app: App, plugin: DynamicWidget) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
