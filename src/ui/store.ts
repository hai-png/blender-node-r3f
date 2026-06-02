/**
 * Zustand store wrapping a NodeTree for React Flow + UI consumers.
 *
 * The NodeTree is the source of truth; this store exposes versioned
 * snapshots so React renders cheaply.
 */
import { create } from 'zustand';
import type { NodeTree } from '../core/NodeTree';

export interface TreeStoreState {
  tree: NodeTree;
  /** Incremented on every tree edit — components subscribe to force re-render. */
  version: number;
  selectedNodeIds: Set<string>;
  setTree(tree: NodeTree): void;
  bumpVersion(): void;
  setSelected(ids: string[]): void;
}

export const useTreeStore = create<TreeStoreState>((set, get) => ({
  tree: null as unknown as NodeTree,   // set on app mount
  version: 0,
  selectedNodeIds: new Set(),
  setTree(tree) {
    // wire the tree's event bus to bump version
    const prev = get().tree;
    if (prev) {
      // noop — previous tree's subscribers will be garbage-collected
    }
    tree.subscribe(() => set((s) => ({ version: s.version + 1 })));
    set({ tree, version: 0, selectedNodeIds: new Set() });
  },
  bumpVersion() {
    set((s) => ({ version: s.version + 1 }));
  },
  setSelected(ids) {
    set({ selectedNodeIds: new Set(ids) });
  },
}));
