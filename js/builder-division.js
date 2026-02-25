/**
 * ═══════════════════ DIVISION BUILDER ═══════════════════
 * Builds a tree using the "division" growth mode.
 * Branches divide at their tips into N children.
 */

import { deg2rad, rand } from "./utils.js";
import {
    solveBranchPath,
    addPathToCollisionMap,
    getChildrenBySpace,
} from "./collision.js";
import { fitLeafRenderData, addLeafBodyToCollisionMap } from "./leaf.js";

/**
 * @param {Array} allBranches – mutable array to push renderable branches into
 */
export function buildBranchDivision(
    node,
    x0,
    y0,
    startAngle,
    width,
    depth,
    ranges,
    allBranches
) {
    const isLeaf = node.children.length === 0;
    let length, tipWidth;

    if (isLeaf) {
        length = rand(14, 24);
        tipWidth = 0.5;
    } else if (depth === 0) {
        length = ranges.trunkLen;
        tipWidth = width;
    } else {
        length =
            rand(ranges.lenMin, ranges.lenMax) * Math.max(0.4, 1 - depth * 0.1);
        tipWidth = width;
    }

    const baseWidth = isLeaf ? Math.min(width * 0.3, 4) : width;
    const avgWidth = (baseWidth + tipWidth) * 0.5;
    const targetEndAngle =
        node._targetAngle !== undefined ? node._targetAngle : startAngle;

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
        requireCollisionCheck: depth > 0,
    });
    const path = solved.path;

    // ── Leaf or branch collision registration ──
    let leafData = null;
    if (isLeaf) {
        leafData = fitLeafRenderData(path, tipWidth, ranges, node.id);
        addPathToCollisionMap(path, avgWidth);
        addLeafBodyToCollisionMap(leafData);
    } else {
        addPathToCollisionMap(path, avgWidth);
    }

    // ── Recurse into children ──
    if (!isLeaf) {
        const orderedChildren = getChildrenBySpace(node);
        const n = orderedChildren.length;
        const spread = deg2rad(rand(ranges.angleMin, ranges.angleMax));
        const childW = tipWidth / n;
        for (let i = 0; i < n; i++) {
            const child = orderedChildren[i];
            const offset = -tipWidth / 2 + i * childW + childW / 2;
            const cx = path.tipX + path.tipNormX * offset;
            const cy = path.tipY + path.tipNormY * offset;
            const cAngle =
                n === 1
                    ? path.tipTangentAngle + rand(-spread * 0.15, spread * 0.15)
                    : path.tipTangentAngle - spread / 2 + spread * (i / (n - 1));
            child._targetAngle = cAngle + rand(-0.04, 0.04);
            buildBranchDivision(
                child,
                cx,
                cy,
                path.tipTangentAngle,
                childW,
                depth + 1,
                ranges,
                allBranches
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
        isLeaf,
        tipWidth,
        ranges,
        leafData,
        minT: null,
    });
}
