import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  readMainModule,
  readMainSource,
  readSharedTypesSource,
  readStoreSource,
} from "./helpers/source-contracts.mjs";

const read = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const sidebarSource = await read("src/components/Sidebar.tsx");
const shellRuntimeSource = await read("src/features/app/useAppShellRuntime.tsx");
const apiSource = await read("src/lib/api.ts");
const protocolSource = await read("../../packages/shared/src/protocol.ts");
const sharedTypes = await readSharedTypesSource();
const storeSource = await readStoreSource();
const mainSource = await readMainSource();
const scheduledRunnerSource = await readMainModule("runtime/scheduled-runner.ts");
const plansSource = await readMainModule("runtime/plans.ts");

test("a project row derives its status from state the renderer already holds", () => {
  const aggregateCall = sidebarSource.match(/projectRunningStatus\(\{[\s\S]*?\n {4}\}\);/)?.[0] ?? "";
  assert.match(aggregateCall, /sessions: entry\.sessions/);
  assert.match(aggregateCall, /allSessions: sessions/, "automation transcripts stay out of entry.sessions");
  assert.match(aggregateCall, /runningSessions,/);
  assert.match(aggregateCall, /outcomes: sessionOutcomes,/);
  assert.match(aggregateCall, /scheduledRuns: Object\.values\(scheduledRuns\)/);

  // Waiting for the reader covers every interactive prompt, not just permissions.
  const attentionBlock = sidebarSource.match(
    /const attentionSessionIds = useMemo\([\s\S]*?\n {2}\}, \[/,
  )?.[0] ?? "";
  assert.match(attentionBlock, /pendingPermissions/);
  assert.match(attentionBlock, /pendingAsks/);
  assert.match(attentionBlock, /pendingPlans/);
  assert.doesNotMatch(attentionBlock, /pendingApproval\w*\.length > 0 \? 1 : 0/);
});

test("the project status control is one labelled button that never hides behind a collapse", () => {
  const control = sidebarSource.match(
    /<button[\s\S]*?data-action="project-status"[\s\S]*?<\/button>/,
  )?.[0] ?? "";
  assert.match(control, /aria-label=\{t\("nav\.projectStatusLabel"/);
  assert.match(control, /title=\{statusSummary\}/);
  assert.match(control, /onClick=\{\(\) => \{\n\s+setCollapsed\(entry\.path, false\);/);
  assert.match(control, /statusTarget/);
  assert.match(
    sidebarSource,
    /const statusSummary = statusParts\.join/,
    "the summary is built from the same parts the control renders",
  );
  // The control is rendered for the row, not inside the collapsed-only branch.
  const renderBlock = sidebarSource.match(/const renderProjectGroup =[\s\S]*?\n {2}\};/)?.[0] ?? "";
  assert.match(renderBlock, /const collapsedProject = entry\.meta\.collapsed/);
  // The control belongs to the header, so the collapsible conversation body (#1298
  // keeps it the only place a run's transcript could appear) never owns it.
  assert.ok(
    renderBlock.indexOf("data-action=\"project-status\"") <
      renderBlock.indexOf("sidebar-session-group-body project"),
    "the status control is rendered by the header, not inside the collapsed body",
  );
});

test("the renderer learns about a scheduled run from one additive broadcast", () => {
  assert.match(
    protocolSource,
    /scheduledChanged: "pi-desktop\/scheduled\/event\/changed"/,
  );
  assert.match(
    sharedTypes,
    /export type ScheduledRunChange = \{[\s\S]*?runId: string;[\s\S]*?sessionId: string;[\s\S]*?status: "running" \| "completed" \| "error";/,
  );
  assert.match(apiSource, /onScheduledChanged: \(listener: \(change: ScheduledRunChange\) => void\)/);
  assert.match(apiSource, /window\.piDesktop\.on\(IPC\.event\.scheduledChanged/);
  assert.match(
    apiSource,
    /const change = \(payload as \{ change\?: ScheduledRunChange \} \| null\)\?\.change;/,
  );
  assert.match(
    shellRuntimeSource,
    /const offScheduledChanged = api\.onScheduledChanged\(/,
  );
  assert.match(
    shellRuntimeSource.match(/offScheduledChanged\(\);/)?.[0] ?? "",
    /offScheduledChanged\(\);/,
    "the subscription is released on cleanup",
  );
});

test("a reload seeds the runs that started before it from the task list", () => {
  const seedBlock = shellRuntimeSource.match(
    /\/\/ A reload misses runs that started before it[\s\S]*?\n {4}\}\)\(\);/,
  )?.[0] ?? "";
  assert.match(seedBlock, /api\.listScheduled\(\)/);
  assert.match(seedBlock, /api\.listScheduledRuns\(\{ latestPerTask: true \}\)/);
  assert.match(seedBlock, /if \(run\.status !== "running"\) continue;/);
  assert.match(seedBlock, /applyScheduledRunChanged\(\{/);
});

test("the store keeps the newest run state and ignores an incomplete event", () => {
  assert.match(
    storeSource,
    /applyScheduledRunChanged: \(change: ScheduledRunChange\) => \{\n\s+if \(!change\?\.runId \|\| !change\?\.sessionId\) return;/,
  );
  assert.match(storeSource, /scheduledRuns: \{\},\n {4}page: "chat"/);
});

test("main announces a run when it is admitted and when it settles", () => {
  assert.match(scheduledRunnerSource, /onChanged\?\.\(identity\);/, "admission is announced");
  assert.match(
    scheduledRunnerSource,
    /onChanged\?\.\(\{ \.\.\.identity, status: "error" \}\)/,
    "a dispatch failure settles the run it announced",
  );
  assert.match(scheduledRunnerSource, /const identity: ScheduledRunChange = \{[\s\S]*?status: "running",/);

  // Settlement is announced only after the durable end-of-run write succeeded.
  const finishBlock = plansSource.match(
    /if \(runId && runtimeState\.host\) \{[\s\S]*?status: reason === "completed" \? "completed" : "error",/,
  )?.[0] ?? "";
  assert.match(finishBlock, /await runtimeState\.host\n?\s*\.call\("scheduled\.finishRun"/);
  assert.match(finishBlock, /if \(settled\) \{/);
  assert.match(finishBlock, /sendToRenderer\(IPC\.event\.scheduledChanged/);

  assert.match(
    mainSource,
    /onRunChanged: \(change\) => sendToRenderer\(IPC\.event\.scheduledChanged, \{ change \}\)/,
  );
});

test("a newer run of one conversation replaces the tracked run", () => {
  const applyBlock = storeSource.match(
    /applyScheduledRunChanged: \(change: ScheduledRunChange\) => \{[\s\S]*?\n {4}\},/,
  )?.[0] ?? "";
  assert.match(
    applyBlock,
    /if \(run\.sessionId !== change\.sessionId\) scheduledRuns\[runId\] = run;/,
    "one conversation keeps one tracked run, so the map cannot grow per run",
  );
  assert.match(applyBlock, /scheduledRuns\[change\.runId\] = \{/);
});
