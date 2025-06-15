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

	private dynamicHeaderText(
		area: string | undefined,
		activeFile: TFile | null,
	): string {
		if (area) return area;
		if (!activeFile) return "Dynamic Widget";

		// Date formatting for date-named files
		const basename = activeFile.basename;
		if (basename && basename.match(/^\d{4}-\d{2}-\d{2}$/)) {
			const date = new Date(basename);
			return date.toLocaleDateString("en-US", {
				weekday: "short",
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		}

		return activeFile.basename;
	}

	private getProjectList(): Element {
		const projectList = document.createElement("ul");
		const activeProjectNotes = this.app.vault
			.getFiles()
			.filter((file) => {
				return (
					file.path.startsWith("Projects 🏔️/Active ✅") &&
					file.extension === "md"
				);
			})
			.map((project) => {
				const projectEl = document.createElement("li");
				const metadata = this.app.metadataCache.getFileCache(project);
				projectEl.createEl("a", {
					text: metadata?.frontmatter?.title || project.basename,
					href: this.app.vault.getResourcePath(project),
				});
				return projectEl;
			});
		activeProjectNotes.forEach((el) => projectList.appendChild(el));
		if (activeProjectNotes.length === 0) {
			projectList.createEl("li", {
				text: "No active projects found",
				cls: "dynamic-widget-no-projects",
			});
		}
		return projectList;
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

		let area: string | undefined = undefined;
		if (activeFile) {
			const metadata = this.app.metadataCache.getFileCache(activeFile);
			const areaFrontmatter = metadata?.frontmatter?.area;
			if (areaFrontmatter) {
				area = areaFrontmatter.replace(/\[\[|\]\]/g, "");
			}
		}

		// Header
		this.contentEl.createEl("h2", {
			text: this.dynamicHeaderText(area, activeFile),
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

		const projectList = this.getProjectList();
		if (projectList) {
			infoEl.createEl("h3", { text: "Active Projects" });
			infoEl.appendChild(projectList);
		}
	}

	async onClose(): Promise<void> {
		this.contentEl = document.createElement("div");
	}
}
