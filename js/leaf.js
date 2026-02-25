/**
 * ═══════════════════ LEAF ═══════════════════
 * Leaf render-data creation, collision circles, and fitting.
 */

import { lerp, hash01, LEAF_SIZE } from "./utils.js";
import {
    distToSegmentSquared,
    drawnSegments,
    drawnLeafBodies,
} from "./collision.js";

/**
 * Create raw leaf render data at a path tip.
 */
export function createLeafRenderData(
    path,
    tipW,
    ranges,
    nodeId,
    angleOffset = 0,
    lenMul = 1
) {
    const len = lerp(1.5, 3.5, hash01(nodeId + ":leafLen")) * lenMul;
    const ang =
        path.tipTangentAngle +
        lerp(-0.08, 0.08, hash01(nodeId + ":leafAng")) +
        angleOffset;
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

/**
 * Build 3 collision circles approximating leaf body.
 */
export function buildLeafCollisionCircles(leaf) {
    const dirX = Math.sin(leaf.angle);
    const dirY = -Math.cos(leaf.angle);
    const halfLen = leaf.size * 0.5;
    return [
        {
            x: leaf.x + dirX * (halfLen * 0.34),
            y: leaf.y + dirY * (halfLen * 0.34),
            r: leaf.size * 0.16,
        },
        {
            x: leaf.x + dirX * (halfLen * 0.02),
            y: leaf.y + dirY * (halfLen * 0.02),
            r: leaf.size * 0.2,
        },
        {
            x: leaf.x - dirX * (halfLen * 0.3),
            y: leaf.y - dirY * (halfLen * 0.3),
            r: leaf.size * 0.14,
        },
    ];
}

/**
 * Check if a leaf body collides with existing drawn geometry.
 */
export function hasLeafBodyCollision(leaf) {
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

/**
 * Try multiple offsets to find a non-colliding leaf position.
 */
export function fitLeafRenderData(path, tipW, ranges, nodeId) {
    const angleOffsets = [0, -0.2, 0.2, -0.34, 0.34];
    const lenMul = [1, 1.22, 0.84];
    for (const off of angleOffsets) {
        for (const lm of lenMul) {
            const candidate = createLeafRenderData(
                path,
                tipW,
                ranges,
                nodeId,
                off,
                lm
            );
            if (!hasLeafBodyCollision(candidate)) return candidate;
        }
    }
    return createLeafRenderData(path, tipW, ranges, nodeId);
}

/**
 * Register a leaf's collision circles into the global collision map.
 */
export function addLeafBodyToCollisionMap(leaf) {
    const circles = buildLeafCollisionCircles(leaf);
    for (const c of circles) drawnLeafBodies.push(c);
}
