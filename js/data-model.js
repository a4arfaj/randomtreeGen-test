/**
 * ═══════════════════ DATA MODEL ═══════════════════
 * Tree node structure and tree traversal utilities.
 */

import { uid } from "./utils.js";

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
    const next = cloneNodeSnapshot(snapshot || createNode());
    tree.id = next.id;
    tree.expanded = next.expanded;
    tree.children = next.children;
}
