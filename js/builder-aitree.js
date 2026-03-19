import { computeBranchPath, samplePathAt } from "./path.js";
import { createLeafRenderData } from "./leaf.js";
import { hash01 } from "./utils.js";

function makePath2D(path) {
    const p2d = new Path2D();
    p2d.moveTo(path.left[0].x, path.left[0].y);
    for (let i = 1; i < path.left.length; i++) p2d.lineTo(path.left[i].x, path.left[i].y);
    for (let i = path.right.length - 1; i >= 0; i--) p2d.lineTo(path.right[i].x, path.right[i].y);
    p2d.closePath();
    return p2d;
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function countTerminalLeaves(node) {
    if (!node?.children?.length) return 1;
    let total = 0;
    for (const child of node.children) total += countTerminalLeaves(child);
    return Math.max(1, total);
}

function jitter(nodeId, key, lo, hi) {
    return lo + (hi - lo) * hash01(`${nodeId}:${key}`);
}

function mixAngle(a, b, t) {
    return a + (b - a) * t;
}

export function buildBranchAITree(node, x, y, angle, length, width, depth, ranges, allBranches, side = 1) {
    const isLeaf = node.children.length === 0;
    const tipWidth = isLeaf ? 0.5 : Math.max(1.2, width * (depth === 0 ? 0.82 : depth === 1 ? 0.72 : 0.62));
    const bend = isLeaf ? 0.035 : jitter(node.id, "bend", depth === 0 ? 0.03 : 0.05, depth <= 1 ? 0.11 : 0.16);
    const curveDir = side === 0 ? 1 : side;
    const endAngle = angle + jitter(node.id, "lean", -0.05, 0.05);
    const path = computeBranchPath(x, y, angle, endAngle, length, width, tipWidth, bend, curveDir);

    let leafData = null;
    if (isLeaf) {
        const leafSide = side === 0 ? (hash01(`${node.id}:leafSide`) < 0.5 ? -1 : 1) : side;
        leafData = createLeafRenderData(path, tipWidth, ranges, node.id, leafSide * 0.1, 0.9);
        leafData.angle = path.tipTangentAngle + leafSide * 0.1;
        leafData.x = path.tipX + Math.sin(leafData.angle) * 6 + path.tipNormX * leafSide * 1.6;
        leafData.y = path.tipY - Math.cos(leafData.angle) * 6 + path.tipNormY * leafSide * 1.6;
        leafData.size = clamp(17 - depth * 0.6, 12, 18);
    }

    if (!isLeaf) {
        const children = node.children;
        const n = children.length;
        const weights = children.map((child) => countTerminalLeaves(child));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
        const baseSpawnT = clamp(0.7 + depth * 0.04 - Math.max(0, n - 2) * 0.03, 0.58, 0.84);
        const laneReach = Math.max(width * 0.7, length * 0.045);
        const spreadBase =
            depth === 0 ? 0.8 :
                depth === 1 ? 0.5 :
                    depth === 2 ? 0.34 : 0.24;
        const spread = clamp(spreadBase + Math.max(0, n - 2) * 0.04, 0.16, 0.92);
        const childWidthScale =
            n === 1 ? 0.78 :
                n === 2 ? 0.54 :
                    n === 3 ? 0.4 : 0.3;
        let accum = 0;

        for (let i = 0; i < n; i++) {
            const child = children[i];
            const weight = weights[i];
            const center = (accum + weight * 0.5) / totalWeight - 0.5;
            accum += weight;

            const bias = jitter(child.id, "slot", -0.025, 0.025);
            const childSide = center < -0.03 ? -1 : center > 0.03 ? 1 : side || 1;
            const rootT = 0.42 + (1 - Math.abs(center) * 1.35) * 0.34 + bias * 0.06;
            const spawnT = depth === 0 ? clamp(rootT, 0.34, 0.8) : clamp(baseSpawnT + bias * 0.08, 0.58, 0.86);
            const spawn = samplePathAt(path.samples, spawnT);
            const upwardTarget =
                depth === 0
                    ? center * 1.02
                    : path.tipTangentAngle + center * 2 * spread;
            const childAngle = mixAngle(path.tipTangentAngle, upwardTarget, depth === 0 ? 0.88 : 0.72) + bias * 0.35;
            const lateralOffset = depth === 0
                ? center * width * 0.42
                : (center * 1.1 + bias * 0.6) * laneReach;
            const childLenBase =
                depth === 0 ? 0.7 :
                    depth === 1 ? 0.68 :
                        depth === 2 ? 0.62 : 0.57;
            const childLen = length * childLenBase * jitter(child.id, "len", 0.9, 1.02);
            const childW = Math.max(2.1, width * childWidthScale * jitter(child.id, "width", 0.94, 1.06));
            const cx = spawn.x + spawn.normX * lateralOffset;
            const cy = spawn.y + spawn.normY * lateralOffset;

            buildBranchAITree(
                child,
                cx,
                cy,
                childAngle,
                childLen,
                childW,
                depth + 1,
                ranges,
                allBranches,
                childSide
            );
        }
    }

    allBranches.push({
        path,
        path2d: makePath2D(path),
        nodeId: node.id,
        depth,
        isLeaf,
        tipWidth,
        ranges,
        leafData,
        collisionAtBase: false
    });
}
