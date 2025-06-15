import { ItemView, WorkspaceLeaf, TFile, CachedMetadata } from "obsidian";

export const VIEW_TYPE_DYNAMIC_WIDGET = "dynamic-widget-view";

export class DynamicWidgetView extends ItemView {
	public contentEl: HTMLElement = document.createElement("div");

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DYNAMIC_WIDGET;
	}

	getDisplayText(): string {
		return "Dynamic Widget";
	}

	getIcon(): string {
		return "activity";
	}

	getHeader(): string {
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

		// Create and store reference to content container
		this.contentEl = container.createEl("div", {
			cls: "dynamic-widget-content",
		});

		// Initial content update
		this.updateContent();

		// Listen for active file changes
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.updateContent();
			}),
		);

		// Listen for file modifications
		this.registerEvent(
			this.app.metadataCache.on("changed", (file: TFile) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.path === file.path) {
					this.updateContent();
				}
			}),
		);
	}

	private updateContent(): void {
		if (!this.contentEl) return;

		// Clear existing content
		this.contentEl.empty();

		const activeFile = this.app.workspace.getActiveFile();

		// Header
		this.contentEl.createEl("h1", {
			text: this.getHeader(),
		});

		if (!activeFile) {
			this.contentEl.createEl("p", {
				text: "No file is currently active",
				cls: "dynamic-widget-no-file",
			});
			return;
		}

		// File info section
		const infoEl = this.contentEl.createEl("div", {
			cls: "dynamic-widget-info",
		});

		// Display file path
		infoEl.createEl("p", {
			text: `Path: ${activeFile.path}`,
			cls: "dynamic-widget-path",
		});

		// Get and display file metadata
		const metadata = this.app.metadataCache.getFileCache(activeFile);
		if (metadata) {
			this.displayMetadata(infoEl, metadata);
		}
	}

	private displayMetadata(
		container: HTMLElement,
		metadata: CachedMetadata,
	): void {
		// Display frontmatter properties
		if (metadata.frontmatter) {
			const propertiesEl = container.createEl("div", {
				cls: "dynamic-widget-properties",
			});

			propertiesEl.createEl("h3", { text: "Properties" });

			const propsListEl = propertiesEl.createEl("ul");

			for (const [key, value] of Object.entries(metadata.frontmatter)) {
				const listItem = propsListEl.createEl("li");
				listItem.createEl("strong", { text: `${key}: ` });
				listItem.appendText(String(value));
			}
		}

		// Display tags
		if (metadata.tags && metadata.tags.length > 0) {
			const tagsEl = container.createEl("div", {
				cls: "dynamic-widget-tags",
			});

			tagsEl.createEl("h3", { text: "Tags" });

			const tagsListEl = tagsEl.createEl("div", {
				cls: "dynamic-widget-tags-list",
			});

			metadata.tags.forEach((tag) => {
				tagsListEl.createEl("span", {
					text: tag.tag,
					cls: "dynamic-widget-tag",
				});
			});
		}

		// Display headings count
		if (metadata.headings && metadata.headings.length > 0) {
			container.createEl("p", {
				text: `Headings: ${metadata.headings.length}`,
				cls: "dynamic-widget-stat",
			});
		}

		// Display links count
		if (metadata.links && metadata.links.length > 0) {
			container.createEl("p", {
				text: `Links: ${metadata.links.length}`,
				cls: "dynamic-widget-stat",
			});
		}
	}

	async onClose(): Promise<void> {
		this.contentEl = document.createElement("div");
	}
}
