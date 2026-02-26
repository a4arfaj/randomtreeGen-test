/**
 * APP
 * Main entry point: events, generation, state, rendering.
 */

import { rand, dpr, updateDpr, setSeed } from "./utils.js";
import { tree, snapshotTree, loadTreeSnapshot } from "./data-model.js";
import {
    canvas,
    ctx,
    btnGenerate,
    btnDownload,
    modeSelect,
    chkDebugView,
    chkSubBranchFade,
    rFadeLevel,
    rvFadeLevel,
    getRanges,
    getLateralRanges,
    getDotRanges,
    sectionLateral,
    sectionDot,
} from "./ui-inputs.js";

import { renderHierarchy, setHierarchyMode } from "./hierarchy-ui.js";
import {
    resetCollisionState,
    prepareSubtreeSpace,
    distToSegmentSquared,
} from "./collision.js";
import { buildBranchDivision } from "./builder-division.js";
import { buildBranchLateral } from "./builder-lateral.js";
import {
    buildBranchPlanned,
    preparePlannedTree,
    resetPlannedBaseMap,
} from "./builder-planned.js";
import { renderScene } from "./renderer.js";
import {
    buildBranchDot,
    generateDotGrid,
    findClosestFreeDot,
    tuneDotRangesForTree,
} from "./builder-dot.js";
import { Agent, snapshotBranches, restoreBranches } from "./agent.js";
import { buildLeafCollisionCircles } from "./leaf.js";

const state = {
    currentMode: modeSelect.value,
    allBranches: [],
    hoveredBranch: null,
    selectedBranch: null,
    selectedNodeIds: null,
    isDebug: false,
    isSubBranchFade: false,
    fadeFromLevel: 2,
    rFadeLevel,
    rvFadeLevel,
    dotGridData: null,
    showDots: false,
    showAllCollisions: false,
    tree: null,
    agent: new Agent(),
};

const STORAGE_KEY = "treeBuilder.savedHierarchies.v1";
const btnSave = document.getElementById("btn-save");
const saveModal = document.getElementById("save-manager-modal");
const saveNameInput = document.getElementById("save-name-input");
const saveCurrentBtn = document.getElementById("btn-save-current");
const savedListEl = document.getElementById("saved-list");
const closeSaveModalBtn = document.getElementById("btn-close-save-manager");

function readSavedHierarchies() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeSavedHierarchies(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function saveCurrentHierarchy(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const items = readSavedHierarchies().filter((x) => x.name !== trimmed);
    items.unshift({
        name: trimmed,
        savedAt: new Date().toISOString(),
        tree: snapshotTree(tree),
    });
    writeSavedHierarchies(items);
}

function loadHierarchyByName(name) {
    const item = readSavedHierarchies().find((x) => x.name === name);
    if (!item?.tree) return;
    loadTreeSnapshot(item.tree);
    syncUI();
    generateTree();
}

function deleteHierarchyByName(name) {
    const next = readSavedHierarchies().filter((x) => x.name !== name);
    writeSavedHierarchies(next);
}

function renderSavedList() {
    if (!savedListEl) return;
    const items = readSavedHierarchies();
    savedListEl.innerHTML = "";

    if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "saved-item-empty";
        empty.textContent = "No saved hierarchies yet.";
        savedListEl.appendChild(empty);
        return;
    }

    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "saved-item-row";

        const meta = document.createElement("div");
        meta.className = "saved-item-meta";

        const title = document.createElement("div");
        title.className = "saved-item-title";
        title.textContent = item.name;

        const date = document.createElement("div");
        date.className = "saved-item-date";
        const dt = new Date(item.savedAt);
        date.textContent = Number.isNaN(dt.getTime())
            ? ""
            : dt.toLocaleString();

        const actions = document.createElement("div");
        actions.className = "saved-item-actions";

        const loadBtn = document.createElement("button");
        loadBtn.className = "btn btn-secondary saved-action-btn";
        loadBtn.textContent = "Load";
        loadBtn.addEventListener("click", () => {
            loadHierarchyByName(item.name);
            closeSaveManager();
        });

        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-secondary saved-action-btn danger";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", () => {
            deleteHierarchyByName(item.name);
            renderSavedList();
        });

        meta.append(title, date);
        actions.append(loadBtn, delBtn);
        row.append(meta, actions);
        savedListEl.appendChild(row);
    });
}

function openSaveManager() {
    if (!saveModal) return;
    renderSavedList();
    saveModal.classList.add("open");
    saveModal.style.display = "flex";
}

function closeSaveManager() {
    if (!saveModal) return;
    saveModal.classList.remove("open");
    saveModal.style.display = "none";
}

function syncUI() {
    state.currentMode = modeSelect.value;
    setHierarchyMode(state.currentMode);

    if (sectionLateral) {
        sectionLateral.style.display = state.currentMode === "lateral" ? "block" : "none";
    }
    if (sectionDot) {
        sectionDot.style.display = state.currentMode === "dot" ? "block" : "none";
    }

    renderHierarchy();
}

modeSelect.addEventListener("change", () => {
    syncUI();
    generateTree();
});

if (chkDebugView) {
    chkDebugView.addEventListener("change", () => {
        state.isDebug = chkDebugView.checked;
        if (!state.isDebug) {
            state.hoveredBranch = null;
            state.selectedBranch = null;
            state.selectedNodeIds = null;
        }
        renderScene(state);
    });
}

if (chkSubBranchFade) {
    chkSubBranchFade.addEventListener("change", () => {
        state.isSubBranchFade = chkSubBranchFade.checked;
        renderScene(state);
    });
}

if (rFadeLevel && rvFadeLevel) {
    rvFadeLevel.textContent = rFadeLevel.value;
    state.fadeFromLevel = +rFadeLevel.value;
    rFadeLevel.addEventListener("input", () => {
        rvFadeLevel.textContent = rFadeLevel.value;
        state.fadeFromLevel = +rFadeLevel.value;
        if (chkSubBranchFade && !chkSubBranchFade.checked) {
            chkSubBranchFade.checked = true;
            state.isSubBranchFade = true;
        }
        renderScene(state);
    });
}

const chkShowDots = document.getElementById("chk-show-dots");
const chkShowAllCollisions = document.getElementById("chk-show-all-collisions");

function refreshDotPreview() {
    updateDpr();
    const ranges = getDotRanges();
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const groundY = H * 0.87;
    const gridCx = W / 2;
    const gridCy = groundY - (ranges.gridRows * ranges.dotSpacing) * 0.5;
    const dots = generateDotGrid(
        gridCx,
        gridCy,
        ranges.dotSpacing,
        ranges.gridCols,
        ranges.gridRows,
        ranges.shape
    );
    state.dotGridData = { dots, dotSpacing: ranges.dotSpacing };
}

if (chkShowDots) {
    const onToggleDots = () => {
        state.showDots = chkShowDots.checked;
        if (state.showDots) refreshDotPreview();
        renderScene(state);
    };
    chkShowDots.addEventListener("change", onToggleDots);
    chkShowDots.addEventListener("input", onToggleDots);
}
if (chkShowAllCollisions) {
    chkShowAllCollisions.addEventListener("change", () => {
        state.showAllCollisions = chkShowAllCollisions.checked;
        renderScene(state);
    });
}

canvas.addEventListener("mousemove", (e) => {
    if (!state.isDebug) return;
    const found = findBranchAtEvent(e);
    if (found !== state.hoveredBranch) {
        state.hoveredBranch = found;
        renderScene(state);
    }
});

canvas.addEventListener("click", (e) => {
    if (!state.isDebug) return;
    const found = findBranchAtEvent(e);
    state.selectedBranch = found;
    state.selectedNodeIds = found?.nodeId ? buildAncestorNodeIdSet(found.nodeId) : null;
    renderScene(state);
});

function findBranchAtEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const rx = x / dpr;
    const ry = y / dpr;
    if (e.shiftKey) {
        // Find leaves by radius
        for (let i = state.allBranches.length - 1; i >= 0; i--) {
            const b = state.allBranches[i];
            if (b.isLeaf && b.leafData) {
                const dx = b.leafData.x - rx;
                const dy = b.leafData.y - ry;
                // generous hit radius for the leaf
                const r = b.leafData.size * 0.8;
                if (dx * dx + dy * dy <= r * r) return b;
            }
        }
        return null;
    }

    for (let i = state.allBranches.length - 1; i >= 0; i--) {
        const b = state.allBranches[i];
        if (ctx.isPointInPath(b.path2d, rx, ry)) return b;
    }
    return null;
}

function buildAncestorNodeIdSet(nodeId) {
    const path = [];
    if (!collectNodePath(tree, nodeId, path)) return null;
    return new Set(path.map((n) => n.id));
}

function collectNodePath(node, targetId, out) {
    if (!node) return false;
    out.push(node);
    if (node.id === targetId) return true;
    for (const ch of node.children || []) {
        if (collectNodePath(ch, targetId, out)) return true;
    }
    out.pop();
    return false;
}

let currentEpochSeed = Date.now();

function generateTree(isRetry = false) {
    if (isRetry !== true) currentEpochSeed = Date.now();
    setSeed(currentEpochSeed);
    updateDpr();
    resetCollisionState();
    state.allBranches = [];
    state.hoveredBranch = null;
    state.selectedBranch = null;
    state.selectedNodeIds = null;
    state.showDots = !!chkShowDots?.checked;

    tree._targetAngle = rand(-0.03, 0.03);

    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    const groundY = H * 0.87;

    if (state.currentMode === "division") {
        const ranges = getRanges();
        prepareSubtreeSpace(tree, ranges, "division");
        buildBranchDivision(
            tree,
            W / 2,
            groundY,
            tree._targetAngle,
            ranges.trunkWid,
            0,
            ranges,
            state.allBranches
        );
        if (state.showDots) refreshDotPreview();
        else state.dotGridData = null;
    } else if (state.currentMode === "lateral") {
        const ranges = getLateralRanges();
        prepareSubtreeSpace(tree, ranges, "lateral");
        buildBranchLateral(
            tree,
            W / 2,
            groundY,
            tree._targetAngle,
            ranges.trunkWid,
            0,
            ranges,
            state.allBranches
        );
        if (state.showDots) refreshDotPreview();
        else state.dotGridData = null;
    } else if (state.currentMode === "planned") {
        tree._targetAngle = 0;
        resetPlannedBaseMap();
        const profile = preparePlannedTree(tree, H, groundY);
        buildBranchPlanned(
            tree,
            W / 2,
            groundY,
            0,
            profile.trunkWid,
            0,
            profile,
            state.allBranches
        );
        annotatePlannedCollisions(state.allBranches);
        if (state.showDots) refreshDotPreview();
        else state.dotGridData = null;
    } else if (state.currentMode === "dot") {
        const rawRanges = getDotRanges();
        const spacing = rawRanges.dotSpacing;
        const cols = rawRanges.gridCols;
        const rows = rawRanges.gridRows;
        const gridCx = W / 2;

        // Grid sits on the ground
        const gridCy = groundY - (Math.floor(rows / 2)) * spacing;

        const dots = generateDotGrid(gridCx, gridCy, spacing, cols, rows, rawRanges.shape);
        const ranges = tuneDotRangesForTree(tree, rawRanges, dots.length);
        const dotMap = new Map();
        dots.forEach((d, i) => dotMap.set(`${d.col},${d.row}`, i));

        // Start dot = closest dot to bottom centre
        const startIdx = findClosestFreeDot(dots, gridCx, groundY);
        if (startIdx >= 0) {
            buildBranchDot(
                tree, startIdx, dots, dotMap, 0,
                ranges, state.allBranches, spacing,
                { dx: 0, dy: -1 }
            );
        }
        state.dotGridData = { dots, dotSpacing: spacing };
    }

    state.tree = tree;
    state.agent._buildParentMap(tree); // ensure parentMap is available for collision overlay
    if (state.agent.active) state.agent.stop(state); // reset agent if user regenerates
    renderScene(state);
}

function annotatePlannedCollisions(allBranches) {
    for (const b of allBranches) {
        b.collisionPoints = [];
        b.leafCollision = false;
    }

    const branches = allBranches.filter((b) => !b.isLeaf && b.path?.samples?.length >= 4);
    const leaves = allBranches.filter((b) => b.isLeaf && b.leafData);

    const startIdx = (b) => {
        const n = b.path.samples.length;
        return Math.min(n - 2, Math.max(1, Math.floor(n * (b.baseAllowT ?? 0.25))));
    };

    // Branch-vs-branch collisions (ignore first 25% base allowance on both branches).
    for (let i = 0; i < branches.length; i++) {
        for (let j = i + 1; j < branches.length; j++) {
            const a = branches[i];
            const b = branches[j];
            const a0 = startIdx(a);
            const b0 = startIdx(b);
            let found = null;

            for (let ai = a0; ai < a.path.samples.length; ai += 2) {
                const p = a.path.samples[ai];
                for (let bj = b0; bj < b.path.samples.length - 2; bj += 2) {
                    const q0 = b.path.samples[bj];
                    const q1 = b.path.samples[bj + 2];
                    const d2 = distToSegmentSquared(p, q0, q1);
                    const qw = ((q0.w || 1) + (q1.w || 1)) * 0.5;
                    const minDist = (p.w || 1) * 0.5 + qw * 0.5;
                    if (d2 < minDist * minDist * 0.65) {
                        found = { x: p.x, y: p.y };
                        break;
                    }
                }
                if (found) break;
            }

            if (found) {
                a.collisionPoints.push(found);
                b.collisionPoints.push(found);
            }
        }
    }

    // Leaf-vs-leaf body collisions (real leaf body circles).
    const leafPolys = leaves.map((b) => ({ b, poly: buildLeafPolygonFromData(b.leafData) }));
    for (let i = 0; i < leafPolys.length; i++) {
        for (let j = i + 1; j < leafPolys.length; j++) {
            const a = leafPolys[i];
            const b = leafPolys[j];
            if (polysIntersect(a.poly, b.poly)) {
                const pa = a.b.leafData;
                const pb = b.b.leafData;
                const hit = { x: (pa.x + pb.x) * 0.5, y: (pa.y + pb.y) * 0.5 };
                a.b.leafCollision = true;
                b.b.leafCollision = true;
                a.b.collisionPoints.push(hit);
                b.b.collisionPoints.push(hit);
            }
        }
    }

    // Leaf-vs-branch body collisions by polygon intersection (outside base-allow zone).
    const branchPolys = branches.map((b) => ({
        b,
        poly: buildBranchPolyFromPath(b.path, b.baseAllowT ?? 0.25),
    }));
    for (const lp of leafPolys) {
        for (const bp of branchPolys) {
            if (!bp.poly.length) continue;
            if (polysIntersect(lp.poly, bp.poly)) {
                lp.b.leafCollision = true;
                const hit = { x: lp.b.leafData.x, y: lp.b.leafData.y };
                lp.b.collisionPoints.push(hit);
                bp.b.collisionPoints.push(hit);
            }
        }
    }

    // Legacy circle checks kept as fallback for near-touch cases.
    for (let i = 0; i < leaves.length; i++) {
        const a = leaves[i];
        const ca = buildLeafCollisionCircles(a.leafData);
        for (let j = i + 1; j < leaves.length; j++) {
            const b = leaves[j];
            const cb = buildLeafCollisionCircles(b.leafData);
            let hit = null;
            for (const c1 of ca) {
                for (const c2 of cb) {
                    const dx = c1.x - c2.x;
                    const dy = c1.y - c2.y;
                    const rr = c1.r + c2.r;
                    if (dx * dx + dy * dy < rr * rr) {
                        hit = { x: (c1.x + c2.x) * 0.5, y: (c1.y + c2.y) * 0.5 };
                        break;
                    }
                }
                if (hit) break;
            }
            if (hit) {
                a.leafCollision = true;
                b.leafCollision = true;
                a.collisionPoints.push(hit);
                b.collisionPoints.push(hit);
            }
        }
    }

    // Leaf-vs-branch body collisions (ignore branch base-allow zone).
    for (const leafBranch of leaves) {
        const circles = buildLeafCollisionCircles(leafBranch.leafData);
        for (const br of branches) {
            const b0 = startIdx(br);
            let hit = null;
            for (const c of circles) {
                for (let bi = b0; bi < br.path.samples.length - 2; bi += 2) {
                    const s0 = br.path.samples[bi];
                    const s1 = br.path.samples[bi + 2];
                    const d2 = distToSegmentSquared(c, s0, s1);
                    const bw = ((s0.w || 1) + (s1.w || 1)) * 0.5;
                    const minDist = c.r + bw * 0.5;
                    if (d2 < minDist * minDist) {
                        hit = { x: c.x, y: c.y };
                        break;
                    }
                }
                if (hit) break;
            }
            if (hit) {
                leafBranch.leafCollision = true;
                leafBranch.collisionPoints.push(hit);
                br.collisionPoints.push(hit);
            }
        }
    }
}

function bezierPoint(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
        x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
        y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
    };
}

function buildLeafPolygonFromData(leaf, steps = 10) {
    if (!leaf) return [];
    const right = [];
    const left = [];
    const p0 = { x: 0, y: -18 };
    const p1 = { x: 3.25, y: -11.7 };
    const p2 = { x: 4.55, y: -7.2 };
    const p3 = { x: 0, y: 0 };
    const q0 = { x: 0, y: 0 };
    const q1 = { x: -4.55, y: -7.2 };
    const q2 = { x: -3.25, y: -11.7 };
    const q3 = { x: 0, y: -18 };
    for (let i = 0; i <= steps; i++) right.push(bezierPoint(p0, p1, p2, p3, i / steps));
    for (let i = 0; i <= steps; i++) left.push(bezierPoint(q0, q1, q2, q3, i / steps));
    const poly = right.concat(left);

    const s = (leaf.size || 18) / 18;
    const c = Math.cos(leaf.angle || 0);
    const sn = Math.sin(leaf.angle || 0);
    return poly.map((p) => {
        const lx = p.x * s;
        const ly = (p.y + 9) * s;
        return {
            x: leaf.x + lx * c - ly * sn,
            y: leaf.y + lx * sn + ly * c,
        };
    });
}

function buildBranchPolyFromPath(path, baseAllowT = 0.25) {
    if (!path?.left || !path?.right) return [];
    const n = Math.min(path.left.length, path.right.length);
    if (n < 4) return [];
    const s = Math.min(n - 2, Math.max(1, Math.floor(n * baseAllowT)));
    const poly = [];
    for (let i = s; i < n; i++) poly.push(path.left[i]);
    for (let i = n - 1; i >= s; i--) poly.push(path.right[i]);
    return poly;
}

function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x;
        const yi = poly[i].y;
        const xj = poly[j].x;
        const yj = poly[j].y;
        const hit = yi > pt.y !== yj > pt.y &&
            pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi;
        if (hit) inside = !inside;
    }
    return inside;
}

function segIntersect(a, b, c, d) {
    const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = o(a, b, c);
    const o2 = o(a, b, d);
    const o3 = o(c, d, a);
    const o4 = o(c, d, b);
    return (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0)
        ? false
        : (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function polysIntersect(a, b) {
    if (!a.length || !b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const a0 = a[i];
        const a1 = a[(i + 1) % a.length];
        for (let j = 0; j < b.length; j++) {
            const b0 = b[j];
            const b1 = b[(j + 1) % b.length];
            if (segIntersect(a0, a1, b0, b1)) return true;
        }
    }
    if (pointInPoly(a[0], b)) return true;
    if (pointInPoly(b[0], a)) return true;
    return false;
}

function resizeCanvas() {
    const area = document.getElementById("canvas-area");
    const rect = area.getBoundingClientRect();
    updateDpr();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    generateTree();
}

window.addEventListener("resize", resizeCanvas);
btnGenerate.addEventListener("click", () => generateTree(false));
btnDownload.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "tree.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
});

if (btnSave) {
    const onSaveClick = () => {
        if (!saveModal) {
            const name = window.prompt("Save name:");
            if (name && name.trim()) saveCurrentHierarchy(name.trim());
            return;
        }
        openSaveManager();
    };
    btnSave.addEventListener("click", onSaveClick);
    btnSave.onclick = onSaveClick;
}
if (closeSaveModalBtn) {
    closeSaveModalBtn.addEventListener("click", closeSaveManager);
}
if (saveModal) {
    saveModal.style.display = "none";
    saveModal.addEventListener("click", (e) => {
        if (e.target === saveModal) closeSaveManager();
    });
}
if (saveCurrentBtn) {
    saveCurrentBtn.addEventListener("click", () => {
        const name = saveNameInput?.value;
        if (!name || !name.trim()) return;
        saveCurrentHierarchy(name);
        saveNameInput.value = "";
        renderSavedList();
    });
}

syncUI();
state.showDots = !!chkShowDots?.checked;
resizeCanvas();
window.__openSaveManager = openSaveManager;

// ── Agent Event & Loop ──
const btnDeployAgent = document.getElementById("btn-deploy-agent");
const btnRetryAgent = document.getElementById("btn-retry-agent");
const agentDebugRuleEl = document.getElementById("agent-debug-rule");
const ruleStepCounter = document.getElementById("rule-step-counter");
const btnRulePrev = document.getElementById("btn-rule-prev");
const btnRuleNext = document.getElementById("btn-rule-next");

// Rule history: array of { rule, snapshot, targetNodeId }
const ruleHistory = [];
let ruleHistoryCursor = -1; // -1 = live (follows latest)
let isNavigating = false;   // true while user is scrubbing history

function pushRule(text, targetNodeId) {
    if (!text) return;
    // Don't push a duplicate of the last entry
    if (ruleHistory.length > 0 && ruleHistory[ruleHistory.length - 1].rule === text) return;
    // Snapshot only when we actually record a new rule.
    const snap = snapshotBranches(state.allBranches);
    // Only follow the tail if we were already there
    const wasAtTail = ruleHistoryCursor === -1 || ruleHistoryCursor === ruleHistory.length - 1;
    ruleHistory.push({ rule: text, snapshot: snap, targetNodeId });
    if (wasAtTail) {
        ruleHistoryCursor = ruleHistory.length - 1;
        isNavigating = false;
    }
    updateRuleDisplay();
}

function updateRuleDisplay() {
    if (!agentDebugRuleEl) return;
    const total = ruleHistory.length;
    if (total === 0) {
        agentDebugRuleEl.textContent = "No agent active";
        if (ruleStepCounter) ruleStepCounter.textContent = "\u2014 / \u2014";
        if (btnRulePrev) btnRulePrev.disabled = true;
        if (btnRuleNext) btnRuleNext.disabled = true;
        return;
    }
    const idx = ruleHistoryCursor < 0 ? total - 1 : Math.min(ruleHistoryCursor, total - 1);
    const entry = ruleHistory[idx];
    agentDebugRuleEl.textContent = entry.rule;
    if (ruleStepCounter) ruleStepCounter.textContent = `${idx + 1} / ${total}`;
    if (btnRulePrev) btnRulePrev.disabled = idx <= 0;
    if (btnRuleNext) btnRuleNext.disabled = idx >= total - 1;

    // Restore tree geometry to this step's snapshot (only while scrubbing)
    if (isNavigating && entry.snapshot && state.allBranches.length) {
        restoreBranches(state.allBranches, entry.snapshot);
        // Clear all white highlights then highlight the target branch
        for (const b of state.allBranches) b.isHighlightWhite = false;
        if (entry.targetNodeId) {
            const target = state.allBranches.find(b => b.nodeId === entry.targetNodeId);
            if (target) target.isHighlightWhite = true;
        }
        renderScene(state);
    }
}

if (btnRulePrev) {
    btnRulePrev.addEventListener("click", () => {
        const idx = ruleHistoryCursor < 0 ? ruleHistory.length - 1 : ruleHistoryCursor;
        ruleHistoryCursor = Math.max(0, idx - 1);
        isNavigating = true;
        updateRuleDisplay();
    });
}
if (btnRuleNext) {
    btnRuleNext.addEventListener("click", () => {
        const idx = ruleHistoryCursor < 0 ? ruleHistory.length - 1 : ruleHistoryCursor;
        ruleHistoryCursor = Math.min(ruleHistory.length - 1, idx + 1);
        // If we returned to the live tail, exit navigation mode
        isNavigating = ruleHistoryCursor < ruleHistory.length - 1;
        updateRuleDisplay();
    });
}

if (btnDeployAgent) {
    btnDeployAgent.addEventListener("click", () => {
        ruleHistory.length = 0;
        ruleHistoryCursor = -1;
        isNavigating = false;
        for (const b of state.allBranches) b.isHighlightWhite = false;
        updateRuleDisplay();
        state.agent.start(state);
    });
}
if (btnRetryAgent) {
    btnRetryAgent.addEventListener("click", () => {
        generateTree(true);
        ruleHistory.length = 0;
        ruleHistoryCursor = -1;
        isNavigating = false;
        updateRuleDisplay();
        if (agentDebugRuleEl) agentDebugRuleEl.textContent = "Tree regenerated (Ready)";
    });
}

function agentLoop() {
    if (state.agent && state.agent.active && !isNavigating) {
        try {
            if (state.agent.update(state)) {
                renderScene(state);
                const targetId = state.agent.target?.b1?.nodeId ?? null;
                pushRule(state.agent.currentRule, targetId);
            }
        } catch (err) {
            state.agent.stop(state);
            state.agent.currentRule = `Agent stopped due to error: ${err?.message || "unknown error"}`;
            updateRuleDisplay();
            renderScene(state);
            console.error("Agent update failed:", err);
        }
    }
    requestAnimationFrame(agentLoop);
}
agentLoop();
