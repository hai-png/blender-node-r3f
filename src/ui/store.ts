/**
 * Zustand store wrapping the active NodeTree for React Flow + UI consumers.
 *
 * Phase 1 change: per-tree persistence.
 *   - `trees`  — map from tree-kind-id (e.g. "shader", "geometry", "sim", …)
 *                to the live NodeTree for that slot.
 *   - `activeId` — which slot is currently displayed.
 *   - `setTree(id, tree)` — register / replace a tree for a given slot.
 *                            Previous tree is disposed if it is being replaced.
 *   - `switchTree(id)`    — change the active slot without rebuilding it.
 *
 * This replaces the old single-tree store where switching demo tabs
 * discarded all edits.
 */
import { create } from 'zustand';
import type { NodeTree } from '../core/NodeTree';

export interface TreeStoreState {
  /** All registered trees, keyed by slot id (e.g. 'shader', 'geometry', …). */
  trees: Map<string, NodeTree>;
  /** The currently-displayed slot id. */
  activeId: string;
  /** The currently-displayed tree (derived: trees.get(activeId)). */
  tree: NodeTree;
  /** Incremented on every tree edit — components subscribe to force re-render. */
  version: number;
  selectedNodeIds: Set<string>;

  /**
   * Register (or replace) the tree for a given slot id.
   * If a tree already occupies that slot it is disposed before replacement.
   * Automatically switches the active tree to this slot.
   */
  setTree(id: string, tree: NodeTree): void;

  /**
   * Switch the active slot (must already be registered via setTree).
   * Does NOT rebuild the tree — edits are preserved.
   */
  switchTree(id: string): void;

  bumpVersion(): void;
  setSelected(ids: string[]): void;
}

/** Internal helper: subscribe a tree to the version bumper. */
function wireTree(tree: NodeTree, bumpVersion: () => void): () => void {
  return tree.subscribe(() => bumpVersion());
}

// Keep a map of unsub fns so we can clean up on tree replacement.
const _unsubs = new Map<string, () => void>();

export const useTreeStore = create<TreeStoreState>((set, get) => ({
  trees: new Map(),
  activeId: '',
  tree: null as unknown as NodeTree,
  version: 0,
  selectedNodeIds: new Set(),

  setTree(id: string, tree: NodeTree) {
    // Clean up old subscription + dispose old tree for this slot.
    const prev = get().trees.get(id);
    const prevUnsub = _unsubs.get(id);
    if (prevUnsub) { prevUnsub(); _unsubs.delete(id); }
    if (prev && prev !== tree) {
      try { prev.dispose(); } catch { /* ignore */ }
    }

    // Wire the new tree.
    const bumpFn = () => set((s) => ({ version: s.version + 1 }));
    const unsub = wireTree(tree, bumpFn);
    _unsubs.set(id, unsub);

    const newTrees = new Map(get().trees);
    newTrees.set(id, tree);

    set({
      trees: newTrees,
      activeId: id,
      tree,
      version: 0,
      selectedNodeIds: new Set(),
    });
  },

  switchTree(id: string) {
    const tree = get().trees.get(id);
    if (!tree) {
      console.warn(`switchTree: slot "${id}" has no registered tree.`);
      return;
    }
    set({ activeId: id, tree, selectedNodeIds: new Set() });
  },

  bumpVersion() {
    set((s) => ({ version: s.version + 1 }));
  },

  setSelected(ids: string[]) {
    set({ selectedNodeIds: new Set(ids) });
  },
}));
