/**
 * Organic Tree Builder
 *
 * FEATURES:
 * - Dynamic Spacing: Vertical zones expand if crowded.
 * - Smart Collision Avoidance: Branches elongate/shorten/bend to find space.
 * - Mirroring: If a side is blocked, branches try to spawn on the opposite side.
 * - Sibling Resolution: Siblings push each other apart if they crowd the same space.
 * - Leaf Minibranches: Short, slim, non-sinking stems for leaves.
 * - Debug View: Yellow border on hover + Red growth zone.
 * - Layering: Branches rendered behind trunk (Children First).
 */
(function () {
  "use strict";

  const canvas = document.getElementById("tree-canvas");
  const ctx = canvas.getContext("2d");
  const hierEl = document.getElementById("tree-hierarchy");
  const btnGenerate = document.getElementById("btn-generate");
  const btnDownload = document.getElementById("btn-download");
  const modeSelect = document.getElementById("mode-select");
  const sectionLateral = document.getElementById("section-lateral");
  const chkDebugView = document.getElementById("chk-debug-view");
  const chkSubBranchFade = document.getElementById("chk-subbranch-fade");
  const rFadeLevel = document.getElementById("r-fade-level");
  const rvFadeLevel = document.getElementById("rv-fade-level");

  let currentMode = modeSelect.value;
  let drawnSegments = []; // {p1, p2, w} for collision
  let drawnLeafBodies = []; // {x, y, r} circles approximating leaf area
  let allBranches = [];   // Renderable branch objects
  let hoveredBranch = null;
  let isDebug = false;
  let isSubBranchFade = false;
  let fadeFromLevel = 2;

  function syncUI() {
    currentMode = modeSelect.value;
    if (currentMode === "lateral") {
      sectionLateral.classList.remove("hidden");
    } else {
      sectionLateral.classList.add("hidden");
    }
    renderHierarchy();
  }

  modeSelect.addEventListener("change", syncUI);
  if (chkDebugView) {
    chkDebugView.addEventListener("change", () => {
      isDebug = chkDebugView.checked;
      renderScene();
    });
  }
  if (chkSubBranchFade) {
    chkSubBranchFade.addEventListener("change", () => {
      isSubBranchFade = chkSubBranchFade.checked;
      renderScene();
    });
  }
  if (rFadeLevel && rvFadeLevel) {
    rvFadeLevel.textContent = rFadeLevel.value;
    fadeFromLevel = +rFadeLevel.value;
    rFadeLevel.addEventListener("input", () => {
      rvFadeLevel.textContent = rFadeLevel.value;
      fadeFromLevel = +rFadeLevel.value;
      // Moving the slider should always demonstrate fade immediately.
      if (chkSubBranchFade && !chkSubBranchFade.checked) {
        chkSubBranchFade.checked = true;
        isSubBranchFade = true;
      }
      renderScene();
    });
  }

  // ═══════════════════ INPUTS ═══════════════════

  const R = {
    curveMin: document.getElementById("r-curve-min"),
    curveMax: document.getElementById("r-curve-max"),
    angleMin: document.getElementById("r-angle-min"),
    angleMax: document.getElementById("r-angle-max"),
    lenMin: document.getElementById("r-len-min"),
    lenMax: document.getElementById("r-len-max"),
    trunkLen: document.getElementById("r-trunk-len"),
    trunkWid: document.getElementById("r-trunk-wid"),
    leafHue: document.getElementById("r-leaf-hue"),
  };
  const RV = {
    curveMin: document.getElementById("rv-curve-min"),
    curveMax: document.getElementById("rv-curve-max"),
    angleMin: document.getElementById("rv-angle-min"),
    angleMax: document.getElementById("rv-angle-max"),
    lenMin: document.getElementById("rv-len-min"),
    lenMax: document.getElementById("rv-len-max"),
    trunkLen: document.getElementById("rv-trunk-len"),
    trunkWid: document.getElementById("rv-trunk-wid"),
    leafHue: document.getElementById("rv-leaf-hue"),
  };
  Object.keys(R).forEach(k => {
    if (R[k]) R[k].addEventListener("input", () => { RV[k].textContent = R[k].value; });
  });

  const RL = {
    minHeight: document.getElementById("r-lat-min-height"),
    angleMin: document.getElementById("r-lat-angle-min"),
    angleMax: document.getElementById("r-lat-angle-max"),
    widthRatio: document.getElementById("r-lat-width-ratio"),
  };
  const RLV = {
    minHeight: document.getElementById("rv-lat-min-height"),
    angleMin: document.getElementById("rv-lat-angle-min"),
    angleMax: document.getElementById("rv-lat-angle-max"),
    widthRatio: document.getElementById("rv-lat-width-ratio"),
  };
  Object.keys(RL).forEach(k => {
    if (RL[k]) RL[k].addEventListener("input", () => { RLV[k].textContent = RL[k].value; });
  });

  // ═══════════════════ HELPERS ═══════════════════

  let idCounter = 0;
  const uid = () => "n" + (++idCounter);
  const lerp = (a, b, t) => a + (b - a) * t;
  const deg2rad = d => (d * Math.PI) / 180;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  let dpr = window.devicePixelRatio || 1;

  const LEAF_SIZE = 30;

  // ═══════════════════ DATA MODEL ═══════════════════

  function createNode() {
    return { id: uid(), expanded: true, children: [] };
  }

  let tree = createNode();
  tree.children = [
    (() => { const b = createNode(); b.children = [createNode(), createNode()]; return b; })(),
    (() => { const b = createNode(); b.children = [createNode()]; return b; })(),
  ];

  function findParent(root, id, par) {
    if (root.id === id) return par;
    for (const ch of root.children) {
      const p = findParent(ch, id, root);
      if (p) return p;
    }
    return null;
  }

  // ═══════════════════ HIERARCHY UI ═══════════════════

  function renderHierarchy() {
    hierEl.innerHTML = "";
    hierEl.appendChild(buildNodeEl(tree, 0, true));
  }

  function buildNodeEl(node, depth, isTrunk) {
    const div = document.createElement("div");
    const row = document.createElement("div");
    row.className = "tree-node-row";

    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    if (node.children.length > 0) {
      toggle.textContent = "▶";
      if (node.expanded) toggle.classList.add("open");
      toggle.addEventListener("click", e => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        renderHierarchy();
      });
    } else {
      toggle.classList.add("empty");
    }

    const icon = document.createElement("span");
    icon.className = "tree-node-icon";
    icon.textContent = isTrunk ? "🪵" : node.children.length === 0 ? "🍃" : "🌿";

    const label = document.createElement("span");
    label.className = "tree-node-label";
    if (isTrunk) {
      label.classList.add("trunk-label");
      label.textContent = "Trunk";
    } else if (node.children.length === 0) {
      label.textContent = "Leaf";
    } else {
      const verb = currentMode === "division" ? "Divides" : "Sprouts";
      label.textContent = `${verb} → ${node.children.length}`;
    }

    const badge = document.createElement("span");
    badge.className = "tree-node-badge";
    badge.textContent = `L${depth}`;

    const addBtn = document.createElement("span");
    addBtn.className = "tree-node-add";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", e => {
      e.stopPropagation();
      node.children.push(createNode());
      node.expanded = true;
      renderHierarchy();
    });

    const delBtn = document.createElement("span");
    delBtn.className = "tree-node-del";
    delBtn.textContent = "✕";
    if (!isTrunk) {
      delBtn.addEventListener("click", e => {
        e.stopPropagation();
        const par = findParent(tree, node.id, null);
        if (par) {
          par.children = par.children.filter(c => c.id !== node.id);
          renderHierarchy();
        }
      });
    } else {
      delBtn.style.display = "none";
    }

    row.append(toggle, icon, label, badge, addBtn, delBtn);
    div.appendChild(row);

    if (node.children.length > 0) {
      const ch = document.createElement("div");
      ch.className = "tree-children";
      if (!node.expanded) ch.classList.add("collapsed");
      node.children.forEach(c => ch.appendChild(buildNodeEl(c, depth + 1, false)));
      div.appendChild(ch);
    }
    return div;
  }

  function getRanges() {
    let cMin = +R.curveMin.value, cMax = +R.curveMax.value;
    if (cMin > cMax) [cMin, cMax] = [cMax, cMin];
    let aMin = +R.angleMin.value, aMax = +R.angleMax.value;
    if (aMin > aMax) [aMin, aMax] = [aMax, aMin];
    let lMin = +R.lenMin.value, lMax = +R.lenMax.value;
    if (lMin > lMax) [lMin, lMax] = [lMax, lMin];
    return {
      curveMin: cMin / 100, curveMax: cMax / 100,
      angleMin: aMin, angleMax: aMax,
      lenMin: lMin, lenMax: lMax,
      trunkLen: +R.trunkLen.value,
      trunkWid: +R.trunkWid.value,
      leafHue: +R.leafHue.value,
    };
  }

  function getLateralRanges() {
    let aMin = +RL.angleMin.value, aMax = +RL.angleMax.value;
    if (aMin > aMax) [aMin, aMax] = [aMax, aMin];
    const shared = getRanges();
    return {
      ...shared,
      latMinHeight: +RL.minHeight.value / 100,
      latAngleMin: aMin,
      latAngleMax: aMax,
      latWidthRatio: +RL.widthRatio.value / 100,
    };
  }

  // ═══════════════════ COLLISION LOGIC ═══════════════════

  
  function getAvgBranchLength(depth, ranges, mode) {
    if (depth === 0) return ranges.trunkLen;
    const avgLen = (ranges.lenMin + ranges.lenMax) * 0.5;
    const decay = mode === "division"
      ? Math.max(0.4, 1 - depth * 0.1)
      : Math.max(0.3, 1 - depth * 0.12);
    return avgLen * decay;
  }

  function estimateSubtreeSpace(node, depth, ranges, mode) {
    if (!node) return 0;
    if (node.children.length === 0) {
      node._spaceNeed = LEAF_SIZE * 0.8 + 8;
      node._subtreeDepth = 1;
      node._leafCount = 1;
      return node._spaceNeed;
    }

    const childSpaces = node.children.map(ch => estimateSubtreeSpace(ch, depth + 1, ranges, mode));
    const totalChildSpace = childSpaces.reduce((a, b) => a + b, 0);
    const maxChildSpace = childSpaces.length ? Math.max(...childSpaces) : 0;
    const branchLen = getAvgBranchLength(depth, ranges, mode);
    const avgAngleDeg = mode === "division"
      ? (ranges.angleMin + ranges.angleMax) * 0.5
      : (ranges.latAngleMin + ranges.latAngleMax) * 0.5;
    const lateralReach = Math.sin(deg2rad(Math.max(10, Math.min(80, avgAngleDeg)))) * branchLen;
    const ownSpan = Math.max(14, branchLen * 0.2 + lateralReach * 0.9);
    const fanOut = mode === "division"
      ? totalChildSpace * 0.55 + maxChildSpace * 0.2
      : totalChildSpace * 0.45 + maxChildSpace * 0.35;

    node._spaceNeed = ownSpan + fanOut;
    node._subtreeDepth = 1 + Math.max(0, ...node.children.map(ch => ch._subtreeDepth || 0));
    node._leafCount = node.children.reduce((acc, ch) => acc + (ch._leafCount || 0), 0);
    return node._spaceNeed;
  }

  function prepareSubtreeSpace(root, ranges, mode) {
    estimateSubtreeSpace(root, 0, ranges, mode);
  }

  function getChildrenBySpace(node) {
    return [...node.children].sort((a, b) => (b._spaceNeed || 0) - (a._spaceNeed || 0));
  }

  function solveBranchPath(opts) {
    const {
      x0, y0, startAngle, endAngle, length,
      baseWidth, tipWidth, isLeaf, ranges,
      avgWidth, requireCollisionCheck = true
    } = opts;

    const angleOffsets = [0, -0.14, 0.14, -0.28, 0.28, -0.42, 0.42];
    const lengthScales = [1, 0.9, 0.78, 0.65, 0.52, 0.4, 0.3];
    const baseCurve = isLeaf ? 0 : rand(ranges.curveMin, ranges.curveMax);
    const curveVals = isLeaf
      ? [0]
      : [
        baseCurve,
        Math.max(ranges.curveMin, baseCurve * 0.65),
        Math.min(ranges.curveMax, baseCurve * 1.35),
        ranges.curveMax
      ];
    const dirVals = isLeaf ? [0] : [1, -1];
    const shouldCheck = requireCollisionCheck && drawnSegments.length > 0;
    let fallback = null;

    for (const aOff of angleOffsets) {
      const testEndAngle = endAngle + aOff;
      for (const curve of curveVals) {
        for (const lenScale of lengthScales) {
          const testLen = Math.max(6, length * lenScale);
          for (const cDir of dirVals) {
            const p = computeBranchPath(
              x0, y0, startAngle, testEndAngle, testLen,
              baseWidth, tipWidth, curve, cDir
            );
            if (!fallback) fallback = { path: p, endAngle: testEndAngle, isCollisionFree: false };
            if (!shouldCheck || !checkCollision(p.samples, avgWidth)) {
              return { path: p, endAngle: testEndAngle, isCollisionFree: true };
            }
          }
        }
      }
    }

    return fallback || {
      path: computeBranchPath(
        x0, y0, startAngle, endAngle, Math.max(6, length),
        baseWidth, tipWidth, baseCurve, isLeaf ? 0 : 1
      ),
      endAngle,
      isCollisionFree: false
    };
  }

  function distToSegmentSquared(p, v, w) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (p.x - v.x - t * (w.x - v.x)) ** 2 + (p.y - v.y - t * (w.y - v.y)) ** 2;
  }

  function checkCollision(samples, myWidth) {
    if (drawnSegments.length === 0 && drawnLeafBodies.length === 0) return false;
    const checkStep = 2;
    const startIdx = 0;
    for (let i = startIdx; i < samples.length; i += checkStep) {
      const p = samples[i];
      const radius = myWidth * 0.55;
      for (const seg of drawnSegments) {
        if (p.x < Math.min(seg.p1.x, seg.p2.x) - 20) continue;
        if (p.x > Math.max(seg.p1.x, seg.p2.x) + 20) continue;
        if (p.y < Math.min(seg.p1.y, seg.p2.y) - 20) continue;
        if (p.y > Math.max(seg.p1.y, seg.p2.y) + 20) continue;

        const d2 = distToSegmentSquared(p, seg.p1, seg.p2);
        const minDist = (radius + seg.w * 0.55);
        if (d2 < minDist * minDist) {
          return true;
        }
      }
      for (const leaf of drawnLeafBodies) {
        const dx = p.x - leaf.x;
        const dy = p.y - leaf.y;
        const minDist = radius + leaf.r;
        if (dx * dx + dy * dy < minDist * minDist) {
          return true;
        }
      }
    }
    return false;
  }

  function addPathToCollisionMap(path, avgWidth) {
    const step = 4;
    let segmentCount = 0;
    for (let i = 0; i < path.samples.length - step; i += step) {
      drawnSegments.push({ p1: path.samples[i], p2: path.samples[i + step], w: avgWidth });
      segmentCount++;
    }
  }

  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
  }

  function createLeafRenderData(path, tipW, ranges, nodeId, angleOffset = 0, lenMul = 1) {
    const len = lerp(1.5, 3.5, hash01(nodeId + ":leafLen")) * lenMul;
    const ang = path.tipTangentAngle + lerp(-0.08, 0.08, hash01(nodeId + ":leafAng")) + angleOffset;
    const x = path.tipX + Math.sin(ang) * len;
    const y = path.tipY - Math.cos(ang) * len;
    return {
      x,
      y,
      angle: ang,
      size: LEAF_SIZE,
      hue: ranges.leafHue,
      stemHalfWidth: Math.min(tipW * 0.35, 0.9),
    };
  }

  function buildLeafCollisionCircles(leaf) {
    const dirX = Math.sin(leaf.angle);
    const dirY = -Math.cos(leaf.angle);
    const halfLen = leaf.size * 0.5;
    return [
      { x: leaf.x + dirX * (halfLen * 0.34), y: leaf.y + dirY * (halfLen * 0.34), r: leaf.size * 0.16 },
      { x: leaf.x + dirX * (halfLen * 0.02), y: leaf.y + dirY * (halfLen * 0.02), r: leaf.size * 0.2 },
      { x: leaf.x - dirX * (halfLen * 0.30), y: leaf.y - dirY * (halfLen * 0.30), r: leaf.size * 0.14 },
    ];
  }

  function hasLeafBodyCollision(leaf) {
    const circles = buildLeafCollisionCircles(leaf);
    for (const c of circles) {
      for (const seg of drawnSegments) {
        if (c.x < Math.min(seg.p1.x, seg.p2.x) - (c.r + 20)) continue;
        if (c.x > Math.max(seg.p1.x, seg.p2.x) + (c.r + 20)) continue;
        if (c.y < Math.min(seg.p1.y, seg.p2.y) - (c.r + 20)) continue;
        if (c.y > Math.max(seg.p1.y, seg.p2.y) + (c.r + 20)) continue;
        const d2 = distToSegmentSquared(c, seg.p1, seg.p2);
        const minDist = c.r + seg.w * 0.55;
        if (d2 < minDist * minDist) return true;
      }
      for (const existing of drawnLeafBodies) {
        const dx = c.x - existing.x;
        const dy = c.y - existing.y;
        const minDist = c.r + existing.r;
        if (dx * dx + dy * dy < minDist * minDist) return true;
      }
    }
    return false;
  }

  function fitLeafRenderData(path, tipW, ranges, nodeId) {
    const angleOffsets = [0, -0.2, 0.2, -0.34, 0.34];
    const lenMul = [1, 1.22, 0.84];
    for (const off of angleOffsets) {
      for (const lm of lenMul) {
        const candidate = createLeafRenderData(path, tipW, ranges, nodeId, off, lm);
        if (!hasLeafBodyCollision(candidate)) return candidate;
      }
    }
    return createLeafRenderData(path, tipW, ranges, nodeId);
  }

  function addLeafBodyToCollisionMap(leaf) {
    const circles = buildLeafCollisionCircles(leaf);
    for (const c of circles) drawnLeafBodies.push(c);
  }

  // ═══════════════════ PATH COMPUTATION ═══════════════════

  function computeBranchPath(x0, y0, startAngle, endAngle, length, w0, w1, curviness, curveDir) {
    const endX = x0 + Math.sin(endAngle) * length;
    const endY = y0 - Math.cos(endAngle) * length;
    const cpDist = length * 0.45;
    const cx1 = x0 + Math.sin(startAngle) * cpDist;
    const cy1 = y0 - Math.cos(startAngle) * cpDist;
    const cx2 = endX - Math.sin(endAngle) * cpDist;
    const cy2 = endY + Math.cos(endAngle) * cpDist;

    const midAngle = (startAngle + endAngle) / 2;
    const perpMid = midAngle + Math.PI / 2;
    const curveOffset = curviness * length * 0.4 * curveDir;

    const cx1f = cx1 + Math.cos(perpMid) * curveOffset * 0.5;
    const cy1f = cy1 + Math.sin(perpMid) * curveOffset * 0.5;
    const cx2f = cx2 + Math.cos(perpMid) * curveOffset * 0.35;
    const cy2f = cy2 + Math.sin(perpMid) * curveOffset * 0.35;

    const STEPS = 20;
    const pts = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const mt = 1 - t;
      const mt2 = mt * mt, mt3 = mt2 * mt;
      const t3 = t * t * t;
      pts.push({
        x: mt3 * x0 + 3 * mt2 * t * cx1f + 3 * mt * t * t * cx2f + t3 * endX,
        y: mt3 * y0 + 3 * mt2 * t * cy1f + 3 * mt * t * t * cy2f + t3 * endY,
        w: lerp(w0, w1, t),
        t: t,
      });
    }

    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let tx, ty;
      if (i === 0) { tx = pts[1].x - p.x; ty = pts[1].y - p.y; }
      else if (i === pts.length - 1) { tx = p.x - pts[i - 1].x; ty = p.y - pts[i - 1].y; }
      else { tx = pts[i + 1].x - pts[i - 1].x; ty = pts[i + 1].y - pts[i - 1].y; }
      const len = Math.sqrt(tx * tx + ty * ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      const hw = p.w / 2;
      left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
      right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
    }

    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const tTx = last.x - prev.x, tTy = last.y - prev.y;
    const tLen = Math.sqrt(tTx * tTx + tTy * tTy) || 1;
    return {
      left, right,
      tipX: last.x, tipY: last.y,
      tipNormX: -tTy / tLen, tipNormY: tTx / tLen,
      tipTangentAngle: Math.atan2(tTx, -tTy),
      samples: pts,
    };
  }

  function samplePathAt(samples, t) {
    const idx = t * (samples.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const f = idx - i0;
    const p0 = samples[i0], p1 = samples[i1];
    const nx = lerp(p0.x, p1.x, f);
    const ny = lerp(p0.y, p1.y, f);
    const nw = lerp(p0.w, p1.w, f);

    let tx, ty;
    if (i0 === 0) { tx = samples[1].x - samples[0].x; ty = samples[1].y - samples[0].y; }
    else if (i1 === samples.length - 1) { tx = samples[i1].x - samples[i1 - 1].x; ty = samples[i1].y - samples[i1 - 1].y; }
    else { tx = samples[i1].x - samples[i0].x; ty = samples[i1].y - samples[i0].y; }
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    return { x: nx, y: ny, w: nw, angle: Math.atan2(tx, -ty), normX: -ty / len, normY: tx / len };
  }

  // ═══════════════════ DIVISION BUILDER ═══════════════════

  function buildBranchDivision(node, x0, y0, startAngle, width, depth, ranges) {
    const isLeaf = node.children.length === 0;
    let length, tipWidth;

    if (isLeaf) {
      length = rand(14, 24); tipWidth = 0.5;
    } else if (depth === 0) {
      length = ranges.trunkLen; tipWidth = width;
    } else {
      length = rand(ranges.lenMin, ranges.lenMax) * Math.max(0.4, 1 - depth * 0.1);
      tipWidth = width;
    }
    const baseWidth = isLeaf ? Math.min(width * 0.3, 4) : width;
    const avgWidth = (baseWidth + tipWidth) * 0.5;
    const targetEndAngle = node._targetAngle !== undefined ? node._targetAngle : startAngle;
    const solved = solveBranchPath({
      x0,
      y0,
      startAngle,
      endAngle: targetEndAngle,
      length,
      baseWidth,
      tipWidth,
      isLeaf,
      ranges,
      avgWidth,
      requireCollisionCheck: depth > 0
    });
    const path = solved.path;

    let leafData = null;
    if (isLeaf) {
      leafData = fitLeafRenderData(path, tipWidth, ranges, node.id);
      addPathToCollisionMap(path, avgWidth);
      addLeafBodyToCollisionMap(leafData);
    } else {
      addPathToCollisionMap(path, avgWidth);
    }

    if (!isLeaf) {
      const orderedChildren = getChildrenBySpace(node);
      const n = orderedChildren.length;
      const spread = deg2rad(rand(ranges.angleMin, ranges.angleMax));
      const childW = tipWidth / n;
      for (let i = 0; i < n; i++) {
        const child = orderedChildren[i];
        const offset = -tipWidth / 2 + i * childW + childW / 2;
        const cx = path.tipX + path.tipNormX * offset, cy = path.tipY + path.tipNormY * offset;
        const cAngle = n === 1 ? path.tipTangentAngle + rand(-spread * 0.15, spread * 0.15)
          : path.tipTangentAngle - spread / 2 + spread * (i / (n - 1));
        child._targetAngle = cAngle + rand(-0.04, 0.04);
        buildBranchDivision(child, cx, cy, path.tipTangentAngle, childW, depth + 1, ranges);
      }
    }

    const path2d = new Path2D();
    path2d.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i < path.left.length; i++) path2d.lineTo(path.left[i].x, path.left[i].y);
    const end = path.right.length - 1;
    for (let i = end; i >= 0; i--) path2d.lineTo(path.right[i].x, path.right[i].y);
    path2d.closePath();

    allBranches.push({
      path, path2d, depth, isLeaf, tipWidth, ranges,
      leafData,
      minT: null
    });
  }

  // ═══════════════════ LATERAL BUILDER ═══════════════════

  function buildBranchLateral(node, x0, y0, startAngle, width, depth, ranges, prePath = null) {
    const isNodeLeaf = node.children.length === 0;
    let path = prePath;
    let length, tipWidth, baseWidth;

    if (path) {
      baseWidth = path.samples[0].w;
      length = 0;
      const w = baseWidth;
      const tipChild = node.children.length > 0 && node.children.find(c => c.children.length > 0) || node.children[0];
      tipWidth = (tipChild && tipChild.children.length === 0) ? Math.min(w * 0.3, 3.5) : w * 0.8;
      tipWidth = path.samples[path.samples.length - 1].w;
    } else {
      baseWidth = width;
      if (isNodeLeaf) {
        length = rand(14, 24); tipWidth = 0.5; baseWidth = Math.min(width, 4);
      } else {
        length = depth === 0 ? ranges.trunkLen : rand(ranges.lenMin, ranges.lenMax) * Math.max(0.3, 1 - depth * 0.12);
        const tipChild = node.children.length > 0 && node.children.find(c => c.children.length > 0) || node.children[0];
        tipWidth = (tipChild && tipChild.children.length === 0) ? Math.min(width * 0.3, 3.5) : width * (depth === 0 ? 0.8 : 0.45);
      }

      const baseEndAngle = node._targetAngle !== undefined ? node._targetAngle : startAngle + rand(-0.08, 0.08);
      const solved = solveBranchPath({
        x0,
        y0,
        startAngle,
        endAngle: baseEndAngle,
        length,
        baseWidth,
        tipWidth,
        isLeaf: isNodeLeaf,
        ranges,
        avgWidth: (baseWidth + tipWidth) / 2,
        requireCollisionCheck: depth > 0
      });
      path = solved.path;
    }
    let leafData = null;
    if (isNodeLeaf) {
      leafData = fitLeafRenderData(path, tipWidth, ranges, node.id);
      addPathToCollisionMap(path, (baseWidth + tipWidth) / 2);
      addLeafBodyToCollisionMap(leafData);
    } else if (!prePath) {
      addPathToCollisionMap(path, (baseWidth + tipWidth) / 2);
    }

    const branches = node.children
      .filter(c => c.children.length > 0)
      .sort((a, b) => (b._spaceNeed || 0) - (a._spaceNeed || 0));
    const leaves = node.children
      .filter(c => c.children.length === 0)
      .sort((a, b) => (b._spaceNeed || 0) - (a._spaceNeed || 0));
    let tipChild, sideChildren;
    if (branches.length > 0) {
      tipChild = branches[0];
      sideChildren = [...branches.slice(1), ...leaves];
    } else {
      tipChild = leaves[0];
      sideChildren = leaves.slice(1);
    }
    sideChildren.sort((a, b) => (b._spaceNeed || 0) - (a._spaceNeed || 0));

    if (tipChild && !isNodeLeaf) {
      tipChild._targetAngle = path.tipTangentAngle + rand(-0.1, 0.1);
      buildBranchLateral(tipChild, path.tipX, path.tipY, path.tipTangentAngle, tipWidth, depth + 1, ranges);
    }

    let lateralMinT = ranges.latMinHeight, lateralMaxT = 0.92;
    const num = sideChildren.length;
    if (num > 0 && !isNodeLeaf) {
      const totalSpaceNeed = sideChildren.reduce((acc, c) => acc + Math.max(8, (c._spaceNeed || 20) * 0.28), 0);
      const needed = totalSpaceNeed * Math.max(0.55, ranges.latWidthRatio);
      const avail = length * (lateralMaxT - lateralMinT);
      if (needed > avail) lateralMinT = Math.max(0.15, lateralMaxT - needed / length);

      let plans = [];
      let lastSide = Math.random() < 0.5 ? 1 : -1;

      for (let i = 0; i < num; i++) {
        const t = num === 1 ? (lateralMinT + lateralMaxT) / 2 : lerp(lateralMinT, lateralMaxT, i / (num - 1));
        const s = samplePathAt(path.samples, t);
        let side = lastSide * -1; lastSide = side;
        const child = sideChildren[i];
        const isLeaf = child.children.length === 0;
        const spaceNeed = child._spaceNeed || (isLeaf ? 20 : 42);
        const bW = Math.min(s.w * ranges.latWidthRatio, isLeaf ? 5.0 : 999);
        const inset = isLeaf ? 0.95 : 0.15;
        const estLen = isLeaf
          ? Math.max(16, Math.min(30, spaceNeed * 0.45))
          : Math.max(length * 0.45, Math.min(length * 0.95, spaceNeed * 0.55));
        const angleD = rand(ranges.latAngleMin, ranges.latAngleMax);

        let bestAng = s.angle + side * deg2rad(angleD);
        const probes = [0, -20, 20];
        for (let off of probes) {
          const testAng = s.angle + side * deg2rad(angleD + off);
          const tx = s.x + Math.sin(testAng) * estLen;
          const ty = s.y - Math.cos(testAng) * estLen;
          const collides = checkCollision([{ x: s.x, y: s.y }, { x: tx, y: ty }], bW);
          if (!collides) { bestAng = testAng; break; }
        }

        const sx = s.x + s.normX * side * (s.w / 2) * inset;
        const sy = s.y + s.normY * side * (s.w / 2) * inset;
        plans.push({ child, isLeaf, sx, sy, baseAngle: s.angle, angle: bestAng, side, estLen, bW, t, spaceNeed, bend: 0 });
      }

      for (let iter = 0; iter < 6; iter++) {
        let changed = false;
        for (let i = 0; i < plans.length; i++) {
          for (let j = i + 1; j < plans.length; j++) {
            const p1 = plans[i], p2 = plans[j];
            const d1 = (p1.sx - p2.sx) ** 2 + (p1.sy - p2.sy) ** 2;
            if (d1 < 900) {
              const tx1 = p1.sx + Math.sin(p1.angle) * p1.estLen, ty1 = p1.sy - Math.cos(p1.angle) * p1.estLen;
              const tx2 = p2.sx + Math.sin(p2.angle) * p2.estLen, ty2 = p2.sy - Math.cos(p2.angle) * p2.estLen;
              if ((tx1 - tx2) ** 2 + (ty1 - ty2) ** 2 < 150) {
                const push = 0.08;
                if (p1.angle < p2.angle) { p1.angle -= push; p2.angle += push; }
                else { p1.angle += push; p2.angle -= push; }
                changed = true;
              }
            }
          }
        }
        if (!changed) break;
      }

      for (let p of plans) {
        const fullLen = p.isLeaf
          ? Math.max(rand(14, 24), p.spaceNeed * 0.35)
          : Math.max(
            rand(ranges.lenMin, ranges.lenMax) * Math.max(0.3, 1 - depth * 0.12),
            p.spaceNeed * 0.45
          );
        const tipW = p.isLeaf ? Math.max(0.5, p.bW * 0.35) : p.bW * 0.4;

        let solved = solveBranchPath({
          x0: p.sx,
          y0: p.sy,
          startAngle: p.baseAngle,
          endAngle: p.angle,
          length: fullLen,
          baseWidth: p.bW,
          tipWidth: tipW,
          isLeaf: p.isLeaf,
          ranges,
          avgWidth: p.bW,
          requireCollisionCheck: depth > 0
        });

        if (!solved.isCollisionFree) {
          const s = samplePathAt(path.samples, p.t);
          const nSide = p.side * -1;
          const nIn = p.isLeaf ? 0.95 : 0.15;
          const nsx = s.x + s.normX * nSide * (s.w / 2) * nIn;
          const nsy = s.y + s.normY * nSide * (s.w / 2) * nIn;
          const altAngle = s.angle + nSide * deg2rad(rand(ranges.latAngleMin, ranges.latAngleMax));
          const mirrorSolved = solveBranchPath({
            x0: nsx,
            y0: nsy,
            startAngle: s.angle,
            endAngle: altAngle,
            length: fullLen,
            baseWidth: p.bW,
            tipWidth: tipW,
            isLeaf: p.isLeaf,
            ranges,
            avgWidth: p.bW,
            requireCollisionCheck: true
          });
          if (mirrorSolved.isCollisionFree) solved = mirrorSolved;
        }

        p.child._targetAngle = solved.endAngle;
        addPathToCollisionMap(solved.path, p.bW);
        buildBranchLateral(p.child, 0, 0, 0, 0, depth + 1, ranges, solved.path);
      }
    }

    const path2d = new Path2D();
    path2d.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i < path.left.length; i++) path2d.lineTo(path.left[i].x, path.left[i].y);
    const end = path.right.length - 1;
    for (let i = end; i >= 0; i--) path2d.lineTo(path.right[i].x, path.right[i].y);
    path2d.closePath();

    allBranches.push({
      path, path2d, depth, isLeaf: isNodeLeaf, tipWidth, ranges,
      leafData,
      minT: lateralMinT, maxT: lateralMaxT
    });
  }

  function renderScene() {
    const W = canvas.width / dpr, H = canvas.height / dpr, groundY = H * 0.87;
    ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    drawSky(W, H, groundY);
    syncFadeSliderRangeToTreeDepth();
    const ordered = [...allBranches].sort((a, b) => a.depth - b.depth);
    for (const b of ordered) {
      if (!b.isLeaf) drawBranchFill(b.path, b.depth, getBranchOpacity(b.depth));
    }
    for (const b of ordered) {
      if (b.isLeaf) {
        const opacity = getBranchOpacity(b.depth);
        drawBranchFill(b.path, b.depth, opacity);
        drawLeafStemLine(b.path, b.tipWidth, opacity);
      }
    }
    for (const b of ordered) {
      if (b.isLeaf) drawLeafAtTip(b.path, b.tipWidth, b.ranges, b.leafData, getBranchOpacity(b.depth));
    }
    if (isDebug && hoveredBranch) renderDebugOverlay(hoveredBranch);
    ctx.restore();
  }

  function getBranchOpacity(depth) {
    if (!isSubBranchFade) return 1;
    return depth >= fadeFromLevel ? 0.18 : 1;
  }

  function syncFadeSliderRangeToTreeDepth() {
    if (!rFadeLevel || !rvFadeLevel) return;
    let maxDepth = 1;
    for (const b of allBranches) maxDepth = Math.max(maxDepth, b.depth || 0);
    const safeMax = Math.max(1, maxDepth);
    if (+rFadeLevel.max !== safeMax) rFadeLevel.max = String(safeMax);
    if (fadeFromLevel > safeMax) {
      fadeFromLevel = safeMax;
      rFadeLevel.value = String(safeMax);
    }
    rvFadeLevel.textContent = String(fadeFromLevel);
  }

  function renderDebugOverlay(branch) {
    ctx.save();
    ctx.lineWidth = 1; ctx.strokeStyle = "#FFFF00"; ctx.filter = "drop-shadow(0 0 2px black)";
    ctx.beginPath();
    ctx.moveTo(branch.path.left[0].x, branch.path.left[0].y);
    for (let p of branch.path.left) ctx.lineTo(p.x, p.y);
    for (let i = branch.path.right.length - 1; i >= 0; i--) ctx.lineTo(branch.path.right[i].x, branch.path.right[i].y);
    ctx.closePath(); ctx.stroke(); ctx.filter = "none";
    if (branch.minT != null) {
      const minIdx = Math.floor(branch.minT * (branch.path.samples.length - 1));
      const maxIdx = Math.floor(branch.maxT * (branch.path.samples.length - 1));
      ctx.beginPath();
      const startL = Math.max(0, minIdx), endL = Math.min(branch.path.left.length - 1, maxIdx);
      for (let i = startL; i <= endL; i++) {
        const pt = branch.path.left[i]; if (i === startL) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      }
      for (let i = endL; i >= startL; i--) {
        const pt = branch.path.right[i]; ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath(); ctx.fillStyle = "rgba(255, 0, 0, 0.35)"; ctx.fill();
    }
    ctx.restore();
  }

  canvas.addEventListener("mousemove", e => {
    if (!isDebug) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const rx = x / dpr, ry = y / dpr;
    let found = null;
    for (let i = allBranches.length - 1; i >= 0; i--) {
      const b = allBranches[i];
      if (ctx.isPointInPath(b.path2d, rx, ry)) { found = b; break; }
    }
    if (found !== hoveredBranch) { hoveredBranch = found; renderScene(); }
  });

  function drawBranchFill(path, depth, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i < path.left.length; i++) ctx.lineTo(path.left[i].x, path.left[i].y);
    const end = path.right.length - 1;
    for (let i = end; i >= 0; i--) ctx.lineTo(path.right[i].x, path.right[i].y);
    ctx.closePath();
    ctx.fillStyle = "#5d4037"; ctx.fill();
    ctx.strokeStyle = `rgba(30,20,10,${Math.max(0.05, 0.25 - depth * 0.04)})`;
    ctx.lineWidth = 0.5; ctx.stroke();
    ctx.restore();
  }
  function drawLeafStemLine(path, tipW, opacity = 1) {
    if (!path || !path.samples || path.samples.length < 2) return;
    let maxW = tipW || 0;
    for (const s of path.samples) maxW = Math.max(maxW, s.w || 0);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.moveTo(path.samples[0].x, path.samples[0].y);
    for (let i = 1; i < path.samples.length; i++) ctx.lineTo(path.samples[i].x, path.samples[i].y);
    ctx.strokeStyle = "#5d4037";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2.0, maxW * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(path.samples[0].x, path.samples[0].y);
    for (let i = 1; i < path.samples.length; i++) ctx.lineTo(path.samples[i].x, path.samples[i].y);
    ctx.strokeStyle = "#4e342e";
    ctx.lineWidth = Math.max(1.5, maxW * 0.4);
    ctx.stroke();
    ctx.restore();
  }
  function drawLeafAtTip(path, tipW, ranges, leafData, opacity = 1) {
    ctx.save();
    ctx.globalAlpha = opacity;
    const leaf = leafData || createLeafRenderData(path, tipW, ranges, "fallback");
    const px = leaf.x, py = leaf.y, ang = leaf.angle;
    const base = path.samples[0];
    ctx.beginPath();
    const hw = Math.max(0.7, leaf.stemHalfWidth || tipW * 0.55);
    ctx.moveTo(path.tipX + path.tipNormX * hw, path.tipY + path.tipNormY * hw);
    ctx.lineTo(path.tipX - path.tipNormX * hw, path.tipY - path.tipNormY * hw);
    ctx.lineTo(px, py);
    ctx.closePath(); ctx.fillStyle = "#4e342e"; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(path.tipX, path.tipY);
    ctx.lineTo(px, py);
    ctx.strokeStyle = "rgba(44, 27, 20, 0.95)";
    ctx.lineWidth = Math.max(1.0, hw * 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(px, py);
    ctx.strokeStyle = "#4e342e";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2.0, base.w * 0.75);
    ctx.stroke();
    drawLeaf(px, py, ang, leaf.size, leaf.hue, opacity);
    ctx.restore();
  }
  function drawLeaf(x, y, angle, size, hue, opacity = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    const s = size / 18; ctx.scale(s, s); ctx.translate(0, 9);
    ctx.beginPath(); ctx.moveTo(0, -18);
    ctx.bezierCurveTo(3.25, -11.7, 4.55, -7.2, 3.9, -5.4);
    ctx.bezierCurveTo(3.25, -3.15, 1.3, -1.35, 0, 0);
    ctx.bezierCurveTo(-1.3, -1.35, -3.25, -3.15, -3.9, -5.4);
    ctx.bezierCurveTo(-4.55, -7.2, -3.25, -11.7, 0, -18);
    ctx.closePath(); ctx.fillStyle = "#7cc37d"; ctx.globalAlpha = 0.9 * opacity; ctx.fill();
    ctx.globalAlpha = 1.0 * opacity; ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(0, 0);
    ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 0.4; ctx.stroke();
    ctx.restore();
  }
  function drawSky(W, H, groundY) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0d1b2a"); grad.addColorStop(0.35, "#1b2838");
    grad.addColorStop(0.65, "#2a4a5e"); grad.addColorStop(0.85, "#3e6b7a"); grad.addColorStop(1, "#4a8070");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    let s = 42; const sr = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 80; i++) {
      ctx.beginPath(); ctx.arc(sr() * W, sr() * groundY * 0.6, 0.4 + sr() * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.15 + sr() * 0.5})`; ctx.fill();
    }
    const gg = ctx.createLinearGradient(0, groundY - 10, 0, H);
    gg.addColorStop(0, "#2d4a2e"); gg.addColorStop(1, "#0f1f10");
    ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(0, groundY);
    ctx.quadraticCurveTo(W * 0.25, groundY - 10, W * 0.5, groundY - 3);
    ctx.quadraticCurveTo(W * 0.75, groundY + 5, W, groundY);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    let gs = 111; const gr = () => { gs = (gs * 16807) % 2147483647; return gs / 2147483647; };
    for (let i = 0; i < 150; i++) {
      const gx = gr() * W, gy = groundY + gr() * 8 - 4, gh = 4 + gr() * 10;
      ctx.beginPath(); ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + (gr() - 0.5) * 6, gy - gh * 0.6, gx + (gr() - 0.5) * 3, gy - gh);
      ctx.strokeStyle = `hsla(${95 + gr() * 40},45%,${22 + gr() * 18}%,${0.3 + gr() * 0.4})`;
      ctx.lineWidth = 0.5 + gr(); ctx.stroke();
    }
  }

  function generateTree() {
    dpr = window.devicePixelRatio || 1;
    drawnSegments = []; drawnLeafBodies = []; allBranches = []; hoveredBranch = null;
    tree._targetAngle = rand(-0.03, 0.03);
    const W = canvas.width / dpr, H = canvas.height / dpr, groundY = H * 0.87;
    if (currentMode === "division") {
      const ranges = getRanges();
      prepareSubtreeSpace(tree, ranges, "division");
      buildBranchDivision(tree, W / 2, groundY, tree._targetAngle, ranges.trunkWid, 0, ranges);
    } else {
      const ranges = getLateralRanges();
      prepareSubtreeSpace(tree, ranges, "lateral");
      buildBranchLateral(tree, W / 2, groundY, tree._targetAngle, ranges.trunkWid, 0, ranges);
    }
    renderScene();
  }

  function resizeCanvas() {
    const area = document.getElementById("canvas-area");
    const rect = area.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px"; canvas.style.height = rect.height + "px";
    generateTree();
  }

  window.addEventListener("resize", resizeCanvas);
  btnGenerate.addEventListener("click", generateTree);
  btnDownload.addEventListener("click", () => {
    const link = document.createElement("a"); link.download = "tree.png";
    link.href = canvas.toDataURL("image/png"); link.click();
  });
  syncUI(); resizeCanvas();
})();

