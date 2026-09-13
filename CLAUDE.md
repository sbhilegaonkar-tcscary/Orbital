# CLAUDE.md

Project: ORBITAL, a sci-fi themed notebook environment (Jupyter-like) with a
character customizer, an orbital "project map" view, multiple visual modes,
accounts, presence, and shared projects.

**Resume point: read `docs/STATUS.md` first.** It holds the current milestone,
how to run things, the decisions log, and a per-session log. Update it at
every milestone boundary and before ending a session. Then:

- `docs/ARCHITECTURE.md` — stack, folder layout, the session seam, notebook
  model. Interfaces there are contracts; subagents build to them.
- `docs/DESIGN.md` — modes, skins, tokens, component rules.
- `styleguide/CATALOG.md` — every visual direction explored, with status.

---

## 1. Model routing (read this first)

The session model (Fable 5.1) is the **orchestrator and auditor**. It is the most
expensive model available (2x Opus, 5x Sonnet, 10x Haiku per token), so its
tokens are reserved for judgment, not typing. Every unit of work goes to the
cheapest tier that can do it correctly on the first try.

| Tier | `model` arg | Use for | Never for |
|------|-------------|---------|-----------|
| **Fable 5.1** (this session) | n/a | Planning, decomposition, architecture decisions, interface contracts, reviewing every subagent's output, resolving ambiguity, hard bugs after Opus fails, any code where a mistake is costly (auth, data model, protocol glue) | Bulk file writing, exploration, boilerplate, CSS, tests, docs, reading large files just to summarize them |
| **Opus 5** | `opus` | Complex implementation: algorithms, rendering/animation engines, state machines, concurrency, WebSocket/kernel protocol integration, non-trivial refactors, debugging a failure Sonnet could not fix in two attempts | Tasks with a clear spec and an obvious pattern to follow (send to Sonnet) |
| **Sonnet 5** | `sonnet` | Bulk and well-specified code: UI components from a spec, CSS/themes, tests, fixtures, docs, config, scaffolding, mechanical refactors, translating a design into markup, "make N more of these like this one" | Anything where the approach itself is unclear, or that touches shared contracts other code depends on |
| **Haiku 4.5** | `haiku` | Mechanical lookups: file inventories, grep-style searches, log summaries, renames, format-only changes, "does X exist / where is Y" | Writing or changing logic of any kind |

Default when unsure between two tiers: **the cheaper one, with a tight spec.**
A tight Sonnet prompt beats a vague Opus prompt. Escalate only on evidence.

### Escalation ladder

1. Sonnet attempts. If it fails review, Fable sends **one** corrective retry with
   the specific defect named.
2. Second failure, or a failure that reveals the task was misjudged: re-dispatch
   to Opus with the failed attempt's diff and the reviewer's notes attached.
3. Opus fails review once: Fable fixes it directly. Do not loop Opus.

Never re-run a whole task from scratch on a higher tier when a targeted fix
would do. Retries should carry forward the parts that passed.

---

## 2. Delegation protocol (how Fable dispatches work)

Before dispatching, Fable writes the plan: the file list, the interfaces between
pieces, and the acceptance criteria. Subagents do not make architectural
decisions. If a subagent finds it needs to, it stops and reports the question.

Every subagent prompt must contain:

- **Goal** in one or two sentences.
- **Exact files** to create or modify. Anything outside that list is out of scope.
- **Interfaces** it must conform to (types, function signatures, API shape,
  CSS variable names), pasted inline or by exact path and line range.
- **Acceptance criteria** it can verify itself: a command to run, a test to pass,
  a visual state to reach.
- **Return format**: files touched, what was verified and how, open questions.
  No file dumps, no restating the prompt.
- **Effort hint**: Sonnet/Haiku tasks run at low or medium effort unless the task
  is intelligence-sensitive.

Run independent subagents **in parallel in one message**. Serialize only when
one task's output is another's input.

Prefer the `Explore` agent for any search or "what does this codebase do"
question. Fable does not read large files to orient itself; it asks Explore
for the conclusion.

---

## 3. Audit protocol (Fable reviews everything)

No subagent output is accepted unverified. Fable reviews the **diff**, not the
full files, and checks in this order, stopping at the first failure:

1. **Scope**: only the listed files changed. No drive-by edits, no new deps
   without approval.
2. **Contract**: interfaces match the plan exactly (names, types, shapes).
3. **Correctness**: logic does what the spec says, edge cases handled, no
   silent fallbacks that hide errors.
4. **Verification claimed vs. real**: if the agent says tests pass, the test
   command and output must be in its report. Unverified claims are treated as
   failures.
5. **Quality**: no dead code, no commented-out blocks, no TODOs standing in for
   work, no duplicated helpers when one exists, no `any`-style type escapes
   without a comment saying why.
6. **Theme discipline**: UI code uses the design tokens and mode system defined
   in the architecture doc. No hardcoded colors, fonts, or z-index magic.

For anything security-relevant (auth, sessions, file access, kernel execution,
server connections) Fable reads the full changed functions, not just the diff
context, and checks input validation and trust boundaries explicitly.

Review output is a short verdict: accept, or a numbered defect list sent back
as a corrective prompt. Fable does not rewrite a subagent's code itself unless
the escalation ladder says so.

---

## 4. Credit-efficiency rules

- **Fable never types what Sonnet can type.** If Fable is writing a file longer
  than ~30 lines that is not a plan, spec, or security-critical glue, stop and
  delegate.
- **No re-reading.** Once a file has been read in this session, reference it by
  path and line range instead of reading it again. Use Grep to find, not Read
  to browse.
- **Subagent prompts refer, they do not paste.** Give paths and line ranges;
  the subagent reads what it needs. Paste only short interface snippets.
- **Subagent reports are summaries.** Ask for "files touched, verification
  output, open questions" and nothing else.
- **Batch small work.** Ten small Sonnet tasks that share context should be one
  Sonnet task with a checklist, not ten dispatches.
- **Cheap verification first.** Type-check and lint before running a full test
  suite or a browser session. Screenshots only when layout is the deliverable.
- **Workflows only on explicit opt-in.** The multi-agent `Workflow` tool is not
  used unless the user asks for it.
- **Do not narrate to the user mid-task.** Short progress lines only; the
  final message carries the outcome.

---

## 5. Working conventions

- Commit only when asked. Attribution line goes at the end of every commit.
- Windows host, PowerShell primary. Use forward slashes in paths passed to
  tools; quote paths with spaces.
- Keep this file short. Project-specific conventions (stack, folder layout,
  theme tokens, naming) live in `docs/ARCHITECTURE.md` and are linked from
  here once written, not duplicated.
