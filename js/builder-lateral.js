/**
 * ═══════════════════ LATERAL BUILDER ═══════════════════
 * Builds a tree using the "lateral" growth mode.
 * Side branches sprout along the parent's length.
 */

import { deg2rad, lerp, rand, seededRandom } from "./utils.js";
import { samplePathAt } from "./path.js";
import {
    solveBranchPath,
    addPathToCollisionMap,
    checkCollision,
} from "./collision.js";
import { fitLeafRenderData, addLeafBodyToCollisionMap } from "./leaf.js";

/**
 * @param {Array} allBranches – mutable array to push renderable branches into
 */
export function buildBranchLateral(
    node,
    x0,
    y0,
    startAngle,
    width,
    depth,
    ranges,
    allBranches,
    prePath = null
) {
    const isNodeLeaf = node.children.length === 0;
    let path = prePath;
    let length, tipWidth, baseWidth;

    if (path) {
        baseWidth = path.samples[0].w;
        length = 0;
        const w = baseWidth;
        const tipChild =
            (node.children.length > 0 &&
                node.children.find((c) => c.children.length > 0)) ||
            node.children[0];
        tipWidth =
            tipChild && tipChild.children.length === 0
                ? Math.min(w * 0.3, 3.5)
                : w * 0.8;
        tipWidth = path.samples[path.samples.length - 1].w;
    } else {
        baseWidth = width;
        if (isNodeLeaf) {
            length = rand(14, 24);
            tipWidth = 0.5;
            baseWidth = Math.min(width, 4);
        } else {
            length =
                depth === 0
                    ? ranges.trunkLen
                    : rand(ranges.lenMin, ranges.lenMax) *
                    Math.max(0.3, 1 - depth * 0.12);
            const tipChild =
                (node.children.length > 0 &&
                    node.children.find((c) => c.children.length > 0)) ||
                node.children[0];
            tipWidth =
                tipChild && tipChild.children.length === 0
                    ? Math.min(width * 0.3, 3.5)
                    : width * (depth === 0 ? 0.8 : 0.45);
        }

        const baseEndAngle =
            node._targetAngle !== undefined
                ? node._targetAngle
                : startAngle + rand(-0.08, 0.08);
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
            requireCollisionCheck: depth > 0,
        });
        path = solved.path;
    }

    // ── Leaf / branch collision registration ──
    let leafData = null;
    if (isNodeLeaf) {
        leafData = fitLeafRenderData(path, tipWidth, ranges, node.id);
        addPathToCollisionMap(path, (baseWidth + tipWidth) / 2);
        addLeafBodyToCollisionMap(leafData);
    } else if (!prePath) {
        addPathToCollisionMap(path, (baseWidth + tipWidth) / 2);
    }

    // ── Separate branches vs leaves, sorted by space need ──
    const branches = node.children
        .filter((c) => c.children.length > 0)
        .sort((a, b) => (b._spaceNeed || 0) - (a._spaceNeed || 0));
    const leaves = node.children
        .filter((c) => c.children.length === 0)
        .sort((a, b) => (b._spaceNeed || 0) - (a._spaceNeed || 0));

    let tipChild, sideChildren;
    if (branches.length > 0) {
        tipChild = branches[0];
        sideChildren = [...branches.slice(1), ...leaves];
    } else {
        tipChild = leaves[0];
        sideChildren = leaves.slice(1);
    }
    sideChildren.sort(
        (a, b) => (b._spaceNeed || 0) - (a._spaceNeed || 0)
    );

    // ── Continue tip child ──
    if (tipChild && !isNodeLeaf) {
        tipChild._targetAngle = path.tipTangentAngle + rand(-0.1, 0.1);
        buildBranchLateral(
            tipChild,
            path.tipX,
            path.tipY,
            path.tipTangentAngle,
            tipWidth,
            depth + 1,
            ranges,
            allBranches
        );
    }

    // ── Lateral side children ──
    let lateralMinT = ranges.latMinHeight,
        lateralMaxT = 1.0;
    const num = sideChildren.length;
    if (num > 0 && !isNodeLeaf) {
        const totalSpaceNeed = sideChildren.reduce(
            (acc, c) => acc + Math.max(8, (c._spaceNeed || 20) * 0.28),
            0
        );
        const needed = totalSpaceNeed * Math.max(0.55, ranges.widthRatio);
        const avail = length * (lateralMaxT - lateralMinT);
        if (needed > avail)
            lateralMinT = Math.max(0.15, lateralMaxT - needed / length);

        let plans = [];
        let lastSide = seededRandom() < 0.5 ? 1 : -1;

        for (let i = 0; i < num; i++) {
            const t =
                num === 1
                    ? (lateralMinT + lateralMaxT) / 2
                    : lerp(lateralMinT, lateralMaxT, i / (num - 1));
            const s = samplePathAt(path.samples, t);
            let side = lastSide * -1;
            lastSide = side;
            const child = sideChildren[i];
            const isLeaf = child.children.length === 0;
            const spaceNeed = child._spaceNeed || (isLeaf ? 20 : 42);
            const bW = Math.min(
                s.w * ranges.widthRatio,
                isLeaf ? 5.0 : 999
            );
            const inset = isLeaf ? 0.95 : 0.15;
            const estLen = isLeaf
                ? Math.max(16, Math.min(30, spaceNeed * 0.45))
                : Math.max(
                    length * 0.45,
                    Math.min(length * 0.95, spaceNeed * 0.55)
                );
            const angleD = rand(ranges.latAngleMin, ranges.latAngleMax);

            let bestAng = s.angle + side * deg2rad(angleD);
            const probes = [0, -20, 20];
            for (let off of probes) {
                const testAng = s.angle + side * deg2rad(angleD + off);
                const tx = s.x + Math.sin(testAng) * estLen;
                const ty = s.y - Math.cos(testAng) * estLen;
                const collides = checkCollision(
                    [
                        { x: s.x, y: s.y },
                        { x: tx, y: ty },
                    ],
                    bW
                );
                if (!collides) {
                    bestAng = testAng;
                    break;
                }
            }

            const sx = s.x + s.normX * side * (s.w / 2) * inset;
            const sy = s.y + s.normY * side * (s.w / 2) * inset;
            plans.push({
                child,
                isLeaf,
                sx,
                sy,
                baseAngle: s.angle,
                angle: bestAng,
                side,
                estLen,
                bW,
                t,
                spaceNeed,
                bend: 0,
            });
        }

        // ── Sibling resolution: push overlapping siblings apart ──
        for (let iter = 0; iter < 6; iter++) {
            let changed = false;
            for (let i = 0; i < plans.length; i++) {
                for (let j = i + 1; j < plans.length; j++) {
                    const p1 = plans[i],
                        p2 = plans[j];
                    const d1 = (p1.sx - p2.sx) ** 2 + (p1.sy - p2.sy) ** 2;
                    if (d1 < 900) {
                        const tx1 =
                            p1.sx + Math.sin(p1.angle) * p1.estLen,
                            ty1 =
                                p1.sy - Math.cos(p1.angle) * p1.estLen;
                        const tx2 =
                            p2.sx + Math.sin(p2.angle) * p2.estLen,
                            ty2 =
                                p2.sy - Math.cos(p2.angle) * p2.estLen;
                        if ((tx1 - tx2) ** 2 + (ty1 - ty2) ** 2 < 150) {
                            const push = 0.08;
                            if (p1.angle < p2.angle) {
                                p1.angle -= push;
                                p2.angle += push;
                            } else {
                                p1.angle += push;
                                p2.angle -= push;
                            }
                            changed = true;
                        }
                    }
                }
            }
            if (!changed) break;
        }

        // ── Build each lateral branch ──
        for (let p of plans) {
            const fullLen = p.isLeaf
                ? Math.max(rand(14, 24), p.spaceNeed * 0.35)
                : Math.max(
                    rand(ranges.lenMin, ranges.lenMax) *
                    Math.max(0.3, 1 - depth * 0.12),
                    p.spaceNeed * 0.45
                );
            const tipW = p.isLeaf
                ? Math.max(0.5, p.bW * 0.35)
                : p.bW * 0.4;

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
                requireCollisionCheck: depth > 0,
            });

            // ── Mirror if collision found ──
            if (!solved.isCollisionFree) {
                const s = samplePathAt(path.samples, p.t);
                const nSide = p.side * -1;
                const nIn = p.isLeaf ? 0.95 : 0.15;
                const nsx = s.x + s.normX * nSide * (s.w / 2) * nIn;
                const nsy = s.y + s.normY * nSide * (s.w / 2) * nIn;
                const altAngle =
                    s.angle +
                    nSide * deg2rad(rand(ranges.latAngleMin, ranges.latAngleMax));
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
                    requireCollisionCheck: true,
                });
                if (mirrorSolved.isCollisionFree) solved = mirrorSolved;
            }

            p.child._targetAngle = solved.endAngle;
            addPathToCollisionMap(solved.path, p.bW);
            buildBranchLateral(
                p.child,
                0,
                0,
                0,
                0,
                depth + 1,
                ranges,
                allBranches,
                solved.path
            );
        }
    }

    // ── Build Path2D for hit-testing ──
    const path2d = new Path2D();
    path2d.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i < path.left.length; i++)
        path2d.lineTo(path.left[i].x, path.left[i].y);
    const end = path.right.length - 1;
    for (let i = end; i >= 0; i--)
        path2d.lineTo(path.right[i].x, path.right[i].y);
    path2d.closePath();

    allBranches.push({
        path,
        path2d,
        nodeId: node.id,
        depth,
        isLeaf: isNodeLeaf,
        tipWidth,
        ranges,
        leafData,
        minT: lateralMinT,
        maxT: lateralMaxT,
    });
}
