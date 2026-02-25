/**
 * APP
 * Main entry point: events, generation, state, rendering.
 */

import { rand, dpr, updateDpr } from "./utils.js";
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
} from "./ui-inputs.js";

import { renderHierarchy, setHierarchyMode } from "./hierarchy-ui.js";
import { resetCollisionState, prepareSubtreeSpace } from "./collision.js";
import { buildBranchDivision } from "./builder-division.js";
import { buildBranchLateral } from "./builder-lateral.js";
import { renderScene } from "./renderer.js";
import {
    buildBranchDot,
    generateDotGrid,
    findClosestFreeDot,
    tuneDotRangesForTree,
    buildGroundStemToDot,
} from "./builder-dot.js";

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

function generateTree() {
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
    } else if (state.currentMode === "dot") {
        const rawRanges = getDotRanges();
        const spacing = rawRanges.dotSpacing;
        const cols = rawRanges.gridCols;
        const rows = rawRanges.gridRows;
        const gridCx = W / 2;

        // ── Trunk gap: dot crown sits above a real trunk
        const trunkH = Math.max(80, spacing * 4);   // visible trunk height
        const crownBottomY = groundY - trunkH;         // bottom of dot grid
        const gridCy = crownBottomY - (Math.floor(rows / 2)) * spacing;

        const dots = generateDotGrid(gridCx, gridCy, spacing, cols, rows, rawRanges.shape);
        const ranges = tuneDotRangesForTree(tree, rawRanges, dots.length);
        const dotMap = new Map();
        dots.forEach((d, i) => dotMap.set(`${d.col},${d.row}`, i));

        // Start dot = bottommost dot closest to centre
        const startIdx = findClosestFreeDot(dots, gridCx, crownBottomY + spacing * 0.5);
        if (startIdx >= 0) {
            // Draw trunk from ground up to first dot
            buildGroundStemToDot(gridCx, groundY, dots[startIdx], ranges.trunkWid, state.allBranches);
            // Build dot-grid crown
            buildBranchDot(
                tree, startIdx, dots, dotMap, 0,
                ranges, state.allBranches, spacing,
                { dx: 0, dy: -1 }
            );
        }
        state.dotGridData = { dots, dotSpacing: spacing };
    }

    renderScene(state);
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
btnGenerate.addEventListener("click", generateTree);
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
