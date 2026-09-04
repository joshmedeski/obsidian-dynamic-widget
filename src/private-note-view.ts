import { ItemView, type WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_PRIVATE_NOTE = "private-note-view";

export class PrivateNoteView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PRIVATE_NOTE;
  }

  getDisplayText(): string {
    return "Private Note";
  }

  getIcon(): string {
    return "lock";
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();

    const wrapper = container.createEl("div", {
      cls: "private-note-container",
    });

    wrapper.createEl("div", { text: "🔒", cls: "private-note-icon" });
    wrapper.createEl("h2", {
      text: "Private Note",
      cls: "private-note-title",
    });
    wrapper.createEl("p", {
      text: "This note is private and cannot be opened at this time.",
      cls: "private-note-message",
    });
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onClose(): Promise<void> {}
}
