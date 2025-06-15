import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

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

	private makeUlLinkList(list: TFile[] | undefined): Element {
		if (!list || list.length === 0) return document.createElement("div");
		const ulEl = document.createElement("ul");
		const liEls = list.map((project) => {
			const projectEl = document.createElement("li");
			const metadata = this.app.metadataCache.getFileCache(project);
			const linkEl = projectEl.createEl("a", {
				text: metadata?.frontmatter?.title || project.basename,
			});
			linkEl.addEventListener("click", (event) => {
				event.preventDefault();
				this.app.workspace.getLeaf().openFile(project);
			});
			return projectEl;
		});
		liEls.forEach((el) => ulEl.appendChild(el));
		return ulEl;
	}

	private getActiveProjects(): Element {
		const activeProjectNotes = this.app.vault.getFiles().filter((file) => {
			return (
				file.path.startsWith("Projects 🏔️/Active ✅") &&
				file.extension === "md"
			);
		});
		return this.makeUlLinkList(activeProjectNotes);
	}

	private getProjectsByArea(area: string): Element {
		const areaNotes = this.app.vault.getFiles().filter((file) => {
			const metadata = this.app.metadataCache.getFileCache(file);
			const areaFrontmatter = metadata?.frontmatter?.area;
			if (!areaFrontmatter) return false;
			console.log("Area Frontmatter:", areaFrontmatter);
			if (Array.isArray(areaFrontmatter)) {
				return areaFrontmatter.includes(area);
			}
			return areaFrontmatter.replace(/\[\[|\]\]/g, "") === area;
		});
		return this.makeUlLinkList(areaNotes);
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

		// const projectList = this.getActiveProjects();
		// if (projectList) {
		// 	this.contentEl.createEl("h3", { text: "Active Projects" });
		// 	this.contentEl.appendChild(projectList);
		// }

		if (area) {
			const areaList = this.getProjectsByArea(area);
			if (areaList) {
				this.contentEl.createEl("h3", {
					text: `Projects in Area: ${area}`,
				});
				this.contentEl.appendChild(areaList);
			}
		}
	}

	async onClose(): Promise<void> {
		this.contentEl = document.createElement("div");
	}
}
