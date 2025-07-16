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
];

const DAILY_FOLDERS = ["Inbox 📥", "Projects 🏔️/Active ✅"];

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

		// Add emoji bullet class
		ulEl.classList.add("emoji-bullet-list");

		const liEls = list.map((project) => {
			const projectEl = document.createElement("li");

			// Extract emoji from the file's path
			const emoji = this.getEmojiForFilePath(project.path);
			projectEl.style.setProperty("--emoji-bullet", `"${emoji}"`);
			projectEl.classList.add("emoji-bullet-item");

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

	private filesByFolders(
		allFiles: TFile[],
		folders: string[],
	): FilesByFolder {
		const notesByFolder: FilesByFolder = [];
		folders.forEach((folder) => {
			const files = allFiles.filter(
				(file) =>
					file.path.startsWith(folder) && file.extension === "md",
			);
			if (files) notesByFolder.push({ folder, files });
		});
		return notesByFolder;
	}

	private simplifyWikiLink = (link: string) => link.replace(/\[\[|\]\]/g, "");

	private extractEmojiFromFolderName(folderName: string): string {
		// Extract emoji from folder names like "Inbox 📥" or "Projects 🏔️/Active ✅"
		// This regex matches complete emoji sequences including variation selectors
		const emojiRegex = /[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D]+/gu;
		const matches = folderName.match(emojiRegex);
		if (matches && matches.length > 0) {
			// Return the last emoji found
			return matches[matches.length - 1];
		}
		// Fallback: return a default bullet
		return "•";
	}

	private getEmojiForFilePath(filePath: string): string {
		// First, try to find the matching folder from the predefined list
		const matchingFolder = ORDERED_FOLDER_NAMES.find(folder => 
			filePath.startsWith(folder)
		);
		
		if (matchingFolder) {
			return this.extractEmojiFromFolderName(matchingFolder);
		}
		
		// If no predefined folder matches, extract emoji from the immediate parent folder
		const pathParts = filePath.split('/');
		if (pathParts.length > 1) {
			// For files like "Periodic 🌄/Days 🌄/2025-07-15.md", use the immediate parent folder
			const parentFolder = pathParts[pathParts.length - 2];
			const emoji = this.extractEmojiFromFolderName(parentFolder);
			if (emoji !== "•") {
				return emoji;
			}
		}
		
		// If still no emoji found, try the root folder
		if (pathParts.length > 0) {
			const rootFolder = pathParts[0];
			const emoji = this.extractEmojiFromFolderName(rootFolder);
			if (emoji !== "•") {
				return emoji;
			}
		}
		
		// Fallback: return a default bullet
		return "•";
	}

	private normalizeAreasFrontmatter(areas: string | string[]): string[] {
		return typeof areas === "string" ? [areas] : areas;
	}

	private getFilesByArea(area: string): TFile[] {
		return this.app.vault.getFiles().filter((file) => {
			const metadata = this.app.metadataCache.getFileCache(file);

			const fileAreas: string[] | undefined =
				this.normalizeAreasFrontmatter(metadata?.frontmatter?.areas);
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
	): "areas" | "day" | "other" {
		if (!activeFile) return "other";
		const metadata = this.app.metadataCache.getFileCache(activeFile);
		if (metadata?.frontmatter?.areas) return "areas";
		if (activeFile.basename.match(/^\d{4}-\d{2}-\d{2}$/)) return "day";
		return "other";
	}

	private renderAreasContent(activeFile: TFile): void {
		const metadata = this.app.metadataCache.getFileCache(activeFile);
		// TODO: add zod validator
		const areasFrontmatter = this.normalizeAreasFrontmatter(
			metadata?.frontmatter?.areas,
		);
		const areasFiles: TFile[] = [];
		if (areasFrontmatter && areasFrontmatter.length > 0) {
			const areas: string[] = areasFrontmatter.map(this.simplifyWikiLink);
			for (const area of areas) {
				this.contentEl.createEl("h2", { text: area });
				const areaFiles = this.getFilesByArea(area);
				areasFiles.push(...areaFiles);
			}
			const uniqueFiles = Array.from(
				new Map(areasFiles.map((file) => [file.path, file])).values(),
			);
			const folders = this.filesByFolders(
				uniqueFiles,
				ORDERED_FOLDER_NAMES,
			);
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

		const allFiles = this.app.vault.getFiles();
		const folders = this.filesByFolders(allFiles, DAILY_FOLDERS);
		// todo: loop through records
		folders.forEach((folder) => {
			const areaSection = this.makeUlLinkListWithTitle(
				folder.folder,
				folder.files,
			);
			if (areaSection) this.contentEl.appendChild(areaSection);
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
			case "areas":
				this.renderAreasContent(activeFile);
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
