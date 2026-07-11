# Recommended Stack: Project-Local, Replit-Like UI Development for AI Agents

|  Rank | Stack                                                                                                                        | Evidence of real adoption                                                                                                                                                                                                                              | Replit-like capabilities                                                                                                                                                                                                                                         | Project-local fit                                                                                                | Verdict                |
| ----: | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **1** | **Vite or a Vite-powered framework such as Astro + agent-browser + repository-local `AGENTS.md`/skill + small HMR sentinel** | `agent-browser` has approximately 38,300 GitHub stars and 2,500 forks. Astro’s own repository explicitly instructs agents to run a persistent background development server and use `agent-browser` for long-running browser sessions and HMR testing. | Persistent development server, persistent browser session, HMR, preserved authentication and storage, scoped accessibility snapshots, console and network inspection, targeted visual comparison, React state inspection, deterministic HMR completion detection | **Excellent.** `agent-browser` can be pinned as a normal project dependency and invoked from repository scripts. | **Best overall stack** |

## Executive conclusion

This stack is desirable because it changes the agent from a **stateless test runner** into a **persistent development participant**.

The traditional agent loop is:

```text
Edit
? start server
? launch browser
? navigate
? log in
? recreate state
? run Playwright
? collect a large result
? diagnose
? repeat
```

The proposed loop is:

```text
Edit
? Vite HMR updates the existing page
? wait for an explicit HMR-complete signal
? query only what changed
? make the next edit
```

The largest benefit does not come from making the language model think faster. It comes from eliminating unnecessary work around the model:

* Fewer processes are started.
* Fewer pages are loaded.
* Fewer application states are reconstructed.
* Fewer screenshots are sent.
* Less DOM content is returned.
* Fewer logs are placed in context.
* Fewer tests are executed during iteration.
* Fewer agent turns are spent rediscovering the workflow.
* Fewer speculative fixes are needed because the live runtime can be queried directly.

The result is closer to Replit’s continuously running preview, but it is assembled entirely from open-source, repository-controlled components.

---

# 1. Stack architecture

The recommended architecture has four small parts.

```text
+------------------------------------------+
¦ Claude Code, Codex, Cursor or other agent¦
+------------------------------------------+
                    ¦ reads
                    ?
+------------------------------------------+
¦ AGENTS.md / CLAUDE.md / SKILL.md         ¦
¦                                          ¦
¦ • keep environment running               ¦
¦ • reuse browser session                  ¦
¦ • wait for HMR                           ¦
¦ • inspect only affected UI               ¦
¦ • run narrow tests                       ¦
+------------------------------------------+
                    ¦ invokes
                    ?
+------------------------------------------+
¦ agent-browser persistent daemon          ¦
¦                                          ¦
¦ • browser session                        ¦
¦ • accessibility snapshots               ¦
¦ • console and network history            ¦
¦ • screenshots and diffs                  ¦
¦ • React introspection                    ¦
+------------------------------------------+
                    ¦ observes
                    ?
+------------------------------------------+
¦ Vite or Astro development server         ¦
¦                                          ¦
¦ • instant module updates                 ¦
¦ • persistent application process         ¦
¦ • HMR event stream                       ¦
+------------------------------------------+
                    ¦ reports
                    ?
+------------------------------------------+
¦ Small development-only HMR sentinel      ¦
¦                                          ¦
¦ window.__agentUi.phase                   ¦
¦ window.__agentUi.lastUpdate              ¦
¦ window.__agentUi.error                   ¦
+------------------------------------------+
```

Astro’s repository now documents essentially this pattern. Its agent instructions tell agents to start a managed background development server, inspect its status and logs, and use `agent-browser` when long-running browsers or HMR testing are required.

---

# 2. Why this stack makes UI development faster

## The development server starts once

A conventional coding agent frequently treats every validation step as a new test execution:

```bash
npm run dev
npx playwright test
```

This creates repeated startup costs:

* Dependency and configuration loading
* Framework startup
* Initial compilation
* Browser startup
* Browser-context creation
* Application navigation
* Authentication
* Fixture setup

With this stack, the development server remains alive for the entire task. The browser also remains alive.

Astro’s own `AGENTS.md` uses background server commands for exactly this reason, exposing explicit start, status, logs and stop operations instead of repeatedly creating detached processes.

## The browser becomes a persistent debugging target

`agent-browser` uses a client-daemon architecture. The daemon starts automatically on the first command and persists between subsequent commands, keeping the browser available for fast follow-up operations.

This means that:

```bash
agent-browser snapshot
agent-browser console
agent-browser network requests
agent-browser get styles "#toolbar"
```

do not each create a new browser.

They address the browser that is already displaying the application.

That removes the largest structural weakness of the usual Playwright test cycle: the browser is no longer treated as disposable.

## Application state remains intact

The browser session can retain:

* Current route
* Navigation history
* Cookies
* Local storage
* IndexedDB
* Service workers
* Cache
* Login sessions

`agent-browser` supports isolated named sessions, worktree-scoped session identifiers, persistent profile directories and automatic state restoration. Each session retains its own browser instance, cookies, storage, navigation history and authentication state.

Therefore, after an agent changes a button or layout rule, it does not have to:

1. Reload the home page.
2. Log in again.
3. Open the relevant workspace.
4. Select the same record.
5. Reopen a modal.
6. Re-enter form values.

The agent can inspect the same modal, form or route immediately after HMR applies the edit.

## Vite supplies a deterministic completion signal

Agents often use fixed delays:

```bash
sleep 2
```

Fixed delays are both slow and unreliable:

* A fast update wastes the remainder of the delay.
* A slow update may still be incomplete.
* Syntax errors can lead to repeated sleeps and retries.
* The agent cannot distinguish an update from a disconnected server.

Vite exposes explicit browser-side events:

* `vite:beforeUpdate`
* `vite:afterUpdate`
* `vite:beforeFullReload`
* `vite:error`
* `vite:ws:disconnect`
* `vite:ws:connect`

These events allow a small project-local sentinel to report whether an update is pending, complete, failed or disconnected.

The agent can then execute:

```bash
agent-browser wait --fn \
  "window.__agentUi?.phase === 'ready'"
```

instead of sleeping and guessing.

This converts synchronization from a timing heuristic into a state query.

---

# 3. Why this stack reduces token usage

The primary token advantage comes from replacing **broad observations** with **targeted queries**.

## Token consumption in the old loop

A typical browser-testing loop may place all of the following into the agent context:

* Complete terminal startup logs
* Complete test-runner output
* Full HTML or DOM dumps
* Full accessibility trees
* Full-page screenshots
* Repeated navigation output
* Authentication steps
* Duplicate browser errors
* Duplicate network requests
* Stack traces unrelated to the edited component
* Output from every test in the suite

Much of this information is repeated on every edit.

The model then has to spend tokens reading and reasoning over state that did not change.

## Token consumption in the proposed loop

The agent instead asks narrow questions:

```bash
agent-browser snapshot \
  --selector "#settings-panel" \
  --interactive \
  --compact \
  --depth 4
```

```bash
agent-browser network requests \
  --filter "/api/settings" \
  --type xhr,fetch
```

```bash
agent-browser get styles "#save-button"
```

```bash
agent-browser diff snapshot \
  --selector "#settings-panel" \
  --compact
```

```bash
agent-browser errors
```

`agent-browser` can limit snapshots to interactive elements, remove empty structural nodes, restrict tree depth and scope the result to a selector. It also supports a maximum-output limit to prevent browser output from flooding the agent’s context.

## Token-efficiency table

| Source of waste            | Traditional loop                                       | Recommended loop                                       | Token effect                                        |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------- |
| Repository instructions    | Agent rediscovers setup and testing conventions        | Reads stable `AGENTS.md` and skill instructions        | Eliminates repeated planning and tool discovery     |
| Browser state              | New context and new navigation                         | Persistent named session                               | Removes repeated login and navigation turns         |
| DOM inspection             | Full HTML or page snapshot                             | Selector-scoped compact accessibility snapshot         | Returns a much smaller textual representation       |
| Visual inspection          | Full-page screenshots after every edit                 | Element or changed-region screenshots only when needed | Reduces expensive multimodal input                  |
| Console output             | Entire accumulated console history                     | Clear at checkpoint, then read only new messages       | Removes duplicates and stale errors                 |
| Network output             | Every browser request                                  | Filter by endpoint, type, method or status             | Keeps unrelated assets and telemetry out of context |
| Synchronization            | Sleep, inspect, retry                                  | Wait on HMR state variable                             | Removes failed or premature observation turns       |
| Testing                    | Full Playwright or end-to-end suite                    | Component or affected test during iteration            | Reduces test logs and execution time                |
| React debugging            | Infer state from rendered output                       | Query component tree, props, hooks and source          | Reduces speculative edits                           |
| Multi-step browser actions | Separate process or tool invocation for each operation | Persistent daemon and batched commands                 | Reduces tool-call and process overhead              |

---

# 4. The measured benefit of repository instructions

The benefit of `AGENTS.md` is not merely theoretical.

A 2026 study evaluated 124 coding-agent pull requests across ten repositories, comparing executions with and without `AGENTS.md`. The presence of repository instructions was associated with:

* **28.64% lower median runtime**
* **16.58% lower output-token consumption**
* Comparable task-completion behavior

The study does not measure this complete browser stack, so those percentages should not be presented as the expected total savings of this architecture. They do provide direct evidence that stable repository-level instructions can reduce both runtime and output-token use.

The AGENTS.md format is also used by more than 60,000 open-source projects.

OpenAI’s official Codex documentation states that Codex reads `AGENTS.md` files from repositories and uses them to determine how to navigate the codebase, which commands to run and how to follow project practices. OpenAI also notes that agents perform best with configured development environments, reliable tests and clear documentation.

The project-local instruction file should therefore define the development loop explicitly, rather than leaving each agent to invent it.

---

# 5. What the repository skill should teach

The skill is the behavioral control layer for the stack.

It should contain rules such as:

```text
Treat the development environment as persistent.

Before starting a development server, check whether it is already running.

Before opening a browser, check whether the project browser session exists.

Use the same worktree-scoped browser session throughout the task.

Do not close the browser or development server between edits.

Allow Vite HMR to update the current page.

After an edit, wait for window.__agentUi.phase to become "ready".

Do not use arbitrary sleeps when an explicit readiness condition exists.

Clear browser errors and console messages before an edit.

After the edit, retrieve only newly generated errors.

Inspect the smallest relevant DOM subtree.

Prefer compact accessibility snapshots over raw HTML.

Prefer element screenshots over full-page screenshots.

Do not take a screenshot when textual state is sufficient.

Preserve the current route, authentication and form state.

Run the smallest relevant test during iteration.

Run broad tests only when the change is complete or has broad impact.

Restart the browser or server only after confirming it is unhealthy.
```

These instructions prevent agents from falling back into habits that are safe but expensive, such as relaunching Playwright, navigating from the root route and running every available test.

---

# 6. Why accessibility snapshots are more token-efficient than screenshots

Screenshots are valuable when the question is visual:

* Is the spacing correct?
* Is an element overlapping another?
* Is the color contrast acceptable?
* Does the page match a design?
* Is an animation visually correct?

They are wasteful when the question is structural:

* Is the Save button present?
* Is it disabled?
* What is its accessible name?
* Is the dialog open?
* Which inputs are visible?
* What text appeared after submission?

For structural questions, an accessibility snapshot is usually a better agent observation.

`agent-browser` can return:

```text
dialog "Account settings"
  textbox "Display name"
  checkbox "Email notifications" checked
  button "Save changes"
  button "Cancel"
```

instead of a screenshot plus a full DOM dump.

The snapshot can also be:

* Limited to interactive elements
* Scoped to one selector
* Made compact
* Depth-limited
* Returned as structured JSON

These controls are explicitly designed to produce agent-friendly observations rather than expose the entire browser state.

---

# 7. Incremental console and network inspection

A persistent browser by itself is not enough. Without event checkpointing, the agent receives an ever-growing history of messages.

The skill should establish an observation boundary:

```bash
agent-browser console --clear
agent-browser errors --clear
```

Then the agent edits the code and waits for HMR.

Afterward:

```bash
agent-browser errors
agent-browser console
agent-browser network requests --type xhr,fetch
```

`agent-browser` provides separate commands for console messages, uncaught page exceptions and tracked network requests. Network results can be filtered by URL, resource type, HTTP method or status.

This creates an event window:

```text
Everything before the edit: irrelevant baseline
Everything after the edit: candidate consequence
```

That is much more useful to a model than a large mixed log containing messages from initial startup, authentication, navigation and previous failed attempts.

---

# 8. React runtime introspection

For React applications, the stack can reduce another major source of wasted effort: guessing which component owns a rendered element.

With React introspection enabled, `agent-browser` can expose:

* Component tree
* Component source
* Props
* Hooks
* State
* Render recordings
* Suspense boundaries
* Web Vitals and hydration information

The tooling supports React applications built with Vite, Next.js, Remix, Create React App, TanStack Start and other React-based frameworks.

Without runtime introspection, an agent may:

1. Search for visible text.
2. Find several possible components.
3. Edit the wrong component.
4. Observe no change.
5. Search through parent components.
6. Add temporary logs.
7. Repeat.

With runtime introspection, it can query the component responsible for the affected UI and inspect its current state directly.

This reduces both code-search tokens and failed edit cycles.

---

# 9. Project-local installation matters

The stack can be committed to the repository rather than depending on a particular IDE or hosted service.

`agent-browser` supports normal local installation:

```bash
npm install --save-dev agent-browser
agent-browser install
```

It can then be called through `package.json`:

```json
{
  "scripts": {
    "ui:start": "node scripts/agent-ui/start.mjs",
    "ui:status": "node scripts/agent-ui/status.mjs",
    "ui:wait": "node scripts/agent-ui/wait-hmr.mjs",
    "ui:inspect": "agent-browser snapshot -i -c",
    "ui:errors": "agent-browser errors",
    "ui:network": "agent-browser network requests --type xhr,fetch"
  }
}
```

The project-local dependency pins the version and makes the expected browser interface reproducible for every agent and contributor. The project installation mode is documented by the repository.

No custom IDE is required.

No hosted runtime is required.

No proprietary agent integration is required.

The agent only needs terminal access and the repository instructions.

---

# 10. The HMR sentinel

The HMR sentinel is the only custom integration required.

Its purpose is not to implement hot reload. Vite already does that.

Its purpose is to convert Vite’s HMR event stream into a simple state that an agent can query.

Conceptually:

```ts
declare global {
  interface Window {
    __agentUi?: {
      phase: "idle" | "updating" | "ready" | "error" | "disconnected";
      update: number;
      lastUpdateAt?: number;
      error?: unknown;
    };
  }
}

if (import.meta.env.DEV && import.meta.hot) {
  window.__agentUi ??= {
    phase: "ready",
    update: 0,
  };

  import.meta.hot.on("vite:beforeUpdate", () => {
    window.__agentUi!.phase = "updating";
  });

  import.meta.hot.on("vite:afterUpdate", () => {
    window.__agentUi!.phase = "ready";
    window.__agentUi!.update++;
    window.__agentUi!.lastUpdateAt = Date.now();
    delete window.__agentUi!.error;
  });

  import.meta.hot.on("vite:error", (error) => {
    window.__agentUi!.phase = "error";
    window.__agentUi!.error = error;
  });

  import.meta.hot.on("vite:ws:disconnect", () => {
    window.__agentUi!.phase = "disconnected";
  });

  import.meta.hot.on("vite:ws:connect", () => {
    window.__agentUi!.phase = "ready";
  });
}
```

Vite documents all of these events through its client HMR API. HMR code can be guarded with `import.meta.hot` so production builds can remove it.

The agent can capture the current counter before editing:

```bash
agent-browser eval "window.__agentUi?.update"
```

Then wait until it changes:

```bash
agent-browser wait --fn \
  "window.__agentUi?.phase === 'ready' && window.__agentUi.update > 17"
```

This ensures the agent observes the result of its own edit rather than an older page state.

---

# 11. Example optimized correction loop

A normal UI correction can become:

```text
1. Read AGENTS.md.

2. Confirm that the persistent development server is running.

3. Confirm that the worktree browser session is active.

4. Navigate to the target route only when it is not already open.

5. Establish a baseline:
   - clear console
   - clear errors
   - save scoped snapshot
   - read current HMR update counter

6. Edit the component.

7. Wait for the HMR counter to advance.

8. Check:
   - HMR error state
   - new JavaScript exceptions
   - relevant API requests
   - scoped accessibility-tree diff

9. Take a targeted screenshot only when visual verification is required.

10. Run the narrowest relevant test.

11. Continue editing with the server, browser, route and state intact.
```

The browser can persist across all eleven steps because `agent-browser` maintains a background daemon and named sessions. Multiple commands can also be executed in a batch to avoid per-command process startup overhead.

---

# 12. What should still use Playwright tests

This stack should not replace formal testing.

It should replace the practice of using a complete end-to-end test execution as the primary observation mechanism after every edit.

Use the persistent development loop for:

* Layout work
* Styling changes
* Component behavior
* Form interaction
* State debugging
* API integration debugging
* Console failures
* React render problems
* Accessibility inspection
* Rapid corrective iterations

Use Playwright tests for:

* Repeatable regression coverage
* Clean-session behavior
* Authentication flows
* Cross-browser validation
* Multi-page user journeys
* CI
* Final task verification

The optimal pattern is:

```text
Fast persistent loop during development
+
Focused test after the correction
+
Broader suite before completion when warranted
```

This keeps formal validation while removing it from the innermost edit-observe loop.

---

# 13. Limitations and safeguards

## Persistent state can conceal initialization bugs

A page that works after ten HMR updates may fail from a clean load.

The skill should require occasional validation using:

* A full reload
* A fresh session
* A production build
* The relevant formal test

Persistent state optimizes iteration, not final verification.

## HMR completion does not mean correctness

`vite:afterUpdate` means that Vite applied an update. It does not mean:

* The UI is correct.
* The API succeeded.
* The component rendered the expected state.
* No visual regression occurred.

That is why the next operation should be a targeted state query or diff.

## Screenshots remain necessary for visual questions

Accessibility snapshots cannot determine whether:

* Margins look balanced.
* Colors are correct.
* An animation is smooth.
* Elements visually overlap.
* Typography matches a design.

The goal is not zero screenshots. It is to use screenshots deliberately and scope them to the affected region.

## Browser state contains sensitive data

Persistent browser profiles and saved states can contain authentication tokens.

`agent-browser` warns that state files can contain session tokens and should be excluded from version control. It also supports encryption of saved state.

Project instructions should require:

```gitignore
.agent-ui/
.agent-browser/
.auth/
*.browser-state.json
```

Authentication state must never be committed.

---

# 14. Expected practical impact

Only the AGENTS.md portion currently has a directly published efficiency measurement. The complete stack does not yet have a reliable independent benchmark showing a specific percentage reduction in tokens or latency.

The expected improvements are nonetheless mechanically clear:

## Wall-clock improvements

* One server startup instead of one per iteration
* One browser startup instead of one per inspection
* HMR instead of complete page reconstruction
* Conditional waits instead of fixed delays
* Direct runtime inspection instead of speculative source investigation
* Narrow tests instead of complete suites

## Token improvements

* Stable workflow instructions instead of repeated planning
* Scoped accessibility trees instead of full DOM dumps
* Incremental errors instead of accumulated logs
* Filtered requests instead of complete network histories
* Element screenshots instead of full-page screenshots
* Component state inspection instead of code-search speculation
* Diffs instead of repeated complete snapshots

## Reliability improvements

* The agent observes the same browser state as the user.
* Authentication and route state remain stable.
* HMR synchronization is explicit.
* Each edit has a clear observation boundary.
* The agent can distinguish compilation errors from UI errors and API errors.
* The complete workflow is encoded in the repository.

---

# 15. Metrics for evaluating the stack

The stack should be benchmarked against the current Playwright-heavy workflow using real UI tasks.

Measure:

| Metric                        | Definition                                                      |
| ----------------------------- | --------------------------------------------------------------- |
| Edit-to-observation latency   | Time from saving a file to receiving usable runtime state       |
| Edit-to-correct-state latency | Time from first edit to validated correction                    |
| Browser launches              | Number of browser processes created per task                    |
| Server launches               | Number of development-server starts per task                    |
| Agent tool calls              | Total tool invocations required per correction                  |
| Output tokens                 | Agent output generated during the task                          |
| Observation characters        | Total DOM, logs and test output returned to the agent           |
| Screenshots                   | Number of images captured                                       |
| Full-page screenshots         | Number of expensive full-page visual observations               |
| State reconstruction actions  | Login, navigation and fixture-setup steps                       |
| Full-suite executions         | Number of broad test runs                                       |
| Failed observation cycles     | Inspections performed before the update was actually ready      |
| Speculative edits             | Changes reverted because the agent modified the wrong component |

The most meaningful target is not merely faster HMR.

It is:

```text
Fewer agent turns per correct visual change.
```

---

# Final verdict

**Vite or Astro + agent-browser + repository-local agent instructions + a small HMR sentinel is the strongest project-local stack for reducing both UI-development latency and agent context usage.**

It succeeds because every component addresses a different source of waste:

* **Vite/Astro** keeps compilation incremental.
* **The persistent development server** removes repeated startup.
* **agent-browser** keeps the browser and application state alive.
* **Scoped snapshots and filtered event queries** minimize observations.
* **React introspection** reduces debugging by inference.
* **The HMR sentinel** eliminates arbitrary waits and premature inspections.
* **AGENTS.md and skills** make the optimized loop automatic and repeatable.
* **Focused tests** preserve correctness without putting the complete suite inside every edit cycle.

The strategic shift is simple:

> Stop making the agent repeatedly launch and test the application. Give it a persistent application and browser that it can interrogate.

That is the difference between an agent operating like a CI runner and an agent operating like a developer attached to a live debugging session.
