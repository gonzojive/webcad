# Design: workspace transaction model and undo/redo architecture

**Date:** July 5, 2026
**Status:** Proposal (open for discussion)

This document analyzes how sketch mutations and undo/redo history work today, identifies architectural problems in the current approach, and proposes options for enforcing safe, predictable state transitions in the WebCAD workspace.

---

## 1. Problem statement

The `WorkspaceService` exposes low-level mutator methods (`addPoint`, `addLine`, `addCircle`, `addConstraint`, `updatePointPosition`) that immediately modify the live sketch state but do **not** create undo/redo checkpoints. Callers are responsible for calling `commitHistory()` at the right time. This design has two consequences:

1. **Orphaned mutations.** If a caller forgets to call `commitHistory()`, the mutation is live and visible but has no corresponding undo checkpoint. It silently rolls into the *next* `commitHistory()` call, creating a single undo entry that bundles unrelated changes together.

2. **No enforcement boundary.** There is no compile-time or runtime mechanism to ensure that a mutation is performed within a tracked context. A new tool author, MCP handler, or UI component can call `workspace.addPoint(...)` and unknowingly leave the history in a dirty state.

The recently introduced `WorkspaceService.transaction()` wrapper addresses the MCP service handlers, but the broader architecture still allows untracked mutations from any caller with a reference to the workspace.

---

## 2. Current architecture

### 2.1 How mutations flow

Every sketch mutation follows this path:

```
caller (tool / MCP / UI)
  → workspace.addPoint() / addLine() / etc.
    → cloneSketchForMutation(currentSketch)   // deep clone + revision++
    → apply mutation to cloned sketch
    → updateSketch(newSketch, pushHistory=false)
      → this.document.set(...)                // Angular signal updated
      → this.store.save(newSketch)            // IndexedDB persisted
```

The mutation is immediately live. Angular re-renders. IndexedDB is written. But the `HistoryManager` undo stack is **not** touched.

A separate explicit call is required to checkpoint the state:

```
caller
  → workspace.commitHistory()
    → this.history.pushState(cloneSketch(currentSketch))
    → this.historyVersion.update(v => v + 1)
```

### 2.2 Mutator inventory

The table below catalogs every public method on `WorkspaceService` that modifies the sketch, along with whether it manages its own history.

| Method | Commits history? | Calls solve? | Notes |
|---|---|---|---|
| `addPoint(pos)` | ❌ No | ❌ No | Primitive building block |
| `updatePointPosition(id, pos)` | ❌ No | ❌ No | Used during mouse drag |
| `addLine(p1Id, p2Id)` | ❌ No | ❌ No | Primitive building block |
| `addCircle(centerId, radius)` | ❌ No | ❌ No | Primitive building block |
| `addConstraint(constraint)` | ❌ No | ❌ No | Primitive building block |
| `solve(draggedPointId?)` | ❌ No | ✅ (is solver) | Intentionally leaves commit to caller |
| `togglePointFixed(pointId)` | ✅ Yes | ✅ Yes | Self-contained |
| `deleteEntity(id, commit?)` | ✅ Conditional | ✅ Yes | `commit` param defaults to `true` |
| `deleteSelectedEntities()` | ✅ Yes | ✅ Yes | Self-contained |
| `deleteConstraint(id)` | ✅ Yes | ✅ Yes | Self-contained |
| `clearWorkspace()` | ✅ Yes | ❌ No | Self-contained |
| `transaction(action)` | ✅ Yes | ❌ No | Wraps callback, commits on success, rolls back on error |

The five primitive mutators (`addPoint`, `addLine`, `addCircle`, `addConstraint`, `updatePointPosition`) are the dangerous ones — they are the most commonly called, and they never manage history.

### 2.3 How callers use the primitives today

Each caller category has its own pattern for managing history around the primitives:

#### Interactive tools (via [ToolContext](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/tools/tool.ts#L5-L39))

Tools call primitives directly, then manually call `solve()` and `commitHistory()` at action boundaries:

| Tool | Pattern |
|---|---|
| [PointTool](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/tools/point_tool.ts) | `addPoint → solve → commitHistory` on click |
| [LineTool](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/tools/line_tool.ts) | First click: `addPoint` (no commit). Second click: `addPoint → addLine → solve → commitHistory`. |
| [CircleTool](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/tools/circle_tool.ts) | First click: `addPoint` (no commit). Second click: `addCircle → solve → commitHistory`. |
| [DimensionTool](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/tools/dimension_tool.ts) | `addConstraint → solve → commitHistory` on input confirmation |
| [SelectTool](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/tools/select_tool.ts) (drag) | `updatePointPosition → solve` on every mousemove. Single `commitHistory` on mouseup. |

> [!NOTE]
> The `LineTool` and `CircleTool` intentionally create **uncommitted intermediate state** on the first click. If the user cancels, `deleteEntity(id, false)` cleans up without touching history. This is a legitimate use of uncommitted mutations for multi-step workflows.

#### MCP service handlers (via [McpService](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/ui/app/services/mcp.service.ts))

After the recent refactor, all mutating MCP handlers wrap their calls in `this.workspace.transaction(...)`. This is correct, but notably **none of the MCP add-entity handlers call `solve()`** — the agent must invoke the separate `WebCad.solve` tool explicitly.

#### Viewport (constraint label drag)

[ViewportComponent](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/ui/app/viewport/viewport.component.ts) directly mutates constraint layout offset properties on the live object during drag, then calls `commitHistory()` on mouseup. This bypasses `cloneSketchForMutation` entirely.[^1]

[^1]: This works because `HistoryManager.pushState()` clones via `cloneSketch()` before storing, so the snapshot is independent. But it means the live sketch object's constraint references are mutated in place, which could cause bugs if any code holds stale references.

### 2.4 History manager internals

[HistoryManager](file:///home/red/.gemini/antigravity/worktrees/webcad/relax-solver-timeout-threshold/web/poc/model/history.ts) uses a **full-snapshot memento pattern**:

- **Storage**: Two arrays of `SketchModel` clones (`undoStack`, `redoStack`), capped at 100 entries.
- **Dedup**: `pushState()` compares the incoming state against the stack top using the `revision` field (fast O(1) check) or falls back to `JSON.stringify` comparison.
- **Undo**: Pops the current state from the undo stack onto the redo stack, returns the new top.
- **Redo**: Pops from the redo stack back onto the undo stack.

Each entry is a full clone of `SketchModel` (all points, lines, circles, constraints). For a sketch with *n* entities, this means O(*n*) memory per checkpoint and O(100·*n*) total for the undo stack.

---

## 3. Identified problems

### 3.1 The orphaned mutation problem

If `addPoint` is called without a subsequent `commitHistory()`:

1. The point is immediately visible on the canvas.
2. The undo stack does not know about it.
3. When some *other* action later calls `commitHistory()`, that checkpoint silently includes the orphaned point.
4. If the user presses Undo, both the later action *and* the orphaned point are undone together — surprising and incorrect from the user's perspective.

### 3.2 No compile-time safety

The `ToolContext` interface exposes `addPoint`, `addLine`, `commitHistory`, and `solve` as independent methods at the same level. There is nothing in the type system that guides a developer toward the correct `mutate → solve → commit` sequence, or prevents calling `addPoint` in isolation.

### 3.3 IndexedDB writes on every transient mutation

`updateSketch()` calls `this.store.save()` unconditionally. During a mouse drag, `updatePointPosition` is called on every mousemove frame (~60 Hz), generating ~60 IndexedDB writes per second. These writes are fire-and-forget (`async` with no `await`), so they do not block rendering, but they are wasteful and could cause I/O pressure on slower devices.

### 3.4 Full-snapshot memory cost

At 100 undo entries, a moderately complex sketch (500 entities) means ~50,000 object allocations retained in memory. Each `cloneSketch` allocates new arrays and spreads every entity. This will become a performance bottleneck as sketch complexity grows.

---

## 4. Proposed options

### Option A: runtime transaction guard (recommended short-term)

Add an `activeTransaction` flag to `WorkspaceService`. Every primitive mutator asserts that it is running inside a transaction. Introduce a separate `transient()` block for interactive mutations (dragging) that explicitly opts out of history tracking.

```typescript
// Enforced in every primitive mutator:
private assertMutationAllowed(): void {
    if (!this.inTransaction && !this.inTransientBlock) {
        throw new Error(
            'Sketch mutation outside of transaction() or transient() block. ' +
            'Wrap your mutations in workspace.transaction(() => { ... }).'
        );
    }
}

// For discrete, undoable actions (tools, MCP handlers):
workspace.transaction(() => {
    workspace.addPoint({ x: 10, y: 20 });
    workspace.addLine(p1, p2);
    workspace.solve();
});  // → automatic commitHistory() on success, rollback on error

// For interactive drags (many rapid updates, single undo entry):
workspace.transient(() => {
    workspace.updatePointPosition(id, newPos);
    workspace.solve(draggedPointId);
});  // → no history commit; caller must commitHistory() on mouseup
```

**Changes required:**
- Add `inTransaction` and `inTransientBlock` private flags to `WorkspaceService`.
- Add `assertMutationAllowed()` call to all five primitive mutators.
- Add `transient(action)` method that sets `inTransientBlock = true` during execution.
- Refactor `SelectTool` drag to use `transient()` for mousemove and `commitHistory()` on mouseup.
- Refactor `LineTool`/`CircleTool` first-click uncommitted points to use `transient()`.
- Update `ToolContext` interface to expose `transaction()` and `transient()`.

**Pros:**
- Minimal architectural change. No new dependencies.
- Catches developer mistakes immediately at runtime.
- Makes the two mutation modes (discrete vs. interactive) explicit in the API.
- The `ToolContext` interface becomes self-documenting.

**Cons:**
- Runtime-only enforcement (no compile-time safety).
- Requires auditing and updating every existing tool.

---

### Option B: draft-based transactions (Immer-style)

Mutations operate on a mutable draft object, not the live workspace. The live Angular signals are only updated when the transaction commits.

```typescript
workspace.transaction((draft) => {
    const p1 = draft.addPoint({ x: 10, y: 20 });
    const p2 = draft.addPoint({ x: 30, y: 40 });
    draft.addLine(p1, p2);
    draft.solve();
});  // → live state updated atomically, commitHistory() called

workspace.transient((draft) => {
    draft.updatePointPosition(id, newPos);
    draft.solve(draggedPointId);
});  // → live state updated, no history commit
```

**Changes required:**
- Create a `SketchDraft` class with the same mutation API as `WorkspaceService`.
- `SketchDraft` operates on a private clone of the sketch.
- On commit, the draft's final state replaces the live state in one atomic signal update.
- On error, the draft is discarded; the live state is never touched.
- Refactor `ToolContext` to expose `transaction(action)` and `transient(action)` instead of raw mutators.

**Pros:**
- **Compile-time safety**: Raw mutators (`addPoint`, `addLine`) are not on the `ToolContext` interface. Tools *must* use `transaction()` or `transient()`.
- **Zero render leakage**: Angular signals are never updated with intermediate/failed state.
- **Clean rollback**: No need to snapshot pre-state and restore on error — the draft is simply discarded.

**Cons:**
- Significant refactor of every tool, every MCP handler, and the `ToolContext` interface.
- The `SketchDraft` class duplicates the mutation surface area of `WorkspaceService`.
- Solver integration is tricky: the solver currently takes a `SketchModel` and returns a new one, but the draft would need to absorb those solver-modified coordinates.

---

### Option C: command pattern (traditional CAD)

Each user action is encapsulated as a command object with `execute()` and `undo()` methods. A `CommandManager` maintains the undo/redo stacks of commands rather than state snapshots.

```typescript
class AddLineCommand implements Command {
    private lineId?: string;
    constructor(private p1Id: string, private p2Id: string) {}

    execute(sketch: SketchModel): SketchModel {
        const clone = cloneSketchForMutation(sketch);
        this.lineId = generateNextId('L');
        clone.lines.push({ id: this.lineId, p1Id: this.p1Id, p2Id: this.p2Id });
        return clone;
    }

    undo(sketch: SketchModel): SketchModel {
        const clone = cloneSketchForMutation(sketch);
        clone.lines = clone.lines.filter(l => l.id !== this.lineId);
        return clone;
    }
}

// Composite command for grouped operations
class CompositeCommand implements Command {
    constructor(private commands: Command[]) {}
    execute(sketch) { return this.commands.reduce((s, c) => c.execute(s), sketch); }
    undo(sketch) { return this.commands.reduceRight((s, c) => c.undo(s), sketch); }
}
```

**Pros:**
- Memory-efficient: stores deltas, not full snapshots.
- Industry-proven in professional CAD (AutoCAD, SolidWorks, FreeCAD).
- Commands are serializable — useful for collaboration, macros, and audit trails.

**Cons:**
- **High implementation burden**: Every mutation type requires a hand-written inverse.
- **Solver interaction is the hard problem**: When the solver runs, it potentially moves *every* point in the sketch. The `AddConstraintCommand.undo()` would need to restore all those original point positions, not just remove the constraint. This effectively requires snapshotting the full solver output anyway, negating much of the memory benefit.[^2]
- Significant architectural refactor.

[^2]: SolveSpace uses a full-snapshot approach despite being a traditional CAD kernel, likely for this exact reason — the constraint solver's global side effects make delta-based undo impractical for geometry.

---

### Option D: patch-based history (Immer `produceWithPatches`)

Replace full-snapshot history with JSON patches. Use Immer's `produceWithPatches` to automatically generate forward and inverse patches for every state transition. Store `{patches, inversePatches}` on the undo stack instead of full `SketchModel` clones.

**Pros:**
- Dramatically reduces memory usage (patches are small for most operations).
- No hand-written inverses — Immer generates them automatically.
- Patches are serializable (useful for persistence, networking).

**Cons:**
- Adds Immer as a dependency.
- Solver runs that rewrite many point coordinates produce large patches (potentially larger than a snapshot for complex sketches).
- Immer's proxy overhead adds CPU cost to every mutation.

---

## 5. Comparison matrix

| Criterion | A: Runtime guard | B: Draft-based | C: Command pattern | D: Patch-based |
|---|---|---|---|---|
| **Implementation effort** | 🟢 Low | 🟡 Medium | 🔴 High | 🟡 Medium |
| **Compile-time safety** | 🔴 None | 🟢 Strong | 🟢 Strong | 🔴 None |
| **Runtime safety** | 🟢 Strong | 🟢 Strong | 🟢 Strong | 🟢 Strong |
| **Memory efficiency** | 🔴 Same as today | 🔴 Same as today | 🟢 Delta-based | 🟢 Delta-based |
| **Render leakage** | 🟡 Still possible | 🟢 Zero leakage | 🟢 Zero leakage | 🟡 Still possible |
| **Solver integration** | 🟢 No change needed | 🟡 Draft absorbs result | 🔴 Must snapshot solver output | 🟡 Patches after solve |
| **Drag coalescing** | 🟢 Explicit `transient()` | 🟢 Explicit `transient()` | 🟡 Manual event coalescing | 🟡 Manual event coalescing |
| **Collaboration-ready** | 🔴 No | 🔴 No | 🟡 Commands serializable | 🟡 Patches serializable |

---

## 6. Recommendation

**Short-term (now):** Implement **Option A (runtime transaction guard)**. It delivers the core safety guarantee — no more orphaned mutations — with minimal disruption to the existing codebase. The `transaction()` / `transient()` API makes the two mutation modes explicit and self-documenting.

**Medium-term (when sketch complexity grows):** Layer **Option D (patch-based history)** on top. Replace the full-snapshot `HistoryManager` with a patch store to reduce memory pressure. This is an internal change to `HistoryManager` and `WorkspaceService` that does not affect the tool API surface.

**Long-term (if collaboration is needed):** Evaluate a CRDT-based approach (Figma-style) with per-user undo stacks. This would be a ground-up redesign of the state layer and is out of scope for the current POC.

---

## 7. Open questions

1. **Should `transaction()` automatically call `solve()`?** Today, interactive tools call `solve()` explicitly. If `transaction()` always solved, it would simplify the tool API but remove control over when solving happens. Some tools (like the MCP `addPoint` handler) intentionally skip solving.

2. **How should multi-step tool workflows work?** The `LineTool` creates an uncommitted point on the first click and only commits on the second click. Under Option A, the first click would use `transient()`. But if the user switches tools mid-flow, the transient point is orphaned. Should `transient()` support automatic cleanup on tool deactivation?

3. **Should `ToolContext` expose raw mutators at all?** Under Option B, the answer is no — tools only see `transaction()` and `transient()`. Under Option A, raw mutators remain but are guarded. The choice affects how much existing tool code needs to change.

4. **Is IndexedDB persistence on every transient mutation desirable?** The current `updateSketch()` calls `store.save()` unconditionally. For drag operations at 60 Hz, this is wasteful. Should transient mutations skip persistence, or should persistence be debounced?
