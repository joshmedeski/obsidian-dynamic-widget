import { Plugin } from "obsidian";
import {
	DynamicWidgetView,
	VIEW_TYPE_DYNAMIC_WIDGET,
} from "./src/dynamic-widget-view";

export default class DynamicWidget extends Plugin {
	async onload() {
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
}
