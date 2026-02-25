/**
 * ═══════════════════ HIERARCHY UI ═══════════════════
 * Builds the interactive tree structure panel in the sidebar.
 */

import { hierEl } from "./ui-inputs.js";
import { createNode, findParent, tree } from "./data-model.js";

let currentModeRef = "lateral";

export function setHierarchyMode(mode) {
    currentModeRef = mode;
}

export function renderHierarchy() {
    hierEl.innerHTML = "";
    hierEl.appendChild(buildNodeEl(tree, 0, true));
}

function buildNodeEl(node, depth, isTrunk) {
    const div = document.createElement("div");
    const row = document.createElement("div");
    row.className = "tree-node-row";

    // ── Toggle ──
    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    if (node.children.length > 0) {
        toggle.textContent = "▶";
        if (node.expanded) toggle.classList.add("open");
        toggle.addEventListener("click", (e) => {
            e.stopPropagation();
            node.expanded = !node.expanded;
            renderHierarchy();
        });
    } else {
        toggle.classList.add("empty");
    }

    // ── Icon ──
    const icon = document.createElement("span");
    icon.className = "tree-node-icon";
    icon.textContent = isTrunk
        ? "🪵"
        : node.children.length === 0
            ? "🍃"
            : "🌿";

    // ── Label ──
    const label = document.createElement("span");
    label.className = "tree-node-label";
    if (isTrunk) {
        label.classList.add("trunk-label");
        label.textContent = "Trunk";
    } else if (node.children.length === 0) {
        label.textContent = "Leaf";
    } else {
        let verb = "Sprouts";
        if (currentModeRef === "division") verb = "Divides";
        else if (currentModeRef === "planned") verb = "Allocates";
        label.textContent = `${verb} → ${node.children.length}`;
    }

    // ── Badge ──
    const badge = document.createElement("span");
    badge.className = "tree-node-badge";
    badge.textContent = `L${depth}`;

    // ── Add button ──
    const addBtn = document.createElement("span");
    addBtn.className = "tree-node-add";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        node.children.push(createNode());
        node.expanded = true;
        renderHierarchy();
    });

    // ── Delete button ──
    const delBtn = document.createElement("span");
    delBtn.className = "tree-node-del";
    delBtn.textContent = "✕";
    if (!isTrunk) {
        delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const par = findParent(tree, node.id, null);
            if (par) {
                par.children = par.children.filter((c) => c.id !== node.id);
                renderHierarchy();
            }
        });
    } else {
        delBtn.style.display = "none";
    }

    row.append(toggle, icon, label, badge, addBtn, delBtn);
    div.appendChild(row);

    // ── Children ──
    if (node.children.length > 0) {
        const ch = document.createElement("div");
        ch.className = "tree-children";
        if (!node.expanded) ch.classList.add("collapsed");
        node.children.forEach((c) =>
            ch.appendChild(buildNodeEl(c, depth + 1, false))
        );
        div.appendChild(ch);
    }
    return div;
}
