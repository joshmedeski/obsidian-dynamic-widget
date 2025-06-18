import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

export const VIEW_TYPE_DYNAMIC_WIDGET = "dynamic-widget-view";

const ORDERED_FOLDER_NAMES = [
	"Inbox 📥",
	"Goals 🎯",
	"Growth Edges 🌱",
	"Projects 🏔️/Active ✅",
	"Projects 🏔️/Upcoming ⏳",
	"Projects 🏔️/Ideas 💡",
	"Projects 🏔️/Incubating 🌱",
	"Projects 🏔️/Backlog 🗃️",
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

	private simplifyWikiLink = (link: string) => link.replace(/\[\[|\]\]/g, "");

	private getFilesByArea(area: string): TFile[] {
		return this.app.vault.getFiles().filter((file) => {
			const metadata = this.app.metadataCache.getFileCache(file);

			const fileArea = metadata?.frontmatter?.area;
			if (fileArea) return area === this.simplifyWikiLink(fileArea);

			const fileAreas: string[] | undefined =
				metadata?.frontmatter?.areas;
			if (!fileAreas?.length) return false;
			const fileHasArea = fileAreas
				.map(this.simplifyWikiLink)
				.includes(area);
			return fileHasArea;
		});
	}

	private getFilesByDayCreated(date: Date) {
		const files = this.app.vault
			.getFiles()
			.filter((file) => {
				const fileDate = new Date(file.stat.ctime);
				return (
					file.extension === "md" &&
					fileDate.getFullYear() === date.getFullYear() &&
					fileDate.getMonth() === date.getMonth() &&
					fileDate.getDate() === date.getDate()
				);
			})
			.sort((a, b) => {
				return (
					new Date(b.stat.ctime).getTime() -
					new Date(a.stat.ctime).getTime()
				);
			});

		const newFiles = this.makeUlLinkListWithTitle("Created", files);
		this.contentEl.appendChild(newFiles);
	}

	private getFilesByDayModified(date: Date) {
		const files = this.app.vault
			.getFiles()
			.filter((file) => {
				const fileDate = new Date(file.stat.mtime);
				return (
					file.extension === "md" &&
					fileDate.getFullYear() === date.getFullYear() &&
					fileDate.getMonth() === date.getMonth() &&
					fileDate.getDate() === date.getDate()
				);
			})
			.sort((a, b) => {
				return (
					new Date(b.stat.mtime).getTime() -
					new Date(a.stat.mtime).getTime()
				);
			});

		const newFiles = this.makeUlLinkListWithTitle("Modified", files);
		this.contentEl.appendChild(newFiles);
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
			this.app.vault.on("rename", (file: TFile) => {
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
			this.app.vault.on("delete", () => {
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

	private determineActiveFileType(
		activeFile: TFile | null,
	): "area" | "day" | "other" {
		if (!activeFile) return "other";
		const metadata = this.app.metadataCache.getFileCache(activeFile);
		if (metadata?.frontmatter?.area) return "area";
		if (activeFile.basename.match(/^\d{4}-\d{2}-\d{2}$/)) return "day";
		return "other";
	}

	private renderAreaContent(activeFile: TFile): void {
		const metadata = this.app.metadataCache.getFileCache(activeFile);
		const areaFrontmatter = metadata?.frontmatter?.area;
		const area = areaFrontmatter.replace(/\[\[|\]\]/g, "");
		this.contentEl.createEl("h2", { text: area });
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

	private renderDateContent(): void {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const basename = activeFile.basename;
		if (!basename.match(/^\d{4}-\d{2}-\d{2}$/)) return;

		const [year, month, day] = basename.split("-").map(Number);
		const date = new Date(year, month - 1, day); // month is 0-indexed
		this.contentEl.createEl("h2", {
			text: date.toLocaleDateString("en-US", {
				weekday: "short",
				month: "short",
				day: "numeric",
				year: "numeric",
			}),
		});

		this.getFilesByDayCreated(date);
		this.getFilesByDayModified(date);
	}

	private updateContent(): void {
		if (!this.contentEl) return;
		this.contentEl.empty();

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			this.contentEl.createEl("p", {
				text: "No file is currently active",
			});
			return;
		}

		const activeFileType = this.determineActiveFileType(activeFile);
		switch (activeFileType) {
			case "area":
				this.renderAreaContent(activeFile);
				break;
			case "day":
				this.renderDateContent();
				break;
			default:
				this.contentEl.createEl("p", {
					text: "Other",
				});
				break;
		}
	}

	async onClose(): Promise<void> {
		this.contentEl = document.createElement("div");
	}
}
