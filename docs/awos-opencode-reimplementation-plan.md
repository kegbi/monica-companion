# AWOS Claude-to-OpenCode Reimplementation Plan (Max Parity)

## 1. Task Contract

### Objective
Reimplement AWOS on OpenCode with behavior and structure as close as possible to the Claude implementation, while patching only hard incompatibilities.

### Scope In
- AWOS workflow parity for all 8 commands.
- Command UX parity (`/awos:*` target format).
- Directory/model parity (`.awos` as framework core + platform wrapper layer).
- Installer/update parity (including migrations and dry-run).
- Native OpenCode question flow parity for interactive prompts.
- Minimal prompt deltas for OpenCode-only differences.

### Scope Out
- New custom workflows beyond AWOS baseline.
- Non-OpenCode platform adapters.
- Full rewrite of AWOS logic.

### Quality Targets
- Keep AWOS prompt logic as source-of-truth whenever possible.
- Prefer adaptation layers over prompt rewrites.
- Maintain document-centric idempotent state model.
- Preserve manager-delegation behavior in `implement`.

### Execution Mode
Interactive phased migration, then pilot.

### Stop Conditions
- OpenCode command parser cannot support required naming with no acceptable alias strategy.
- OpenCode cannot support required delegation pattern for `implement`.
- Deterministic checklist/status updates cannot be guaranteed.

## 2. Parity Principles (Non-Negotiable)

1. Keep AWOS core assets in `.awos/` (commands/templates/scripts) with minimal edits.
2. Preserve AWOS lifecycle order:
   `product -> roadmap -> architecture -> spec -> tech -> tasks -> implement -> verify`.
3. Keep command-driven workflow as primary UX (not agent-only UX).
4. Keep `implement` orchestration-only (delegates coding, does not code directly).
5. Apply a minimal-delta patch policy:
   - patch only incompatible terms/tools,
   - avoid semantic drift in command behavior.
6. Keep AWOS as one shared core usable by Claude and OpenCode via thin wrapper layers.
7. Keep runtime wrapper files in runtime-owned directories (`.claude/...` and `.opencode/...`), not in `.awos`.

## 3. Compatibility Baseline

## 3.1 Confirmed OpenCode capabilities
- OpenCode supports file-based custom commands in `.opencode/commands/*.md`.
- OpenCode supports project command files in `.opencode/commands/*.md`.
- OpenCode supports agents and subagents, so AWOS delegation model is implementable.
- OpenCode has a native `question` tool for structured user input prompts.
- OpenCode reads `.claude/agents` and `.claude/skills` for compatibility; command registration can be file-driven via `.opencode/commands`.
- Source references:
  - OpenCode commands docs: `https://opencode.ai/docs/commands/`
  - OpenCode agents docs: `https://opencode.ai/docs/agents/`
  - OpenCode tools docs (`question`): `https://opencode.ai/docs/tools/`
  - OpenCode rules/compat docs: `https://opencode.ai/docs/rules/`
  - OpenCode config schema: `https://opencode.ai/config.json` (`command` config object)

## 3.2 Known incompatibilities

| Claude AWOS Assumption | OpenCode Reality | Parity Adaptation |
| --- | --- | --- |
| `.claude/commands/awos/*` wrapper commands | OpenCode supports command files in `.opencode/commands/*.md` | Keep OpenCode wrappers in `.opencode/commands/awos/*.md` and register commands via frontmatter (`name: awos:*`) |
| `AskUserQuestion` tool | OpenCode has native `question` tool | Use native `question` tool in OpenCode command templates/bindings for interactive sections |
| Task-tool wording around `subagent_type` | OpenCode uses its own subagent routing model | Normalize delegation instructions to OpenCode agent IDs |
| Bash helper script only (`create-spec-directory.sh`) | Windows-heavy environment | Add cross-platform script (`.py`) and keep `.sh` as optional |

## 4. Target Architecture (Closest to Claude)

## 4.1 File structure

```text
.awos/
  commands/                      # canonical AWOS command prompts (ported minimal deltas)
  templates/                     # AWOS templates (near-verbatim)
  scripts/                       # AWOS helper scripts (+ cross-platform additions)
  opencode/
    commands/
      awos/
        product.md               # OpenCode wrapper templates (source)
        roadmap.md
        architecture.md
        spec.md
        tech.md
        tasks.md
        implement.md
        verify.md

.claude/
  commands/
    awos/
      product.md                 # Claude wrappers, unchanged pattern
      roadmap.md
      architecture.md
      spec.md
      tech.md
      tasks.md
      implement.md
      verify.md

.opencode/
  commands/
    awos/
      product.md                 # OpenCode runtime command files (name: awos:product)
      roadmap.md
      architecture.md
      spec.md
      tech.md
      tasks.md
      implement.md
      verify.md
  agents/
    awos-orchestrator.md         # optional primary runtime router
    awos-implement-manager.md    # optional helper for strict delegation semantics
```

## 4.2 Command registry strategy
- Register commands via command files in `.opencode/commands/awos/*.md`.
- Use frontmatter `name: awos:<command>` to preserve Claude-like command naming.
- Keep wrappers lightweight and delegating to `.awos/commands/<command>.md`.

## 4.3 Wrapper pattern (Claude-like)
- Keep wrapper files in two runtime folders:
  - `.claude/commands/awos/*.md` for Claude runtime.
  - `.opencode/commands/awos/*.md` for OpenCode runtime.
- Rely on OpenCode file-based command loading (no AWOS command block injection into `opencode.jsonc`).

This preserves AWOS layering:
- framework core in `.awos`
- runtime adapters in `.claude/commands/awos` and `.opencode/commands/awos`
- runtime binding from command file frontmatter

## 4.4 Native ask-question behavior
- In OpenCode command templates, explicitly require native `question` tool for structured choices and clarification loops.
- In Claude wrappers, keep existing `AskUserQuestion` guidance.
- Core `.awos/commands/*` files stay runtime-agnostic.

## 5. Prompt Porting Policy (Minimal Delta)

## 5.1 Keep unchanged where possible
- Product/roadmap/architecture/spec/tech/tasks/verify core logic.
- Template-driven create/update semantics.
- Document paths under `context/`.

## 5.2 Mandatory edits only
1. Add OpenCode command-template instructions to use native `question` tool where AWOS expects guided multi-choice interaction.
2. Replace Claude Task-tool phrases that mention `subagent_type` extraction with OpenCode agent routing instructions.
3. Add Windows-safe script path guidance where command prompts call shell scripts.

## 5.3 Explicitly avoid
- Rewriting command intent.
- Reordering AWOS lifecycle.
- Injecting unrelated repo-specific workflow constraints into AWOS commands.

## 6. Phased Delivery Plan

## Phase 0: Clean-slate bootstrap decision
### Goals
- Define what existing `.opencode/*` assets are archived vs replaced.
- Freeze parity rules and naming strategy.
### Deliverables
- Migration decision note (archive path + replace policy).
- Final command naming decision (`awos:*` vs alias fallback).
### Exit Criteria
- Approved cutover policy.

## Phase 1: Core AWOS asset import
### Goals
- Import AWOS `commands`, `templates`, `scripts` into `.awos/`.
- Preserve upstream file layout and filenames.
### Deliverables
- `.awos/commands/*.md`
- `.awos/templates/*.md`
- `.awos/scripts/*`
### Exit Criteria
- Core assets present with checksum/commit trace to upstream snapshot.

## Phase 2: Separate runtime command bindings
### Goals
- Keep `.claude/commands/awos/*.md` for Claude runtime.
- Keep `.opencode/commands/awos/*.md` for OpenCode runtime.
- Register OpenCode commands through command file frontmatter (`name: awos:*`).
- Add native `question` instruction in OpenCode command templates.
### Deliverables
- 8 Claude command files + 8 OpenCode command files.
- 8 OpenCode command files in `.opencode/commands/awos` with explicit `name: awos:*`.
### Exit Criteria
- `/awos:*` (or approved alias set) appears in OpenCode command list.

## Phase 3: Delegation parity for `implement`
### Goals
- Ensure strict manager-only behavior in implementation command.
- Route coding to designated subagents.
### Deliverables
- OpenCode-compatible delegation block in `.awos/commands/implement.md` (minimal edits).
- Agent map for known assignment tags from `tasks.md`.
### Exit Criteria
- `implement` does not directly code; task completion updates are deterministic.

## Phase 4: Script portability and deterministic edits
### Goals
- Add cross-platform spec directory creation helper.
- Add deterministic checklist/status update utility where needed.
### Deliverables
- `create-spec-directory.py` (or Node equivalent) in `.awos/scripts/`.
- Updated command references to portable script.
### Exit Criteria
- Works in PowerShell and Unix shells.

## Phase 5: Installer/update parity
### Goals
- Build AWOS-like installer behavior for OpenCode:
  - directory creation,
  - copy/update flow,
  - migrations,
  - dry-run.
### Deliverables
- Installer command/script.
- Migration version file (AWOS-style).
### Exit Criteria
- Safe reruns with predictable overwrite/preserve behavior.

## Phase 6: Validation and pilot
### Goals
- Validate end-to-end command lifecycle.
- Confirm parity in real feature flow.
### Deliverables
- E2E workflow run logs for all 8 commands.
- Gap list: required deviations from Claude behavior.
### Exit Criteria
- No high-severity blockers for day-to-day usage.

## 7. Verification Matrix (Parity-Focused)

| Area | Pass Condition |
| --- | --- |
| Command UX | Users can run all 8 AWOS commands via OpenCode custom commands |
| Cross-tool parity | Same AWOS core prompts produce equivalent behavior in Claude and OpenCode |
| Ask flow parity | OpenCode command files use native `question` tool and preserve AWOS interactive intent |
| Prompt parity | No unnecessary semantic drift from Claude AWOS prompts |
| Document lifecycle | Product -> verify workflow works with generated files |
| Delegation parity | `implement` delegates coding work and tracks progress correctly |
| Portability | Scripts and file operations run on Windows and Unix |
| Update safety | Reinstall/update does not corrupt project state |

## 8. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Colon command names unsupported in runtime UX | Cannot perfectly mirror `/awos:*` | Add deterministic aliases and map both in docs |
| OpenCode/Claude runtime folder mismatch | Hidden runtime mismatch | Keep dedicated OpenCode wrappers in `.opencode/commands/awos/*.md` with `name: awos:*` frontmatter |
| Over-adaptation of prompts | Drift from Claude behavior | Enforce minimal-delta reviews per command |
| Delegation mismatch in `implement` | Command may code directly or stall | Add strict delegation checks and tests |
| Markdown mutation errors | Broken task/status tracking | Use parser utility + snapshot tests |
| Windows shell incompatibility | Broken spec directory generation | Prefer Python/Node helper and keep `.sh` optional |

## 9. First Execution Backlog

1. Finalize command naming strategy with live smoke check in OpenCode runtime.
2. Import AWOS core assets into `.awos/` from pinned upstream commit.
3. Keep separate runtime command files in `.claude/commands/awos/*` and `.opencode/commands/awos/*` referencing shared `.awos/commands/*`.
4. Register OpenCode commands from `.opencode/commands/awos/*.md` frontmatter (`name: awos:*`) and apply native `question` instruction there.
5. Patch mandatory incompatibilities in each AWOS core command only when wrapper-layer adaptation is insufficient.
6. Port `create-spec-directory` to cross-platform runtime.
7. Add parity smoke tests for all 8 commands across both runtimes.
8. Implement installer/update flow with migrations.

## 10. Success Definition

This reimplementation is successful when:
1. OpenCode runs the AWOS lifecycle through custom commands with Claude-like behavior.
2. Core logic remains in AWOS command files with only minimal compatibility edits.
3. `implement` remains orchestration/delegation-first.
4. Generated docs remain the full project memory/state source.
5. Deviations from Claude AWOS are documented, justified, and minimal.
