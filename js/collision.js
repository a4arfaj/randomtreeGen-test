/**
 * ═══════════════════ COLLISION LOGIC ═══════════════════
 * Segment/circle collision detection and avoidance.
 * Also contains the smart branch-path solver.
 */

import { deg2rad, LEAF_SIZE, rand } from "./utils.js";
import { computeBranchPath } from "./path.js";

// ── Collision state (reset per generation) ──
export let drawnSegments = []; // {p1, p2, w}
export let drawnLeafBodies = []; // {x, y, r}

export function resetCollisionState() {
    drawnSegments = [];
    drawnLeafBodies = [];
}

// ── Subtree space estimation ──

export function getAvgBranchLength(depth, ranges, mode) {
    if (depth === 0) return ranges.trunkLen;
    const avgLen = (ranges.lenMin + ranges.lenMax) * 0.5;
    const decay =
        mode === "division"
            ? Math.max(0.4, 1 - depth * 0.1)
            : Math.max(0.3, 1 - depth * 0.12);
    return avgLen * decay;
}

export function estimateSubtreeSpace(node, depth, ranges, mode) {
    if (!node) return 0;
    if (node.children.length === 0) {
        node._spaceNeed = LEAF_SIZE * 0.8 + 8;
        node._subtreeDepth = 1;
        node._leafCount = 1;
        return node._spaceNeed;
    }

    const childSpaces = node.children.map((ch) =>
        estimateSubtreeSpace(ch, depth + 1, ranges, mode)
    );
    const totalChildSpace = childSpaces.reduce((a, b) => a + b, 0);
    const maxChildSpace = childSpaces.length ? Math.max(...childSpaces) : 0;
    const branchLen = getAvgBranchLength(depth, ranges, mode);
    const avgAngleDeg =
        mode === "division"
            ? (ranges.angleMin + ranges.angleMax) * 0.5
            : (ranges.latAngleMin + ranges.latAngleMax) * 0.5;
    const lateralReach =
        Math.sin(deg2rad(Math.max(10, Math.min(80, avgAngleDeg)))) * branchLen;
    const ownSpan = Math.max(14, branchLen * 0.2 + lateralReach * 0.9);
    const fanOut =
        mode === "division"
            ? totalChildSpace * 0.55 + maxChildSpace * 0.2
            : totalChildSpace * 0.45 + maxChildSpace * 0.35;

    node._spaceNeed = ownSpan + fanOut;
    node._subtreeDepth =
        1 + Math.max(0, ...node.children.map((ch) => ch._subtreeDepth || 0));
    node._leafCount = node.children.reduce(
        (acc, ch) => acc + (ch._leafCount || 0),
        0
    );
    return node._spaceNeed;
}

export function prepareSubtreeSpace(root, ranges, mode) {
    estimateSubtreeSpace(root, 0, ranges, mode);
}

export function getChildrenBySpace(node) {
    return [...node.children].sort(
        (a, b) => (b._spaceNeed || 0) - (a._spaceNeed || 0)
    );
}

// ── Segment-point distance ──

export function distToSegmentSquared(p, v, w) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (p.x - v.x - t * (w.x - v.x)) ** 2 + (p.y - v.y - t * (w.y - v.y)) ** 2;
}

// ── Collision check against drawn geometry ──

export function checkCollision(samples, myWidth) {
    if (drawnSegments.length === 0 && drawnLeafBodies.length === 0) return false;
    const checkStep = 2;
    for (let i = 0; i < samples.length; i += checkStep) {
        const p = samples[i];
        const radius = myWidth * 0.55;
        for (const seg of drawnSegments) {
            if (p.x < Math.min(seg.p1.x, seg.p2.x) - 20) continue;
            if (p.x > Math.max(seg.p1.x, seg.p2.x) + 20) continue;
            if (p.y < Math.min(seg.p1.y, seg.p2.y) - 20) continue;
            if (p.y > Math.max(seg.p1.y, seg.p2.y) + 20) continue;

            const d2 = distToSegmentSquared(p, seg.p1, seg.p2);
            const minDist = radius + seg.w * 0.55;
            if (d2 < minDist * minDist) return true;
        }
        for (const leaf of drawnLeafBodies) {
            const dx = p.x - leaf.x;
            const dy = p.y - leaf.y;
            const minDist = radius + leaf.r;
            if (dx * dx + dy * dy < minDist * minDist) return true;
        }
    }
    return false;
}

// ── Register a path in the collision map ──

export function addPathToCollisionMap(path, avgWidth) {
    const step = 4;
    for (let i = 0; i < path.samples.length - step; i += step) {
        drawnSegments.push({
            p1: path.samples[i],
            p2: path.samples[i + step],
            w: avgWidth,
        });
    }
}

// ── Smart branch-path solver (tries multiple combos to avoid collisions) ──

export function solveBranchPath(opts) {
    const {
        x0,
        y0,
        startAngle,
        endAngle,
        length,
        baseWidth,
        tipWidth,
        isLeaf,
        ranges,
        avgWidth,
        requireCollisionCheck = true,
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
            ranges.curveMax,
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
                        x0,
                        y0,
                        startAngle,
                        testEndAngle,
                        testLen,
                        baseWidth,
                        tipWidth,
                        curve,
                        cDir
                    );
                    if (!fallback)
                        fallback = {
                            path: p,
                            endAngle: testEndAngle,
                            isCollisionFree: false,
                        };
                    if (!shouldCheck || !checkCollision(p.samples, avgWidth)) {
                        return { path: p, endAngle: testEndAngle, isCollisionFree: true };
                    }
                }
            }
        }
    }

    return (
        fallback || {
            path: computeBranchPath(
                x0,
                y0,
                startAngle,
                endAngle,
                Math.max(6, length),
                baseWidth,
                tipWidth,
                baseCurve,
                isLeaf ? 0 : 1
            ),
            endAngle,
            isCollisionFree: false,
        }
    );
}
