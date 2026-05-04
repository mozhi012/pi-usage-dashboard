/**
 * Hotkeys API
 *
 * Returns all pi keyboard shortcuts with their default and custom bindings.
 * Reads custom overrides from ~/.pi/agent/keybindings.json if present.
 *
 * GET /api/hotkeys
 */
import { NextResponse } from "next/server";
import { readFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

interface HotkeyEntry {
  id: string;
  defaults: string[];
  custom?: string[];
  description: string;
  category: string;
}

// Default keybindings from pi
const DEFAULT_KEYBINDINGS: Record<string, { defaults: string[]; description: string; category: string }> = {
  // TUI Editor Cursor Movement
  "tui.editor.cursorUp": { defaults: ["up"], description: "Move cursor up", category: "Editor Movement" },
  "tui.editor.cursorDown": { defaults: ["down"], description: "Move cursor down", category: "Editor Movement" },
  "tui.editor.cursorLeft": { defaults: ["left", "ctrl+b"], description: "Move cursor left", category: "Editor Movement" },
  "tui.editor.cursorRight": { defaults: ["right", "ctrl+f"], description: "Move cursor right", category: "Editor Movement" },
  "tui.editor.cursorWordLeft": { defaults: ["alt+left", "ctrl+left", "alt+b"], description: "Move cursor word left", category: "Editor Movement" },
  "tui.editor.cursorWordRight": { defaults: ["alt+right", "ctrl+right", "alt+f"], description: "Move cursor word right", category: "Editor Movement" },
  "tui.editor.cursorLineStart": { defaults: ["home", "ctrl+a"], description: "Move to line start", category: "Editor Movement" },
  "tui.editor.cursorLineEnd": { defaults: ["end", "ctrl+e"], description: "Move to line end", category: "Editor Movement" },
  "tui.editor.jumpForward": { defaults: ["ctrl+]"], description: "Jump forward to character", category: "Editor Movement" },
  "tui.editor.jumpBackward": { defaults: ["ctrl+alt+]"], description: "Jump backward to character", category: "Editor Movement" },
  "tui.editor.pageUp": { defaults: ["pageUp"], description: "Scroll up by page", category: "Editor Movement" },
  "tui.editor.pageDown": { defaults: ["pageDown"], description: "Scroll down by page", category: "Editor Movement" },

  // TUI Editor Deletion
  "tui.editor.deleteCharBackward": { defaults: ["backspace"], description: "Delete character backward", category: "Editor Deletion" },
  "tui.editor.deleteCharForward": { defaults: ["delete", "ctrl+d"], description: "Delete character forward", category: "Editor Deletion" },
  "tui.editor.deleteWordBackward": { defaults: ["ctrl+w", "alt+backspace"], description: "Delete word backward", category: "Editor Deletion" },
  "tui.editor.deleteWordForward": { defaults: ["alt+d", "alt+delete"], description: "Delete word forward", category: "Editor Deletion" },
  "tui.editor.deleteToLineStart": { defaults: ["ctrl+u"], description: "Delete to line start", category: "Editor Deletion" },
  "tui.editor.deleteToLineEnd": { defaults: ["ctrl+k"], description: "Delete to line end", category: "Editor Deletion" },

  // TUI Input
  "tui.input.newLine": { defaults: ["shift+enter"], description: "Insert new line", category: "Input" },
  "tui.input.submit": { defaults: ["enter"], description: "Submit input", category: "Input" },
  "tui.input.tab": { defaults: ["tab"], description: "Tab / autocomplete", category: "Input" },
  "tui.input.copy": { defaults: ["ctrl+c"], description: "Copy selection", category: "Input" },

  // Kill Ring
  "tui.editor.yank": { defaults: ["ctrl+y"], description: "Paste most recently deleted text", category: "Kill Ring" },
  "tui.editor.yankPop": { defaults: ["alt+y"], description: "Cycle through deleted text after yank", category: "Kill Ring" },
  "tui.editor.undo": { defaults: ["ctrl+-"], description: "Undo last edit", category: "Kill Ring" },

  // Selection
  "tui.select.up": { defaults: ["up"], description: "Move selection up", category: "Selection" },
  "tui.select.down": { defaults: ["down"], description: "Move selection down", category: "Selection" },
  "tui.select.pageUp": { defaults: ["pageUp"], description: "Page up in list", category: "Selection" },
  "tui.select.pageDown": { defaults: ["pageDown"], description: "Page down in list", category: "Selection" },
  "tui.select.confirm": { defaults: ["enter"], description: "Confirm selection", category: "Selection" },
  "tui.select.cancel": { defaults: ["escape", "ctrl+c"], description: "Cancel selection", category: "Selection" },

  // Application
  "app.interrupt": { defaults: ["escape"], description: "Cancel / abort", category: "Application" },
  "app.clear": { defaults: ["ctrl+c"], description: "Clear editor", category: "Application" },
  "app.exit": { defaults: ["ctrl+d"], description: "Exit (when editor empty)", category: "Application" },
  "app.suspend": { defaults: ["ctrl+z"], description: "Suspend to background", category: "Application" },
  "app.editor.external": { defaults: ["ctrl+g"], description: "Open in external editor", category: "Application" },
  "app.clipboard.pasteImage": { defaults: ["ctrl+v"], description: "Paste image from clipboard", category: "Application" },

  // Sessions
  "app.session.tree": { defaults: [], description: "Open session tree navigator", category: "Sessions" },
  "app.session.fork": { defaults: [], description: "Fork current session", category: "Sessions" },
  "app.session.resume": { defaults: [], description: "Open session resume picker", category: "Sessions" },
  "app.session.togglePath": { defaults: ["ctrl+p"], description: "Toggle path display", category: "Sessions" },
  "app.session.toggleSort": { defaults: ["ctrl+s"], description: "Toggle sort mode", category: "Sessions" },
  "app.session.toggleNamedFilter": { defaults: ["ctrl+n"], description: "Toggle named-only filter", category: "Sessions" },
  "app.session.rename": { defaults: ["ctrl+r"], description: "Rename session", category: "Sessions" },
  "app.session.delete": { defaults: ["ctrl+d"], description: "Delete session", category: "Sessions" },

  // Models and Thinking
  "app.model.select": { defaults: ["ctrl+l"], description: "Open model selector", category: "Models & Thinking" },
  "app.model.cycleForward": { defaults: ["ctrl+p"], description: "Cycle to next model", category: "Models & Thinking" },
  "app.model.cycleBackward": { defaults: ["shift+ctrl+p"], description: "Cycle to previous model", category: "Models & Thinking" },
  "app.thinking.cycle": { defaults: ["shift+tab"], description: "Cycle thinking level", category: "Models & Thinking" },
  "app.thinking.toggle": { defaults: ["ctrl+t"], description: "Collapse/expand thinking blocks", category: "Models & Thinking" },

  // Display and Message Queue
  "app.tools.expand": { defaults: ["ctrl+o"], description: "Collapse/expand tool output", category: "Display" },
  "app.message.followUp": { defaults: ["alt+enter"], description: "Queue follow-up message", category: "Display" },
  "app.message.dequeue": { defaults: ["alt+up"], description: "Restore queued messages to editor", category: "Display" },

  // Tree Navigation
  "app.tree.foldOrUp": { defaults: ["ctrl+left", "alt+left"], description: "Fold branch or jump to previous segment", category: "Tree Navigation" },
  "app.tree.unfoldOrDown": { defaults: ["ctrl+right", "alt+right"], description: "Unfold branch or jump to next segment", category: "Tree Navigation" },
  "app.tree.editLabel": { defaults: ["shift+l"], description: "Edit label on selected tree node", category: "Tree Navigation" },
  "app.tree.toggleLabelTimestamp": { defaults: ["shift+t"], description: "Toggle label timestamps", category: "Tree Navigation" },
  "app.tree.filter.cycleForward": { defaults: ["ctrl+o"], description: "Cycle tree filter forward", category: "Tree Navigation" },
  "app.tree.filter.cycleBackward": { defaults: ["shift+ctrl+o"], description: "Cycle tree filter backward", category: "Tree Navigation" },

  // Scoped Models
  "app.models.save": { defaults: ["ctrl+s"], description: "Save model selection", category: "Scoped Models" },
  "app.models.enableAll": { defaults: ["ctrl+a"], description: "Enable all models", category: "Scoped Models" },
  "app.models.clearAll": { defaults: ["ctrl+x"], description: "Clear all models", category: "Scoped Models" },
  "app.models.toggleProvider": { defaults: ["ctrl+p"], description: "Toggle all models for provider", category: "Scoped Models" },
  "app.models.reorderUp": { defaults: ["alt+up"], description: "Move model up in cycle order", category: "Scoped Models" },
  "app.models.reorderDown": { defaults: ["alt+down"], description: "Move model down in cycle order", category: "Scoped Models" },
};

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function GET() {
  try {
    const home = homedir();
    const customPath = join(home, ".pi", "agent", "keybindings.json");

    let customBindings: Record<string, string | string[]> = {};
    if (await exists(customPath)) {
      try {
        customBindings = JSON.parse(await readFile(customPath, "utf-8"));
      } catch { /* skip */ }
    }

    const hotkeys: HotkeyEntry[] = [];

    for (const [id, info] of Object.entries(DEFAULT_KEYBINDINGS)) {
      const entry: HotkeyEntry = {
        id,
        defaults: info.defaults,
        description: info.description,
        category: info.category,
      };

      if (customBindings[id]) {
        const custom = customBindings[id];
        entry.custom = Array.isArray(custom) ? custom : [custom];
      }

      hotkeys.push(entry);
    }

    return NextResponse.json({
      hotkeys,
      hasCustomConfig: Object.keys(customBindings).length > 0,
      customConfigPath: customPath,
      categories: [...new Set(hotkeys.map((h) => h.category))],
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read hotkeys", details: String(error) },
      { status: 500 }
    );
  }
}
