import { zodToJsonSchema } from '../utils/zod-to-json.js';

import {
  ElectronAccessibilitySnapshotInputSchema,
  ElectronCloseInputSchema,
  ElectronConsoleTailInputSchema,
  ElectronDialogPolicyInputSchema,
  ElectronFillInputSchema,
  ElectronFocusWindowInputSchema,
  ElectronHoverInputSchema,
  ElectronLaunchInputSchema,
  ElectronListWindowsInputSchema,
  ElectronNetworkTailInputSchema,
  ElectronPressInputSchema,
  ElectronRestartInputSchema,
  ElectronScreenshotInputSchema,
  ElectronSelectOptionInputSchema,
  ElectronTraceStartInputSchema,
  ElectronTraceStopInputSchema,
  ElectronWaitForNewWindowInputSchema,
  ElectronWaitForSelectorInputSchema,
  ElectronWaitForWindowInputSchema,
  ElectronClickInputSchema,
  ElectronEvaluateMainInputSchema,
  ElectronEvaluateRendererInputSchema,
} from '../schemas/index.js';

import { electronConsoleTail } from './console.js';
import { electronDialogPolicy } from './dialogs.js';
import {
  electronClose,
  electronLaunch,
  electronListSessions,
  electronRestart,
} from './lifecycle.js';
import { electronEvaluateMain } from './main.js';
import { electronNetworkTail } from './network.js';
import {
  electronAccessibilitySnapshot,
  electronClick,
  electronEvaluateRenderer,
  electronFill,
  electronHover,
  electronPress,
  electronScreenshot,
  electronSelectOption,
  electronWaitForSelector,
} from './renderer.js';
import { electronTraceStart, electronTraceStop } from './tracing.js';
import type { ToolContext, ToolHandler } from './types.js';
import {
  electronFocusWindow,
  electronListWindows,
  electronWaitForNewWindow,
  electronWaitForWindow,
} from './windows.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler<unknown, unknown>;
}

/**
 * The authoritative tool registry. Names and ordering match the README.
 * Each entry pairs a JSON-schema advertised to MCP clients with the
 * async handler invoked when the tool is called.
 */
export function buildToolRegistry(): ToolDefinition[] {
  return [
    /* ---------------- Lifecycle ---------------- */
    {
      name: 'electron_launch',
      description:
        'Launch an Electron application via Playwright and return a session handle. ' +
        'Accepts an executable path, optional CLI args, env, cwd, and launch timeout.',
      inputSchema: zodToJsonSchema(ElectronLaunchInputSchema),
      handler: electronLaunch as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_close',
      description:
        'Close an active Electron session. Pass `force: true` to kill the process if ' +
        'graceful shutdown stalls.',
      inputSchema: zodToJsonSchema(ElectronCloseInputSchema),
      handler: electronClose as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_restart',
      description:
        'Close and relaunch an existing session using the same executable path and args.',
      inputSchema: zodToJsonSchema(ElectronRestartInputSchema),
      handler: electronRestart as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_list_sessions',
      description:
        'List every active Electron session, including status, labels, and window counts.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (async (_input: unknown, ctx: ToolContext) =>
        electronListSessions(undefined, ctx)) as ToolHandler<unknown, unknown>,
    },

    /* ---------------- Windows ---------------- */
    {
      name: 'electron_list_windows',
      description: 'Enumerate every window in a session with its title, URL, and close state.',
      inputSchema: zodToJsonSchema(ElectronListWindowsInputSchema),
      handler: electronListWindows as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_focus_window',
      description:
        'Bring a specific window to front. Window can be an index, URL substring, or title substring.',
      inputSchema: zodToJsonSchema(ElectronFocusWindowInputSchema),
      handler: electronFocusWindow as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_wait_for_window',
      description:
        'Wait until a window matching a URL/title pattern (or a specific index) is available.',
      inputSchema: zodToJsonSchema(ElectronWaitForWindowInputSchema),
      handler: electronWaitForWindow as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_wait_for_new_window',
      description:
        'Wait until a NEW window appears in the session (e.g. modal/popup opened by user action). ' +
        'Optional URL/title filters. Returns the new window descriptor (index, url, title).',
      inputSchema: zodToJsonSchema(ElectronWaitForNewWindowInputSchema),
      handler: electronWaitForNewWindow as unknown as ToolHandler<unknown, unknown>,
    },

    /* ---------------- Renderer ---------------- */
    {
      name: 'electron_click',
      description: 'Click a DOM element in a renderer window using a CSS/Playwright selector.',
      inputSchema: zodToJsonSchema(ElectronClickInputSchema),
      handler: electronClick as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_fill',
      description: 'Fill an input or textarea with a value (replaces existing content).',
      inputSchema: zodToJsonSchema(ElectronFillInputSchema),
      handler: electronFill as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_evaluate_renderer',
      description:
        'Evaluate a JavaScript expression or function body in the renderer context of ' +
        'a window. Result must be JSON-serializable.',
      inputSchema: zodToJsonSchema(ElectronEvaluateRendererInputSchema),
      handler: electronEvaluateRenderer as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_screenshot',
      description:
        'Capture a screenshot of a window. Saves to a path if provided, otherwise returns base64.',
      inputSchema: zodToJsonSchema(ElectronScreenshotInputSchema),
      handler: electronScreenshot as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_wait_for_selector',
      description:
        'Wait until an element matching a selector reaches a state (visible | hidden | attached | ' +
        'detached). Replaces ad-hoc sleep loops. Returns {matched:true} on success, or throws a ' +
        'SelectorError on timeout.',
      inputSchema: zodToJsonSchema(ElectronWaitForSelectorInputSchema),
      handler: electronWaitForSelector as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_accessibility_snapshot',
      description:
        'Return the accessibility tree for a window (or element rooted at a selector). ' +
        'Compact text tree of roles/names/values — designed for LLM agents to reason about UI ' +
        'state without screenshots. interestingOnly defaults to true (Playwright default).',
      inputSchema: zodToJsonSchema(ElectronAccessibilitySnapshotInputSchema),
      handler: electronAccessibilitySnapshot as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_console_tail',
      description:
        'Drain up to N recent entries from the session ring buffer of renderer console + page ' +
        'errors. Optional level and regex pattern filters. Set drain:true to remove the returned ' +
        'entries from the buffer so subsequent tails only see new messages.',
      inputSchema: zodToJsonSchema(ElectronConsoleTailInputSchema),
      handler: electronConsoleTail as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_hover',
      description: 'Move the mouse over an element to reveal tooltips, submenus, or hover-only UI.',
      inputSchema: zodToJsonSchema(ElectronHoverInputSchema),
      handler: electronHover as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_press',
      description:
        'Send a keyboard key (or modifier+key combo like "Meta+K", "Control+Shift+P") to the ' +
        'focused element. If a selector is given, focus it first. Use for keyboard shortcuts, ' +
        'Escape, Tab navigation, Enter submissions.',
      inputSchema: zodToJsonSchema(ElectronPressInputSchema),
      handler: electronPress as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_select_option',
      description:
        'Select one or more options in a <select> element. Pick by value, label, or index. ' +
        'Returns the values of the selected option(s).',
      inputSchema: zodToJsonSchema(ElectronSelectOptionInputSchema),
      handler: electronSelectOption as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_dialog_policy',
      description:
        'Set the session-wide policy for browser alert/confirm/prompt dialogs. Policies: accept ' +
        '(always accept, using promptText for prompts), dismiss (always dismiss), auto (accept ' +
        'alerts, dismiss everything else), none (leave dialogs pending). Applies to current and ' +
        'future windows.',
      inputSchema: zodToJsonSchema(ElectronDialogPolicyInputSchema),
      handler: electronDialogPolicy as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_network_tail',
      description:
        'Drain up to N recent HTTP request/response entries captured by the session ring buffer. ' +
        'Supports urlPattern (regex), status-list, onlyFailures, and drain semantics. Captures ' +
        'method, status, resourceType, duration, and approximate body sizes.',
      inputSchema: zodToJsonSchema(ElectronNetworkTailInputSchema),
      handler: electronNetworkTail as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_trace_start',
      description:
        'Start Playwright tracing for this session. Captures screenshots, snapshots, and ' +
        'optionally sources. Pair with electron_trace_stop to write a .zip viewable via ' +
        '`playwright show-trace`.',
      inputSchema: zodToJsonSchema(ElectronTraceStartInputSchema),
      handler: electronTraceStart as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_trace_stop',
      description:
        'Stop Playwright tracing and write the trace bundle to `path` (absolute).',
      inputSchema: zodToJsonSchema(ElectronTraceStopInputSchema),
      handler: electronTraceStop as unknown as ToolHandler<unknown, unknown>,
    },

    /* ---------------- Main process ---------------- */
    {
      name: 'electron_evaluate_main',
      description:
        'Evaluate a function body in the Electron main process. The function receives the ' +
        'Electron module as its first argument. Disabled by default for safety.',
      inputSchema: zodToJsonSchema(ElectronEvaluateMainInputSchema),
      handler: electronEvaluateMain as unknown as ToolHandler<unknown, unknown>,
    },
  ];
}

export type { ToolContext } from './types.js';
