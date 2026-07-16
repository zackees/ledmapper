// Named ShapeEditor method bundle: commands.
//
// A single command registry backs every surface that can trigger New /
// Load / Save As / Undo / Redo / Reset transforms / Load background image
// (header, the #443 "Choose a map" popover, the mobile action row + tools
// sheet, and the right-click context menu). Before this module each surface
// wired its own listener straight to the underlying method and tracked its
// own disabled state independently, so labels and enablement drifted
// between surfaces (issue #445). Every bound control now reads its label,
// shortcut-hint tooltip, and disabled state from the same `EditorCommand`
// object, and a single `refreshCommandStates()` call keeps every bound
// control in sync.
import type { ShapeEditor } from './shapeeditor-class';

export type CommandId = 'new' | 'load' | 'save-as' | 'undo' | 'redo' | 'reset-transforms' | 'load-image';

export interface EditorCommand {
    id: CommandId;
    label: string;
    /** Human-readable shortcut hint, e.g. "Ctrl+Z" — appended to the tooltip. */
    shortcut?: string;
    isEnabled: () => boolean;
    run: () => void;
}

interface BoundCommandControl {
    id: CommandId;
    el: HTMLButtonElement;
}

export interface CommandRegistry {
    register: (command: EditorCommand) => void;
    get: (id: CommandId) => EditorCommand;
    isEnabled: (id: CommandId) => boolean;
    /** Runs the command's `run()` iff it is currently enabled. */
    run: (id: CommandId) => void;
    /** Wires click -> run(id), sets the initial tooltip/disabled state, and
     *  registers the control so future refresh() calls keep it in sync. */
    bind: (id: CommandId, el: HTMLButtonElement, signal?: AbortSignal) => void;
    /** Re-applies every bound control's disabled + tooltip state from its
     *  command's current isEnabled()/label/shortcut. */
    refresh: () => void;
}

function tooltipFor(command: EditorCommand): string {
    return command.shortcut ? `${command.label} (${command.shortcut})` : command.label;
}

export function createCommandRegistry(): CommandRegistry {
    const commands = new Map<CommandId, EditorCommand>();
    const controls: BoundCommandControl[] = [];

    const get = (id: CommandId): EditorCommand => {
        const command = commands.get(id);
        if (!command) throw new Error(`Unknown editor command "${id}"`);
        return command;
    };

    const applyControl = (control: BoundCommandControl): void => {
        const command = commands.get(control.id);
        if (!command) return;
        control.el.disabled = !command.isEnabled();
        control.el.title = tooltipFor(command);
    };

    const registry: CommandRegistry = {
        register(command) {
            commands.set(command.id, command);
        },
        get,
        isEnabled(id) {
            return get(id).isEnabled();
        },
        run(id) {
            const command = get(id);
            if (command.isEnabled()) command.run();
        },
        bind(id, el, signal) {
            const control: BoundCommandControl = { id, el };
            controls.push(control);
            el.addEventListener('click', () => { registry.run(id); }, signal ? { signal } : undefined);
            applyControl(control);
        },
        refresh() {
            for (const control of controls) applyControl(control);
        },
    };
    return registry;
}

export interface EditorCommandsMethods {
    bindCommand: (id: CommandId, el: HTMLButtonElement) => void;
    refreshCommandStates: () => void;
}

export const editorCommandsMethods: EditorCommandsMethods & ThisType<ShapeEditor> = {
    bindCommand(this: ShapeEditor, id: CommandId, el: HTMLButtonElement){

        this.commandRegistry.bind(id, el, this.signal);
    },
    refreshCommandStates(this: ShapeEditor){

        this.commandRegistry.refresh();
    },
};
