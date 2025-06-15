import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

export const VIEW_TYPE_DYNAMIC_WIDGET = "dynamic-widget-view";

export class DynamicWidgetView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DYNAMIC_WIDGET;
	}

	getDisplayText(): string {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			return activeFile.basename;
		}
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

		// Listen for active leaf changes to update the title
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				// The getDisplayText method will be called automatically when needed
				// No explicit refresh needed as Obsidian handles this
			})
		);
	}

	async onClose(): Promise<void> {
		// Cleanup when view is closed
	}
}