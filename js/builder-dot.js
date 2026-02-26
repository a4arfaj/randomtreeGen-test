/**
 * DOT BUILDER
 *
 * Dot mode rules:
 * - Tree grows on a configurable point cloud.
 * - One element per dot (branch segment or leaf).
 * - We tune chain lengths from tree complexity to avoid starving later branches.
 */

import { ctx } from "./ui-inputs.js";
import { deg2rad, lerp, rand, seededRandom } from "./utils.js";

const DIR8 = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
];

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function subtreeStats(node) {
    if (!node) return { leaves: 0, branchNodes: 0, total: 0, maxDepth: 0 };
    if (!node.children || node.children.length === 0) {
        return { leaves: 1, branchNodes: 0, total: 1, maxDepth: 1 };
    }

    let leaves = 0;
    let branchNodes = 1;
    let total = 1;
    let maxDepth = 1;
    for (const c of node.children) {
        const s = subtreeStats(c);
        leaves += s.leaves;
        branchNodes += s.branchNodes;
        total += s.total;
        maxDepth = Math.max(maxDepth, s.maxDepth + 1);
    }
    return { leaves, branchNodes, total, maxDepth };
}

/**
 * Pre-calculate safe dot chain ranges from total branches/leaves and available dots.
 */
export function tuneDotRangesForTree(root, ranges, totalDots) {
    const stats = subtreeStats(root);

    const minIn = Math.max(2, ranges.dotMinLen || 2);
    const maxIn = Math.max(minIn, ranges.dotMaxLen || 6);

    return {
        ...ranges,
        dotMinLen: minIn,
        dotMaxLen: maxIn,
        _stats: stats,
    };
}

/**
 * Generate all dot positions for the given shape.
 * Returns an array of { col, row, x, y, occupied }.
 */
export function generateDotGrid(cx, cy, dotSpacing, cols, rows, shape) {
    const dots = [];
    const halfCols = Math.floor(cols / 2);
    const halfRows = Math.floor(rows / 2);

    for (let row = -halfRows; row <= halfRows; row++) {
        for (let col = -halfCols; col <= halfCols; col++) {
            const x = cx + col * dotSpacing;
            const y = cy + row * dotSpacing;
            let inside = false;

            switch (shape) {
                case "circle": {
                    const nx = col / halfCols;
                    const ny = row / halfRows;
                    inside = nx * nx + ny * ny <= 1.0;
                    break;
                }
                case "ellipse": {
                    const nx = col / halfCols;
                    const ny = row / (halfRows * 0.6);
                    inside = nx * nx + ny * ny <= 1.0;
                    break;
                }
                case "rectangle":
                    inside = true;
                    break;
                case "diamond": {
                    const nx = Math.abs(col) / halfCols;
                    const ny = Math.abs(row) / halfRows;
                    inside = nx + ny <= 1.0;
                    break;
                }
                case "triangle": {
                    const progress = (row + halfRows) / (2 * halfRows);
                    const allowedHalf = halfCols * progress;
                    inside = Math.abs(col) <= allowedHalf;
                    break;
                }
                default:
                    inside = true;
            }

            if (inside) dots.push({ col, row, x, y, occupied: false });
        }
    }
    return dots;
}

function shufflePreferred(pdx, pdy, isTip = false, progress = 1.0, origDx = 0, origDy = -1) {
    const scored = DIR8.map((d) => {
        // Base: prefer current direction
        let score = -(d.dx * pdx + d.dy * pdy);

        if (isTip) {
            if (progress < 0.5) {
                // Tip branches forced to go straight in their initial direction for the first half
                if (d.dx === origDx && d.dy === origDy) score -= 20.0;
                else {
                    score += 5.0; // penalty for deviation
                    if (d.dy > 0) score += 20.0; // strict no downward
                }
            } else {
                // Later half: can gently bend but mostly up
                if (d.dy === -1) score -= 1.5;    // Strong upward bonus
                if (d.dy === 0) score += 0.8;     // Mild penalty for going sideways
                if (d.dy === 1) score += 6.0;     // Huge penalty for going downward

                // Penalize sharp turns (where alignment is 0 or negative)
                const alignment = d.dx * pdx + d.dy * pdy;
                if (alignment <= 0) score += 5.0; // Avoid sharp 90-degree or 180-degree turns

                score += rand(-0.08, 0.08); // Very small variety
            }
        } else {
            // Heavily penalise going backward / downward (dy>0 is down on screen)
            if (d.dy > 0) score += 2.5;          // strong downward penalty
            if (d.dy < 0) score -= 0.4;          // slight upward bonus
            // Small noise for variety
            score += rand(-0.25, 0.25);
        }
        return { d, score };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.d);
}

function walkChain(dots, dotMap, startIdx, preferredDx, preferredDy, length, isTrunk = false, isTip = false) {
    const chain = [startIdx];
    let curIdx = startIdx;
    let dx = preferredDx;
    let dy = preferredDy;

    for (let step = 1; step < length; step++) {
        const cur = dots[curIdx];
        const progress = step / length;

        // If trunk, strictly force it to go straight up (dx=0, dy=-1)
        const dirs = isTrunk ? [{ dx: 0, dy: -1 }] : shufflePreferred(dx, dy, isTip, progress, preferredDx, preferredDy);

        let found = false;
        for (const d of dirs) {
            const key = `${cur.col + d.dx},${cur.row + d.dy}`;
            const nIdx = dotMap.get(key);

            if (nIdx !== undefined && !dots[nIdx].occupied) {
                // Prevent cross-diagonals: if moving diagonally, check common adjacent orthogonals
                if (Math.abs(d.dx) === 1 && Math.abs(d.dy) === 1) {
                    const o1Idx = dotMap.get(`${cur.col + d.dx},${cur.row}`);
                    const o2Idx = dotMap.get(`${cur.col},${cur.row + d.dy}`);
                    const o1Occ = o1Idx !== undefined ? dots[o1Idx].occupied : false;
                    const o2Occ = o2Idx !== undefined ? dots[o2Idx].occupied : false;
                    if (o1Occ && o2Occ) continue; // Forbid diagonal cross!
                }

                chain.push(nIdx);
                dx = d.dx;
                dy = d.dy;
                curIdx = nIdx;
                found = true;
                break;
            }
        }
        if (!found) break;
    }
    return chain;
}

function catmullRomOnDots(dots, t) {
    const n = dots.length;
    if (n === 1) return { x: dots[0].x, y: dots[0].y };
    const seg = t * (n - 1);
    const i = Math.min(Math.floor(seg), n - 2);
    const f = seg - i;
    const p0 = dots[Math.max(0, i - 1)];
    const p1 = dots[i];
    const p2 = dots[i + 1];
    const p3 = dots[Math.min(n - 1, i + 2)];

    const x =
        0.5 *
        ((-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f * f * f +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f * f +
            (-p0.x + p2.x) * f +
            2 * p1.x);
    const y =
        0.5 *
        ((-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f * f * f +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f * f +
            (-p0.y + p2.y) * f +
            2 * p1.y);
    return { x, y };
}

function buildPathFromPts(pts) {
    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let tx;
        let ty;
        if (i === 0) {
            tx = pts[1].x - p.x;
            ty = pts[1].y - p.y;
        } else if (i === pts.length - 1) {
            tx = p.x - pts[i - 1].x;
            ty = p.y - pts[i - 1].y;
        } else {
            tx = pts[i + 1].x - pts[i - 1].x;
            ty = pts[i + 1].y - pts[i - 1].y;
        }
        const len = Math.sqrt(tx * tx + ty * ty) || 1;
        const nx = -ty / len;
        const ny = tx / len;
        const hw = (p.w || 1) / 2;
        left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
        right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2] || pts[0];
    const tTx = last.x - prev.x;
    const tTy = last.y - prev.y;
    const tLen = Math.sqrt(tTx * tTx + tTy * tTy) || 1;
    return {
        left,
        right,
        tipX: last.x,
        tipY: last.y,
        tipNormX: -tTy / tLen,
        tipNormY: tTx / tLen,
        tipTangentAngle: Math.atan2(tTx, -tTy),
        samples: pts,
    };
}

function chainToPath(chain, dots, dotSpacing, w0, w1, curviness, curveDir) {
    if (chain.length < 2) {
        const d = dots[chain[0]];
        const pts = [
            { x: d.x, y: d.y + dotSpacing * 0.3, w: w0 },
            { x: d.x, y: d.y - dotSpacing * 0.3, w: w1 },
        ];
        return buildPathFromPts(pts);
    }

    const raw = chain.map((idx) => dots[idx]);
    const pts = [];
    const NUM = Math.max(3, chain.length * 4);
    const perpX = raw.length > 1 ? -(raw[raw.length - 1].y - raw[0].y) : 0;
    const perpY = raw.length > 1 ? raw[raw.length - 1].x - raw[0].x : 1;
    const pLen = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
    const maxOffset = curviness * dotSpacing * chain.length * 0.3 * curveDir;

    for (let i = 0; i <= NUM; i++) {
        const t = i / NUM;
        const { x, y } = catmullRomOnDots(raw, t);
        const bulge = Math.sin(t * Math.PI) * maxOffset;
        pts.push({
            x: x + (perpX / pLen) * bulge,
            y: y + (perpY / pLen) * bulge,
            w: lerp(w0, w1, t),
            t,
        });
    }

    return buildPathFromPts(pts);
}

function makePath2D(path) {
    const p2d = new Path2D();
    p2d.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i < path.left.length; i++) p2d.lineTo(path.left[i].x, path.left[i].y);
    for (let i = path.right.length - 1; i >= 0; i--) p2d.lineTo(path.right[i].x, path.right[i].y);
    p2d.closePath();
    return p2d;
}

function countFreeNeighbours(dots, dotMap, idx) {
    const d0 = dots[idx];
    if (!d0) return 0;
    let n = 0;
    for (const d of DIR8) {
        const key = `${d0.col + d.dx},${d0.row + d.dy}`;
        const i = dotMap.get(key);
        if (i !== undefined && !dots[i].occupied) n++;
    }
    return n;
}

function findChainAdjacentFreeDot(dots, dotMap, chain, usedSpawn, mainDx, mainDy) {
    const scored = [];
    for (const cIdx of chain) {
        const c = dots[cIdx];
        for (const d of DIR8) {
            const key = `${c.col + d.dx},${c.row + d.dy}`;
            const nIdx = dotMap.get(key);
            if (nIdx === undefined) continue;
            if (dots[nIdx].occupied || usedSpawn.has(nIdx)) continue;
            const align = d.dx * mainDx + d.dy * mainDy;
            const free = countFreeNeighbours(dots, dotMap, nIdx);
            scored.push({ idx: nIdx, d, score: free * 2 + align });
        }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
}

function buildLeafAtDot(dot, leafHue, dotSpacing, depth = 0, prefDir = { dx: 0, dy: -1 }, isTip = true, parentW = 0) {
    let baseAngle = Math.atan2(prefDir.dx, -prefDir.dy);
    if (!isTip) {
        const side = seededRandom() < 0.5 ? 1 : -1;
        baseAngle += side * rand(Math.PI / 2 - 0.5, Math.PI / 2 + 0.5);
    } else {
        baseAngle += rand(-0.2, 0.2);
    }
    const angle = baseAngle;
    const r = Math.max(8, dotSpacing * 0.34) * clamp(1 - depth * 0.02, 0.75, 1);

    // Offset the stem start to clear the thick parent body
    const offset = Math.max(0, parentW / 2 - 1);
    const start = {
        x: dot.x + Math.sin(angle) * offset,
        y: dot.y - Math.cos(angle) * offset
    };
    const tip = {
        x: start.x + Math.sin(angle) * r,
        y: start.y - Math.cos(angle) * r,
    };
    const pts = [
        { x: start.x, y: start.y, w: Math.max(1.2, dotSpacing * 0.07), t: 0 },
        { x: tip.x, y: tip.y, w: Math.max(0.7, dotSpacing * 0.04), t: 1 },
    ];
    const path = buildPathFromPts(pts);
    return {
        path,
        path2d: makePath2D(path),
        depth: 99,
        isLeaf: true,
        tipWidth: 0.8,
        ranges: { leafHue, curveMin: 0, curveMax: 0 },
        leafData: {
            x: tip.x,
            y: tip.y,
            angle,
            size: r * 3.0,
            hue: leafHue,
            stemHalfWidth: Math.max(0.8, dotSpacing * 0.05),
        },
        minT: null,
        maxT: null,
    };
}


/**
 * Main entry: build the dot-grid tree recursively.
 */
export function buildBranchDot(
    node,
    startDotIdx,
    dots,
    dotMap,
    depth,
    ranges,
    allBranches,
    dotSpacing,
    prefDir,
    allowOccupiedStart = false,
    isTip = true,
    parentW = 0
) {
    const isLeaf = node.children.length === 0;
    const startDot = dots[startDotIdx];
    if (!startDot || (startDot.occupied && !allowOccupiedStart)) return;

    if (isLeaf) {
        startDot.occupied = true;
        const leafBranch = buildLeafAtDot(startDot, ranges.leafHue, dotSpacing, depth, prefDir, isTip, parentW);
        leafBranch.depth = depth;
        leafBranch.nodeId = node.id;
        allBranches.push(leafBranch);
        return;
    }

    const selfStats = subtreeStats(node);
    const minLen = Math.max(2, ranges.dotMinLen || 2);
    const maxLen = Math.max(minLen + 1, ranges.dotMaxLen || 6);

    const baseTarget = Math.round(rand(minLen, maxLen));
    const chainLen =
        depth === 0
            ? Math.max(2, Math.round((ranges.trunkLen || 100) / dotSpacing))
            : baseTarget;

    const chain = walkChain(dots, dotMap, startDotIdx, prefDir.dx, prefDir.dy, chainLen, depth === 0, isTip);
    for (const idx of chain) dots[idx].occupied = true;

    const baseW =
        depth === 0
            ? ranges.trunkWid
            : Math.max(2.2, ranges.trunkWid * Math.pow(ranges.widthRatio || 0.74, depth));
    const tipW = Math.max(0.9, baseW * (ranges.widthRatio || 0.52));
    const curviness = 0;
    const curveDir = seededRandom() < 0.5 ? 1 : -1;
    const path = chainToPath(chain, dots, dotSpacing, baseW, tipW, curviness, curveDir);

    allBranches.push({
        path,
        path2d: makePath2D(path),
        nodeId: node.id,
        depth,
        isLeaf: false,
        tipWidth: tipW,
        ranges,
        leafData: null,
        minT: null,
        maxT: null,
    });

    const tipDotIdx = chain[chain.length - 1];
    const tipDot = dots[tipDotIdx];
    const firstDot = dots[chain[0]];
    let mainDx = tipDot.col - firstDot.col;
    let mainDy = tipDot.row - firstDot.row;
    const mLen = Math.sqrt(mainDx * mainDx + mainDy * mainDy) || 1;
    mainDx = Math.round(mainDx / mLen);
    mainDy = Math.round(mainDy / mLen);
    if (mainDx === 0 && mainDy === 0) mainDy = -1;

    const children = [...node.children].sort(
        (a, b) => subtreeStats(b).total - subtreeStats(a).total
    );

    const usedSpawns = new Set();

    // Prevent any child from spawning on the exact dot this branch started from (its connection to the grandparent).
    if (depth > 0 && chain.length > 1) {
        usedSpawns.add(chain[0]);
    }

    for (let i = 0; i < children.length; i++) {
        const child = children[i];

        let spawnIdx = null; // Must find a unique dot from the parent's chain
        let spawnDir = { dx: mainDx, dy: mainDy };

        const tipIdx = chain[chain.length - 1];

        // First (largest) child always tries to extend from the tip
        if (i === 0 && !usedSpawns.has(tipIdx)) {
            spawnIdx = tipIdx;
        } else {
            // Further children/leaves find remaining unused dots on the parent chain
            for (let j = chain.length - 1; j >= 0; j--) {
                if (!usedSpawns.has(chain[j])) {
                    spawnIdx = chain[j];
                    break;
                }
            }
        }

        // If no unique dots are left on the parent chain, skip this child!
        // This perfectly guarantees no multiple leaves overlap on a single dot.
        if (spawnIdx === null) continue;

        usedSpawns.add(spawnIdx);

        if (i > 0) {
            let bestD = DIR8[0];
            let bestScore = -Infinity;
            for (const d of DIR8) {
                const key = `${dots[spawnIdx].col + d.dx},${dots[spawnIdx].row + d.dy}`;
                const nIdx = dotMap.get(key);
                if (nIdx !== undefined && !dots[nIdx].occupied) {
                    const align = d.dx * mainDx + d.dy * mainDy;
                    // encourage going UP, penalize going down heavily
                    const score = align + rand(0, 1) - (d.dy > 0 ? 3 : 0);
                    if (score > bestScore) {
                        bestScore = score;
                        bestD = d;
                    }
                }
            }
            if (bestScore > -Infinity) spawnDir = bestD;
        }

        const childParentW = (i === 0) ? tipW : (baseW * 0.8);

        buildBranchDot(
            child, spawnIdx, dots, dotMap, depth + 1,
            ranges, allBranches, dotSpacing, spawnDir, true, i === 0, childParentW
        );
    }
}

/**
 * Find the closest free dot to a position.
 */
export function findClosestFreeDot(dots, x, y) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < dots.length; i++) {
        if (dots[i].occupied) continue;
        const dx = dots[i].x - x;
        const dy = dots[i].y - y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

/**
 * Draw dot grid overlay.
 */
export function drawDotGrid(dots, dotSpacing) {
    const r = Math.max(3, dotSpacing * 0.18);
    ctx.save();
    ctx.globalAlpha = 1;
    for (const d of dots) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
        ctx.fillStyle = d.occupied ? "#ff9944" : "#55aaff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(d.x, d.y, r + 1, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    ctx.restore();
}
