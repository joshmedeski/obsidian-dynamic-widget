import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

export const VIEW_TYPE_DYNAMIC_WIDGET = "dynamic-widget-view";

const ORDERED_FOLDER_NAMES = [
	"Inbox 📥",
	"Goals 🎯",
	"Growth Edges 🌱",
	"Projects 🏔️/Active ✅",
	"Projects 🏔️/Upcoming ⏳",
	"Projects 🏔️/Ideas 💡",
	"Projects 🏔️/Backlog 🗄️",
	"Projects 🏔️/Incubating 🌱",
	"Relationships 👥",
	"Resources 🛠️",
	"Archives 📦",
] as const;

type FilesByFolder = { folder: string; files: TFile[] }[];

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

	private makeUlLinkListWithTitle(
		title: string,
		list: TFile[] | undefined,
	): Element {
		if (!list || list.length === 0) return document.createElement("div");
		const sectionEl = document.createElement("section");
		sectionEl.createEl("h4", { text: title });
		const ulEl = this.makeUlLinkList(list);
		sectionEl.appendChild(ulEl);
		return sectionEl;
	}

	private makeUlLinkList(list: TFile[] | undefined): Element {
		if (!list || list.length === 0) return document.createElement("div");
		const ulEl = document.createElement("ul");
		const activeFile = this.app.workspace.getActiveFile();

		const liEls = list.map((project) => {
			const projectEl = document.createElement("li");

			if (activeFile && activeFile.path === project.path) {
				projectEl.createEl("span", {
					text: project.basename,
					cls: "dynamic-widget-active-file",
				});
				return projectEl;
			}

			const metadata = this.app.metadataCache.getFileCache(project);
			const linkEl = projectEl.createEl("a", {
				text: metadata?.frontmatter?.title || project.basename,
			});
			linkEl.addEventListener("click", (event) => {
				event.preventDefault();
				this.app.workspace.getLeaf("tab").openFile(project);
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

	private filesByFolders(allFiles: TFile[]): FilesByFolder {
		const notesByFolder: FilesByFolder = [];
		ORDERED_FOLDER_NAMES.forEach((folder) => {
			const files = allFiles.filter(
				(file) =>
					file.path.startsWith(folder) && file.extension === "md",
			);
			if (files) notesByFolder.push({ folder, files });
		});
		return notesByFolder;
	}

	private getFilesByArea(area: string): TFile[] {
		return this.app.vault.getFiles().filter((file) => {
			const metadata = this.app.metadataCache.getFileCache(file);
			const areaFrontmatter = metadata?.frontmatter?.area;
			if (!areaFrontmatter) return false;
			if (Array.isArray(areaFrontmatter)) {
				return areaFrontmatter
					.map((area) => area.replace(/\[\[|\]\]/g, ""))
					.includes(area);
			}
			return areaFrontmatter.replace(/\[\[|\]\]/g, "") === area;
		});
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

		// Listen for file movements/renames
		this.registerEvent(
			this.app.vault.on("rename", (file: TFile, oldPath: string) => {
				// Update when any file with the same area is moved
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					const metadata =
						this.app.metadataCache.getFileCache(activeFile);
					const currentArea = metadata?.frontmatter?.area;
					if (currentArea) {
						const movedFileMetadata =
							this.app.metadataCache.getFileCache(file);
						const movedFileArea =
							movedFileMetadata?.frontmatter?.area;
						// Update if the moved file shares the same area
						if (
							movedFileArea &&
							movedFileArea.replace(/\[\[|\]\]/g, "") ===
								currentArea.replace(/\[\[|\]\]/g, "")
						) {
							this.updateContent();
						}
					}
				}
			}),
		);

		// Listen for file deletions
		this.registerEvent(
			this.app.vault.on("delete", (file: TFile) => {
				// Update when any file with the same area is deleted
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					const metadata =
						this.app.metadataCache.getFileCache(activeFile);
					const currentArea = metadata?.frontmatter?.area;
					if (currentArea) {
						// Since the file is deleted, we can't check its metadata
						// So we update the widget to reflect the deletion
						this.updateContent();
					}
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
			const areaFiles = this.getFilesByArea(area);
			if (areaFiles) {
				const folders = this.filesByFolders(areaFiles);
				// todo: loop through records
				folders.forEach((folder) => {
					const areaSection = this.makeUlLinkListWithTitle(
						folder.folder,
						folder.files,
					);
					if (areaSection) this.contentEl.appendChild(areaSection);
				});
			}
		}
	}

	async onClose(): Promise<void> {
		this.contentEl = document.createElement("div");
	}
}
