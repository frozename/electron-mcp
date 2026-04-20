import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const SessionIdSchema = z.string().min(1).describe('Opaque session identifier');

export const WindowRefSchema = z
  .union([
    z.number().int().nonnegative().describe('Window index (0-based)'),
    z.string().min(1).describe('Window URL, title pattern, or stable id'),
  ])
  .describe('Reference to a specific window in a session');

export const TimeoutSchema = z
  .number()
  .int()
  .positive()
  .max(300_000)
  .optional()
  .describe('Override timeout in milliseconds (max 5 min)');

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export const ElectronLaunchInputSchema = z.object({
  executablePath: z
    .string()
    .min(1)
    .describe('Absolute path to the Electron binary or app entry point'),
  args: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Command-line arguments passed to Electron'),
  cwd: z.string().optional().describe('Working directory for the launched process'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables merged with the current process env'),
  userDataDir: z
    .string()
    .optional()
    .describe(
      'Directory to pass via Electron\'s --user-data-dir flag. If omitted, ' +
        'a fresh tmp dir is minted for the session and removed on close. If a ' +
        'SingletonLock from an active process is detected, a tmp dir is ' +
        'substituted (unless strictUserDataDir is true).',
    ),
  strictUserDataDir: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, fail fast with launch_error if the provided userDataDir is ' +
        'locked by another Electron process. When false (default), substitute ' +
        'a fresh tmp dir and echo the replaced path via replacedLockedDir.',
    ),
  timeout: TimeoutSchema,
  recordVideoDir: z
    .string()
    .optional()
    .describe('Directory for Playwright-recorded videos (optional)'),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
  label: z
    .string()
    .max(80)
    .optional()
    .describe('Human-friendly label stored with the session (for listings/logs)'),
});
export type ElectronLaunchInput = z.infer<typeof ElectronLaunchInputSchema>;

export const ElectronLaunchOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  label: z.string().optional(),
  status: z.string(),
  startedAt: z.string(),
  windowCount: z.number().int().nonnegative(),
  userDataDir: z
    .string()
    .describe('Resolved --user-data-dir value used for this launch.'),
  autoTmp: z
    .boolean()
    .describe('True when userDataDir was auto-minted as a tmp dir by the server.'),
  replacedLockedDir: z
    .string()
    .optional()
    .describe(
      'Present when the caller-supplied userDataDir was locked and the server ' +
        'substituted a tmp dir. Holds the original locked path for visibility.',
    ),
});
export type ElectronLaunchOutput = z.infer<typeof ElectronLaunchOutputSchema>;

export const ElectronCloseInputSchema = z.object({
  sessionId: SessionIdSchema,
  force: z.boolean().optional().default(false).describe('Kill the process if graceful close fails'),
});
export type ElectronCloseInput = z.infer<typeof ElectronCloseInputSchema>;

export const ElectronCloseOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  closed: z.boolean(),
});
export type ElectronCloseOutput = z.infer<typeof ElectronCloseOutputSchema>;

export const ElectronRestartInputSchema = z.object({
  sessionId: SessionIdSchema,
  timeout: TimeoutSchema,
});
export type ElectronRestartInput = z.infer<typeof ElectronRestartInputSchema>;

export const ElectronListSessionsOutputSchema = z.object({
  ok: z.literal(true),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      label: z.string().optional(),
      status: z.string(),
      executablePath: z.string(),
      startedAt: z.string(),
      lastUsedAt: z.string(),
      windowCount: z.number().int().nonnegative(),
    }),
  ),
});
export type ElectronListSessionsOutput = z.infer<typeof ElectronListSessionsOutputSchema>;

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

export const ElectronListWindowsInputSchema = z.object({
  sessionId: SessionIdSchema,
});
export type ElectronListWindowsInput = z.infer<typeof ElectronListWindowsInputSchema>;

export const WindowDescriptorSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string(),
  url: z.string(),
  isClosed: z.boolean(),
});
export type WindowDescriptor = z.infer<typeof WindowDescriptorSchema>;

export const ElectronListWindowsOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  windows: z.array(WindowDescriptorSchema),
});
export type ElectronListWindowsOutput = z.infer<typeof ElectronListWindowsOutputSchema>;

export const ElectronFocusWindowInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema,
});
export type ElectronFocusWindowInput = z.infer<typeof ElectronFocusWindowInputSchema>;

export const ElectronWaitForWindowInputSchema = z.object({
  sessionId: SessionIdSchema,
  urlPattern: z
    .string()
    .optional()
    .describe('Substring or regex (as string) to match in window URL'),
  titlePattern: z
    .string()
    .optional()
    .describe('Substring or regex (as string) to match in window title'),
  index: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Wait until a window with this index exists'),
  timeout: TimeoutSchema,
});
export type ElectronWaitForWindowInput = z.infer<typeof ElectronWaitForWindowInputSchema>;

/* ------------------------------------------------------------------ */
/* Renderer interactions                                               */
/* ------------------------------------------------------------------ */

export const ElectronClickInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional().describe('Defaults to the focused / first window'),
  selector: z.string().min(1),
  button: z.enum(['left', 'right', 'middle']).optional().default('left'),
  clickCount: z.number().int().min(1).max(3).optional().default(1),
  delay: z.number().int().nonnegative().optional().describe('Delay between mousedown/up (ms)'),
  force: z.boolean().optional().default(false),
  timeout: TimeoutSchema,
});
export type ElectronClickInput = z.infer<typeof ElectronClickInputSchema>;

export const ElectronFillInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  selector: z.string().min(1),
  value: z.string(),
  timeout: TimeoutSchema,
});
export type ElectronFillInput = z.infer<typeof ElectronFillInputSchema>;

export const ElectronEvaluateRendererInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  expression: z
    .string()
    .min(1)
    .describe(
      'JavaScript expression or function body evaluated in the renderer context. Must return a JSON-serializable value.',
    ),
  arg: z
    .unknown()
    .optional()
    .describe('Optional argument (JSON-serializable) passed to the function body'),
  timeout: TimeoutSchema,
});
export type ElectronEvaluateRendererInput = z.infer<typeof ElectronEvaluateRendererInputSchema>;

export const ElectronScreenshotInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  fullPage: z.boolean().optional().default(false),
  path: z
    .string()
    .optional()
    .describe('Write screenshot to this path. If omitted, returns base64.'),
  type: z.enum(['png', 'jpeg']).optional().default('png'),
  quality: z.number().int().min(0).max(100).optional().describe('JPEG quality (ignored for PNG)'),
  timeout: TimeoutSchema,
});
export type ElectronScreenshotInput = z.infer<typeof ElectronScreenshotInputSchema>;

export const ElectronScreenshotOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  path: z.string().optional(),
  base64: z.string().optional(),
  byteLength: z.number().int().nonnegative(),
  type: z.enum(['png', 'jpeg']),
});
export type ElectronScreenshotOutput = z.infer<typeof ElectronScreenshotOutputSchema>;

/* ------------------------------------------------------------------ */
/* Wait for selector                                                   */
/* ------------------------------------------------------------------ */

export const WaitForSelectorStateSchema = z
  .enum(['attached', 'detached', 'visible', 'hidden'])
  .describe(
    'attached: element is in DOM. detached: element leaves DOM. visible: rendered & non-empty box. hidden: not visible or detached.',
  );

export const ElectronWaitForSelectorInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  selector: z.string().min(1),
  state: WaitForSelectorStateSchema.optional().default('visible'),
  timeout: TimeoutSchema,
});
export type ElectronWaitForSelectorInput = z.infer<typeof ElectronWaitForSelectorInputSchema>;

export const ElectronWaitForSelectorOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  state: WaitForSelectorStateSchema,
  matched: z.boolean(),
});
export type ElectronWaitForSelectorOutput = z.infer<typeof ElectronWaitForSelectorOutputSchema>;

/* ------------------------------------------------------------------ */
/* Hover                                                               */
/* ------------------------------------------------------------------ */

export const ElectronHoverInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  selector: z.string().min(1),
  force: z.boolean().optional().default(false),
  timeout: TimeoutSchema,
});
export type ElectronHoverInput = z.infer<typeof ElectronHoverInputSchema>;

/* ------------------------------------------------------------------ */
/* Keyboard press                                                      */
/* ------------------------------------------------------------------ */

export const ElectronPressInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  selector: z
    .string()
    .optional()
    .describe('Optional — focus this selector before sending the key.'),
  key: z
    .string()
    .min(1)
    .describe(
      'Playwright key string. Single key ("Enter", "Escape", "Tab", "ArrowDown") ' +
        'or modifier combos joined by "+" ("Meta+K", "Control+Shift+P").',
    ),
  delay: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Delay between keydown and keyup in ms.'),
  timeout: TimeoutSchema,
});
export type ElectronPressInput = z.infer<typeof ElectronPressInputSchema>;

/* ------------------------------------------------------------------ */
/* Select option                                                       */
/* ------------------------------------------------------------------ */

export const ElectronSelectOptionInputSchema = z
  .object({
    sessionId: SessionIdSchema,
    window: WindowRefSchema.optional(),
    selector: z.string().min(1).describe('CSS selector for the <select> element.'),
    value: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Pick option(s) by `value` attribute.'),
    label: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Pick option(s) by visible label.'),
    index: z
      .union([z.number().int().nonnegative(), z.array(z.number().int().nonnegative())])
      .optional()
      .describe('Pick option(s) by zero-based index.'),
    timeout: TimeoutSchema,
  })
  .refine(
    (v) => v.value !== undefined || v.label !== undefined || v.index !== undefined,
    { message: 'One of value, label, or index is required' },
  );
export type ElectronSelectOptionInput = z.infer<typeof ElectronSelectOptionInputSchema>;

export const ElectronSelectOptionOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  selected: z.array(z.string()).describe('The option values that were selected.'),
});
export type ElectronSelectOptionOutput = z.infer<typeof ElectronSelectOptionOutputSchema>;

/* ------------------------------------------------------------------ */
/* Dialog policy                                                       */
/* ------------------------------------------------------------------ */

export const DialogPolicyKindSchema = z
  .enum(['accept', 'dismiss', 'auto', 'none'])
  .describe(
    'accept: auto-accept every alert/confirm/prompt. dismiss: auto-dismiss everything. ' +
      'auto: accept alerts, dismiss confirm/prompt (safer default). none: clear policy — dialogs ' +
      'will block the page until a user dismisses them.',
  );

export const ElectronDialogPolicyInputSchema = z.object({
  sessionId: SessionIdSchema,
  policy: DialogPolicyKindSchema,
  promptText: z
    .string()
    .optional()
    .describe('Text to supply when accepting prompt() dialogs.'),
});
export type ElectronDialogPolicyInput = z.infer<typeof ElectronDialogPolicyInputSchema>;

export const ElectronDialogPolicyOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  policy: DialogPolicyKindSchema,
  handled: z.number().int().nonnegative().describe('Total dialogs handled since the session started.'),
});
export type ElectronDialogPolicyOutput = z.infer<typeof ElectronDialogPolicyOutputSchema>;

/* ------------------------------------------------------------------ */
/* Accessibility snapshot                                              */
/* ------------------------------------------------------------------ */

export const ElectronAccessibilitySnapshotInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  interestingOnly: z
    .boolean()
    .optional()
    .default(true)
    .describe('Prune uninteresting nodes (Playwright default). false = full tree.'),
  root: z
    .string()
    .optional()
    .describe('Optional CSS selector. If set, snapshot is rooted at this element.'),
  timeout: TimeoutSchema,
});
export type ElectronAccessibilitySnapshotInput = z.infer<
  typeof ElectronAccessibilitySnapshotInputSchema
>;

export const AccessibilityNodeSchema: z.ZodType<AccessibilityNode> = z.lazy(() =>
  z.object({
    role: z.string(),
    name: z.string().optional(),
    value: z.union([z.string(), z.number()]).optional(),
    description: z.string().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    selected: z.boolean().optional(),
    disabled: z.boolean().optional(),
    expanded: z.boolean().optional(),
    focused: z.boolean().optional(),
    level: z.number().optional(),
    children: z.array(AccessibilityNodeSchema).optional(),
  }),
);
export interface AccessibilityNode {
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  checked?: boolean | 'mixed';
  selected?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  level?: number;
  children?: AccessibilityNode[];
}

export const ElectronAccessibilitySnapshotOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  tree: AccessibilityNodeSchema.nullable(),
});
export type ElectronAccessibilitySnapshotOutput = z.infer<
  typeof ElectronAccessibilitySnapshotOutputSchema
>;

/* ------------------------------------------------------------------ */
/* Network tail                                                        */
/* ------------------------------------------------------------------ */

export const NetworkEntrySchema = z.object({
  ts: z.string().describe('ISO timestamp when the response/failure completed.'),
  method: z.string(),
  url: z.string(),
  status: z.number().int().optional(),
  statusText: z.string().optional(),
  resourceType: z.string().optional().describe('document, fetch, xhr, script, image, etc.'),
  fromCache: z.boolean().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  requestSizeBytes: z.number().int().nonnegative().optional(),
  responseSizeBytes: z.number().int().nonnegative().optional(),
  failed: z.boolean().optional(),
  failureText: z.string().optional(),
  windowIndex: z.number().int().nonnegative().optional(),
});
export type NetworkEntry = z.infer<typeof NetworkEntrySchema>;

export const ElectronNetworkTailInputSchema = z.object({
  sessionId: SessionIdSchema,
  limit: z.number().int().positive().max(1000).optional().default(100),
  urlPattern: z
    .string()
    .optional()
    .describe('Regex filter applied to request URL. Case-sensitive.'),
  status: z
    .array(z.number().int().min(100).max(599))
    .optional()
    .describe('Only keep entries whose status is in this list.'),
  onlyFailures: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, only entries with status >= 400 or failed=true.'),
  drain: z
    .boolean()
    .optional()
    .default(false)
    .describe('Remove returned entries from the buffer.'),
});
export type ElectronNetworkTailInput = z.infer<typeof ElectronNetworkTailInputSchema>;

export const ElectronNetworkTailOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  entries: z.array(NetworkEntrySchema),
  dropped: z.number().int().nonnegative(),
  bufferSize: z.number().int().nonnegative(),
});
export type ElectronNetworkTailOutput = z.infer<typeof ElectronNetworkTailOutputSchema>;

/* ------------------------------------------------------------------ */
/* Wait for new window                                                 */
/* ------------------------------------------------------------------ */

export const ElectronWaitForNewWindowInputSchema = z.object({
  sessionId: SessionIdSchema,
  urlPattern: z.string().optional(),
  titlePattern: z.string().optional(),
  timeout: TimeoutSchema,
});
export type ElectronWaitForNewWindowInput = z.infer<typeof ElectronWaitForNewWindowInputSchema>;

export const ElectronWaitForNewWindowOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  window: WindowDescriptorSchema,
});
export type ElectronWaitForNewWindowOutput = z.infer<typeof ElectronWaitForNewWindowOutputSchema>;

/* ------------------------------------------------------------------ */
/* Tracing                                                             */
/* ------------------------------------------------------------------ */

export const ElectronTraceStartInputSchema = z.object({
  sessionId: SessionIdSchema,
  screenshots: z.boolean().optional().default(true),
  snapshots: z.boolean().optional().default(true),
  sources: z.boolean().optional().default(false),
  title: z.string().optional().describe('Short label stored in the trace metadata.'),
});
export type ElectronTraceStartInput = z.infer<typeof ElectronTraceStartInputSchema>;

export const ElectronTraceStartOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  tracing: z.literal(true),
});
export type ElectronTraceStartOutput = z.infer<typeof ElectronTraceStartOutputSchema>;

export const ElectronTraceStopInputSchema = z.object({
  sessionId: SessionIdSchema,
  path: z.string().describe('Absolute path for the trace .zip.'),
});
export type ElectronTraceStopInput = z.infer<typeof ElectronTraceStopInputSchema>;

export const ElectronTraceStopOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  path: z.string(),
  byteLength: z.number().int().nonnegative(),
});
export type ElectronTraceStopOutput = z.infer<typeof ElectronTraceStopOutputSchema>;

/* ------------------------------------------------------------------ */
/* Console tail                                                        */
/* ------------------------------------------------------------------ */

export const ConsoleEntrySchema = z.object({
  ts: z.string().describe('ISO timestamp when the entry was captured.'),
  kind: z.enum(['console', 'pageerror']),
  level: z
    .enum(['log', 'debug', 'info', 'warning', 'error', 'trace', 'dir', 'table', 'clear'])
    .optional()
    .describe('Playwright console-message type. Absent for pageerror.'),
  text: z.string(),
  windowIndex: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;

export const ElectronConsoleTailInputSchema = z.object({
  sessionId: SessionIdSchema,
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .default(100)
    .describe('Max entries to return (most recent).'),
  level: z
    .array(z.enum(['log', 'debug', 'info', 'warning', 'error']))
    .optional()
    .describe('Filter by console level. Omit to include every level.'),
  pattern: z
    .string()
    .optional()
    .describe('Regex (string) to filter entries by text. Case-sensitive.'),
  drain: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, clear the returned entries from the ring buffer.'),
});
export type ElectronConsoleTailInput = z.infer<typeof ElectronConsoleTailInputSchema>;

export const ElectronConsoleTailOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  entries: z.array(ConsoleEntrySchema),
  dropped: z
    .number()
    .int()
    .nonnegative()
    .describe('Count of entries evicted by the ring buffer since session start.'),
  bufferSize: z.number().int().nonnegative(),
});
export type ElectronConsoleTailOutput = z.infer<typeof ElectronConsoleTailOutputSchema>;

/* ------------------------------------------------------------------ */
/* Main process                                                        */
/* ------------------------------------------------------------------ */

export const ElectronEvaluateMainInputSchema = z.object({
  sessionId: SessionIdSchema,
  expression: z
    .string()
    .min(1)
    .describe(
      'JavaScript function body executed in the Electron main process. Receives the Electron module as its first argument.',
    ),
  arg: z.unknown().optional().describe('Optional JSON-serializable argument'),
  timeout: TimeoutSchema,
});
export type ElectronEvaluateMainInput = z.infer<typeof ElectronEvaluateMainInputSchema>;

/* ------------------------------------------------------------------ */
/* Screenshot diff                                                     */
/* ------------------------------------------------------------------ */

export const ScreenshotDiffInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  /** Optional CSS selector to scope the screenshot; else full viewport. */
  selector: z
    .string()
    .optional()
    .describe('CSS/Playwright selector to scope the screenshot to an element.'),
  /** Baseline file path. When absent + updateBaseline=false → ok:false. */
  baselinePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the baseline PNG. Caller-supplied so baselines do not leak across sessions.',
    ),
  /** Write the current screenshot to baselinePath and return ok:true. */
  updateBaseline: z
    .boolean()
    .optional()
    .default(false)
    .describe('Overwrite the baseline with the current screenshot and return ok:true.'),
  /** Pixel diff threshold [0,1] — ratio of changed pixels tolerated. */
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.01)
    .describe('Max ratio of changed pixels tolerated before ok becomes false.'),
  /** Per-pixel color distance threshold, [0,255]. Default 0 = exact. */
  pixelThreshold: z
    .number()
    .min(0)
    .max(255)
    .optional()
    .default(0)
    .describe('Per-pixel color distance tolerance (0 = exact match).'),
  /** Write the diff image to this path (omit to skip). */
  diffPath: z
    .string()
    .optional()
    .describe('If set and diffs are detected, write the diff PNG to this absolute path.'),
  /** Optional absolute path for the current screenshot; otherwise tmp. */
  currentPath: z
    .string()
    .optional()
    .describe('Absolute path to write the current screenshot to. A tmp file is used when omitted.'),
  /** Include the entire scroll-height of the page (selector-less mode only). */
  fullPage: z
    .boolean()
    .optional()
    .default(false)
    .describe('Capture the full scrollable page. Ignored when `selector` is set.'),
  timeout: TimeoutSchema,
});
export type ScreenshotDiffInput = z.infer<typeof ScreenshotDiffInputSchema>;

export const ScreenshotDiffOutputSchema = z.object({
  ok: z.boolean(),
  sessionId: z.string(),
  baselineExists: z
    .boolean()
    .describe('True if the baseline existed BEFORE this call (always false when updateBaseline=true).'),
  diffPixels: z.number().int().nonnegative(),
  totalPixels: z.number().int().nonnegative(),
  diffRatio: z.number().min(0).max(1),
  thresholdBreached: z.boolean(),
  wroteBaseline: z
    .string()
    .optional()
    .describe('Set when updateBaseline=true — echoes the baseline path written.'),
  wroteDiff: z
    .string()
    .optional()
    .describe('Set when diffPath was supplied AND diffs were detected.'),
  currentPath: z
    .string()
    .describe('Path to the current screenshot on disk. A tmp file when none was supplied.'),
  message: z
    .string()
    .optional()
    .describe('Human-readable note when ok:false (e.g. baseline missing, size mismatch).'),
});
export type ScreenshotDiffOutput = z.infer<typeof ScreenshotDiffOutputSchema>;

/* ------------------------------------------------------------------ */
/* Assert visible text                                                 */
/* ------------------------------------------------------------------ */

export const AssertVisibleTextInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  /** Exact substring or a regex pattern. Default: substring match. */
  text: z
    .string()
    .min(1)
    .describe('Literal substring (default) or a JavaScript RegExp source when `regex` is true.'),
  /** Treat `text` as a RegExp pattern (JS syntax, no flags). */
  regex: z
    .boolean()
    .optional()
    .default(false)
    .describe('Interpret `text` as a RegExp source (no flags are applied).'),
  /** Scope the search to a subtree. */
  selector: z
    .string()
    .optional()
    .describe('Optional CSS selector that scopes the search to a subtree.'),
  /** Include hidden elements (CSS visibility:hidden, display:none, aria-hidden). */
  includeHidden: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, match hidden elements too (no visibility filtering).'),
  /** Wait up to this many ms for the text to appear before failing. */
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(30_000)
    .optional()
    .default(5_000)
    .describe('Polling deadline in ms. 0 means a single immediate check.'),
});
export type AssertVisibleTextInput = z.infer<typeof AssertVisibleTextInputSchema>;

export const AssertVisibleTextNearestMatchSchema = z.object({
  locator: z.string(),
  text: z.string(),
});
export type AssertVisibleTextNearestMatch = z.infer<typeof AssertVisibleTextNearestMatchSchema>;

export const AssertVisibleTextOutputSchema = z.object({
  ok: z.boolean(),
  sessionId: z.string(),
  /** First matched element's locator path (best-effort). */
  locator: z
    .string()
    .optional()
    .describe('Short path-based selector for the first match (best-effort).'),
  /** Matched text (exact extract from the DOM). */
  matchedText: z
    .string()
    .optional()
    .describe('The exact text content of the matched element.'),
  /** When ok:false, up to 3 closest matches to help debug. */
  nearestMatches: z
    .array(AssertVisibleTextNearestMatchSchema)
    .optional()
    .describe('Up to 3 nearest text candidates when the assertion fails.'),
  elapsedMs: z.number().int().nonnegative(),
  message: z.string().optional().describe('Human-readable note when ok:false.'),
});
export type AssertVisibleTextOutput = z.infer<typeof AssertVisibleTextOutputSchema>;

/* ------------------------------------------------------------------ */
/* Generic evaluate response                                           */
/* ------------------------------------------------------------------ */

export const EvaluateOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  result: z.unknown(),
});
export type EvaluateOutput = z.infer<typeof EvaluateOutputSchema>;

/* ------------------------------------------------------------------ */
/* Generic OK response                                                 */
/* ------------------------------------------------------------------ */

export const OkWithSessionSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
});
export type OkWithSession = z.infer<typeof OkWithSessionSchema>;
