/**
 * PLANNED BUILDER
 *
 * Deterministic lateral-like growth that allocates space by subtree need.
 * No retry/attempt loops, no random search, no collision solving over paths.
 * Collision policy in this mode: base-point collisions only.
 */

import { deg2rad, hash01 } from "./utils.js";
import { samplePathAt, computeBranchPath } from "./path.js";
import { createLeafRenderData } from "./leaf.js";

const plannedBaseColliders = []; // { x, y, r }

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function annotatePlan(node) {
    if (!node) return { leaves: 0, branches: 0, maxDepth: 0, need: 0 };
    if (node.children.length === 0) {
        node._planNeed = 28;
        node._planDepth = 1;
        node._planLeaves = 1;
        node._planBranches = 0;
        return { leaves: 1, branches: 0, maxDepth: 1, need: node._planNeed };
    }

    let leaves = 0;
    let branches = 1;
    let maxDepth = 1;
    const childNeeds = [];

    for (const ch of node.children) {
        const s = annotatePlan(ch);
        leaves += s.leaves;
        branches += s.branches;
        maxDepth = Math.max(maxDepth, s.maxDepth + 1);
        childNeeds.push(s.need);
    }

    const total = childNeeds.reduce((a, b) => a + b, 0);
    const maxChild = childNeeds.length ? Math.max(...childNeeds) : 0;
    const own = Math.max(22, 12 + Math.sqrt(Math.max(1, total)) * 1.35);
    const need = own + total * 0.56 + maxChild * 0.34;

    node._planNeed = need;
    node._planDepth = maxDepth;
    node._planLeaves = leaves;
    node._planBranches = branches - 1;

    return { leaves, branches, maxDepth, need };
}

function makePath2D(path) {
    const p2d = new Path2D();
    p2d.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i < path.left.length; i++) p2d.lineTo(path.left[i].x, path.left[i].y);
    for (let i = path.right.length - 1; i >= 0; i--) p2d.lineTo(path.right[i].x, path.right[i].y);
    p2d.closePath();
    return p2d;
}

function chooseTipChild(children) {
    const branches = children
        .filter((c) => c.children.length > 0)
        .sort((a, b) => (b._planNeed || 0) - (a._planNeed || 0));
    if (branches.length > 0) return branches[0];
    if (children.length > 0) return children[0];
    return null;
}

function hasBaseCollision(x, y, r) {
    for (const c of plannedBaseColliders) {
        const dx = x - c.x;
        const dy = y - c.y;
        const rr = r + c.r;
        if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
}

function registerBase(x, y, r) {
    plannedBaseColliders.push({ x, y, r });
}

export function resetPlannedBaseMap() {
    plannedBaseColliders.length = 0;
}

function pathLength(samples) {
    if (!samples || samples.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < samples.length; i++) {
        const dx = samples[i].x - samples[i - 1].x;
        const dy = samples[i].y - samples[i - 1].y;
        len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
}

function footprintPx(node) {
    const need = node._planNeed || 30;
    const d = node._planDepth || 1;
    if (node.children.length === 0) {
        return clamp(34 + Math.sqrt(need) * 2.0, 34, 72);
    }
    return clamp(30 + Math.sqrt(need) * 3.0 + d * 4.2, 34, 120);
}

function coneWeight(node) {
    const need = node?._planNeed || 20;
    const d = node?._planDepth || 1;
    const leaves = node?._planLeaves || (node?.children?.length === 0 ? 1 : 0);
    return Math.max(1, Math.sqrt(need) * 0.9 + d * 0.7 + Math.sqrt(leaves) * 0.7);
}

function requiredLengthForNode(node, profile, depth = 0) {
    if (!node || node.children.length === 0) return 0;
    const ordered = [...node.children].sort(
        (a, b) => (b._planNeed || 0) - (a._planNeed || 0)
    );
    const tipChild = chooseTipChild(ordered);
    const sideChildren = ordered.filter((c) => c !== tipChild);
    if (sideChildren.length === 0) return 0;
    const gapPx = 20;
    const totalFoot = sideChildren.reduce((acc, c) => acc + footprintPx(c), 0);
    const totalGap = Math.max(0, sideChildren.length - 1) * gapPx;
    const requiredUsable = (totalFoot + totalGap) * 1.06;
    const raw = requiredUsable / Math.max(0.22, 1 - profile.latMinHeight);
    const levelUnit = profile.levelUnit || 70;
    const maxByDepth = depth === 0 ? levelUnit * 1.55 : levelUnit * 1.25;
    return clamp(raw, 0, maxByDepth);
}

function pathStartAngle(path) {
    const s0 = path.samples[0];
    const s1 = path.samples[1] || s0;
    return Math.atan2(s1.x - s0.x, -(s1.y - s0.y));
}

/**
 * Build deterministic profile/ranges for planned mode.
 */
export function preparePlannedTree(root, sceneHeight, groundY) {
    const stats = annotatePlan(root);
    const available = Math.max(200, groundY - 40);
    const crownHeight = clamp(
        available * 0.52 + Math.sqrt(stats.leaves) * 7,
        170,
        available * 0.74
    );
    const levelUnit = crownHeight / Math.max(2, stats.maxDepth);

    const trunkLen = clamp(
        levelUnit * 0.9,
        70,
        available * 0.22
    );
    const trunkWid = clamp(16 + Math.sqrt(stats.leaves) * 3.3, 18, 54);

    return {
        curveMin: 0.12,
        curveMax: 0.12,
        leafHue: 115,
        latMinHeight: 0.12,
        trunkLen,
        trunkWid,
        levelUnit,
        crownHeight,
        _stats: stats,
        _sceneHeight: sceneHeight,
    };
}

/**
 * Deterministic, planned growth builder.
 */
export function buildBranchPlanned(
    node,
    x0,
    y0,
    startAngle,
    width,
    depth,
    profile,
    allBranches,
    prePath = null,
    collisionAtBase = false
) {
    const isLeaf = node.children.length === 0;
    let path = prePath;
    let baseWidth;
    let tipWidth;
    let lateralMinT = null;
    let lateralMaxT = null;

    if (path) {
        baseWidth = path.samples[0].w;
        tipWidth = path.samples[path.samples.length - 1].w;

        // Critical fix: branches received via prePath still need deterministic
        // re-sizing for THEIR OWN side-child footprint budget.
        if (!isLeaf) {
            const reqLen = requiredLengthForNode(node, profile, depth);
            const curLen = pathLength(path.samples);
            if (reqLen > curLen + 1) {
                const s0 = path.samples[0];
                const startAng = pathStartAngle(path);
                const endAng =
                    node._targetAngle !== undefined
                        ? node._targetAngle
                        : path.tipTangentAngle;
                const curveDir = Math.sign(path.tipX - s0.x) || 1;
                path = computeBranchPath(
                    s0.x,
                    s0.y,
                    startAng,
                    endAng,
                    reqLen,
                    baseWidth,
                    tipWidth,
                    profile.curveMin,
                    curveDir
                );
            }
        }
    } else {
        baseWidth = isLeaf ? Math.min(width, 4.4) : width;
        let length;

        if (isLeaf) {
            const need = node._planNeed || 26;
            length = clamp(14 + need * 0.22, 14, 34);
            tipWidth = 0.5;
        } else if (depth === 0) {
            length = profile.trunkLen * 0.88;
            tipWidth = width * 0.88;
        } else {
            const need = node._planNeed || 46;
            const d = node._planDepth || 1;
            const levelUnit = profile.levelUnit || 70;
            const depthMul = clamp(1 - depth * 0.09, 0.55, 1);
            const remMul = clamp(0.78 + d * 0.09, 0.82, 1.18);
            const needMul = clamp(0.9 + Math.sqrt(need) * 0.012, 0.9, 1.12);
            const maxLen = levelUnit * 1.25;
            length = clamp(levelUnit * depthMul * remMul * needMul, 22, maxLen);

            // Deterministic "paper area" reservation.
            length = Math.max(length, requiredLengthForNode(node, profile, depth));

            tipWidth = Math.max(1.1, width * 0.56);
        }

        const endAngle =
            node._targetAngle !== undefined ? node._targetAngle : startAngle;
        path = computeBranchPath(
            x0,
            y0,
            startAngle,
            endAngle,
            length,
            baseWidth,
            tipWidth,
            profile.curveMin,
            1
        );
    }

    let leafData = null;
    if (isLeaf) {
        // Deterministic leaf placement with no fitting attempts.
        leafData = createLeafRenderData(path, tipWidth, profile, node.id, 0, 1);
    }

    if (!isLeaf && node.children.length > 0) {
        const ordered = [...node.children].sort(
            (a, b) => (b._planNeed || 0) - (a._planNeed || 0)
        );
        const tipChild = chooseTipChild(ordered);
        const sideChildren = ordered.filter((c) => c !== tipChild);

        if (tipChild) {
            // Larger deterministic wobble to avoid a vertical, symmetric spear.
            const wobble = (hash01(tipChild.id + ":planTip") - 0.5) * 0.26;
            tipChild._targetAngle = path.tipTangentAngle + wobble;
            buildBranchPlanned(
                tipChild,
                path.tipX,
                path.tipY,
                path.tipTangentAngle,
                tipWidth,
                depth + 1,
                profile,
                allBranches
            );
        }

        lateralMinT = profile.latMinHeight;
        lateralMaxT = 1.0;

        if (sideChildren.length > 0) {
            const parentLen = Math.max(1, pathLength(path.samples));
            const usableLen = Math.max(20, parentLen * (lateralMaxT - lateralMinT));
            const gapPx = 18;

            const left = [];
            const right = [];
            let leftNeed = 0;
            let rightNeed = 0;
            const bias = (hash01(node.id + ":sideBias") - 0.5) * 0.28;

            for (const child of sideChildren) {
                const fp = footprintPx(child);
                const leftScore = leftNeed - bias * (leftNeed + rightNeed + 1);
                const rightScore = rightNeed + bias * (leftNeed + rightNeed + 1);
                if (leftScore <= rightScore) {
                    left.push({ child, fp });
                    leftNeed += fp + gapPx;
                } else {
                    right.push({ child, fp });
                    rightNeed += fp + gapPx;
                }
            }

            const placeSide = (list, side) => {
                const total = list.reduce((a, it) => a + it.fp, 0) + Math.max(0, list.length - 1) * gapPx;
                const scale = total > usableLen ? usableLen / total : 1;
                const span = total * scale;
                const sideShift = (hash01(node.id + ":shift:" + (side < 0 ? "L" : "R")) - 0.5) * usableLen * 0.22;
                let accPx = clamp((usableLen - span) * 0.5 + sideShift, 0, Math.max(0, usableLen - span));
                const weights = list.map((it) => coneWeight(it.child));
                const sumW = weights.reduce((a, b) => a + b, 0) || 1;
                let wAcc = 0;

                for (let li = 0; li < list.length; li++) {
                    const it = list[li];
                    const fp = it.fp * scale;
                    const centerPx = accPx + fp * 0.5;
                    accPx += fp + gapPx * scale;
                    const t = clamp(
                        lateralMinT + (centerPx / usableLen) * (lateralMaxT - lateralMinT),
                        lateralMinT,
                        lateralMaxT
                    );

                    const child = it.child;
                    const s = samplePathAt(path.samples, t);
                    const childLeaf = child.children.length === 0;
                    const need = child._planNeed || (childLeaf ? 26 : 44);
                    const d = child._planDepth || 1;
                    const wf = (wAcc + weights[li] * 0.5) / sumW;
                    wAcc += weights[li];

                    // More outward near trunk to reduce crossing in dense base areas.
                    const trunkProxBoost = (1 - t) * 18;
                    const asym = (hash01(child.id + ":spread") - 0.5) * 8;
                    const spreadDeg = clamp(
                        (childLeaf ? 36 : 30) + d * 4 + Math.sqrt(need) * (childLeaf ? 0.11 : 0.13) + trunkProxBoost + asym,
                        childLeaf ? 32 : 26,
                        childLeaf ? 84 : 80
                    );
                    const basePosInset = childLeaf ? 1.18 : 0.36;
                    const sx = s.x + s.normX * side * (s.w / 2) * basePosInset;
                    const sy = s.y + s.normY * side * (s.w / 2) * basePosInset;

                    const baseW = Math.max(
                        childLeaf ? 2.2 : 2.8,
                        Math.min(s.w * 0.72, childLeaf ? 5.4 : s.w * 0.9)
                    );
                    const fullLen = childLeaf
                        ? clamp((profile.levelUnit || 70) * 0.28 + need * 0.04, 12, 26)
                        : clamp(
                            (profile.levelUnit || 70) * clamp(0.95 + Math.sqrt(need) * 0.025, 0.9, 1.55),
                            24,
                            (profile.levelUnit || 70) * 1.9
                        );
                    const plannedNeedLen = childLeaf ? 0 : requiredLengthForNode(child, profile);
                    let finalLen = fullLen;
                    if (childLeaf) {
                        // Ensure leaf body clears parent branch/trunk envelope:
                        // require enough lateral displacement from the spawn area.
                        const leafSize = 30;
                        const leafR = leafSize * 0.55;
                        const requiredLateral = s.w * 0.46 + leafR * 0.55 + 4;
                        const sinSpread = Math.max(0.52, Math.sin(deg2rad(spreadDeg)));
                        const minLenForClearance = requiredLateral / sinSpread;
                        finalLen = clamp(Math.max(finalLen, minLenForClearance), 12, 30);
                    } else {
                        finalLen = Math.max(finalLen, plannedNeedLen);
                    }
                    const childTipW = childLeaf
                        ? Math.max(0.5, baseW * 0.35)
                        : Math.max(0.9, baseW * 0.42);

                    // Subtree-aware angular slotting (calculated, not trial):
                    // each child receives an angle slot proportional to subtree weight.
                    const baseDeg = clamp(30 + (1 - t) * 26 + (childLeaf ? 6 : 0), 28, 62);
                    const fanHalfDeg = clamp(16 + (1 - t) * 30 + Math.sqrt(sumW) * 2.2, 18, 64);
                    const centerFrac = (wf - 0.5) * 2;
                    const slotDeg = centerFrac * fanHalfDeg;
                    const endAngle = s.angle + side * deg2rad(baseDeg + slotDeg);

                    const baseR = Math.max(4.5, baseW * 0.62);
                    const baseCollides = hasBaseCollision(sx, sy, baseR);
                    registerBase(sx, sy, baseR);

                    child._targetAngle = endAngle;
                    const childPath = computeBranchPath(
                        sx,
                        sy,
                        s.angle,
                        endAngle,
                        finalLen,
                        baseW,
                        childTipW,
                        profile.curveMin,
                        side
                    );

                    buildBranchPlanned(
                        child,
                        0,
                        0,
                        0,
                        0,
                        depth + 1,
                        profile,
                        allBranches,
                        childPath,
                        baseCollides
                    );
                }
            };

            placeSide(left, -1);
            placeSide(right, 1);
        }
    }

    allBranches.push({
        path,
        path2d: makePath2D(path),
        nodeId: node.id,
        depth,
        isLeaf,
        tipWidth,
        ranges: profile,
        leafData,
        collisionAtBase,
        baseAllowT: 0.5,
        minT: lateralMinT,
        maxT: lateralMaxT,
    });
}
