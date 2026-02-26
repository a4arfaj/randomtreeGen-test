/**
 * ═══════════════════ DATA MODEL ═══════════════════
 * Tree node structure and tree traversal utilities.
 */

import { ensureIdCounterAtLeast, uid } from "./utils.js";

// ── Node factory ──
export function createNode() {
    return { id: uid(), expanded: true, children: [] };
}

// ── Default tree ──
export let tree = createNode();
tree.children = [
    (() => {
        const b = createNode();
        b.children = [createNode(), createNode()];
        return b;
    })(),
    (() => {
        const b = createNode();
        b.children = [createNode()];
        return b;
    })(),
];

// ── Find parent of a node by id ──
export function findParent(root, id, par) {
    if (root.id === id) return par;
    for (const ch of root.children) {
        const p = findParent(ch, id, root);
        if (p) return p;
    }
    return null;
}

function cloneNodeSnapshot(node) {
    return {
        id: node.id || uid(),
        expanded: node.expanded !== false,
        children: (node.children || []).map(cloneNodeSnapshot),
    };
}

function maxNumericNodeId(node) {
    if (!node) return 0;
    let maxId = 0;
    const walk = (n) => {
        if (!n) return;
        const m = /^n(\d+)$/.exec(String(n.id || ""));
        if (m) maxId = Math.max(maxId, Number(m[1]));
        for (const c of (n.children || [])) walk(c);
    };
    walk(node);
    return maxId;
}

function cloneNodeSnapshotWithUniqueIds(node, seen = new Set()) {
    const rawId = node?.id;
    const preferredId = typeof rawId === "string" && rawId ? rawId : uid();
    const id = !seen.has(preferredId) ? preferredId : uid();
    seen.add(id);
    return {
        id,
        expanded: node?.expanded !== false,
        children: (node?.children || []).map((c) => cloneNodeSnapshotWithUniqueIds(c, seen)),
    };
}

/**
 * Plain-JSON snapshot for persistence.
 */
export function snapshotTree(root = tree) {
    return cloneNodeSnapshot(root);
}

/**
 * Load a snapshot into the live `tree` object while keeping the module binding stable.
 */
export function loadTreeSnapshot(snapshot) {
    // Keep uid() above existing ids, then normalize duplicates from older saved data.
    ensureIdCounterAtLeast(maxNumericNodeId(snapshot));
    const next = cloneNodeSnapshotWithUniqueIds(snapshot || createNode());
    ensureIdCounterAtLeast(maxNumericNodeId(next));
    tree.id = next.id;
    tree.expanded = next.expanded;
    tree.children = next.children;
}
