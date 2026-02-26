/**
 * AGENT
 * - Finds collisions, deepest branch first, level-by-level.
 * - Calculates correct rotation direction geometrically (no randomness).
 * - Escalates to parent chain when stuck, one level at a time.
 * - Draws only the overlapping polygon region in red (not the whole branch).
 */

import { deg2rad } from "./utils.js";
import { ctx, canvas } from "./ui-inputs.js";

// 
// Tiny geometry helpers
// 
function rotatePoint(p, cx, cy, cos, sin) {
    const dx = p.x - cx, dy = p.y - cy;
    p.x = cx + dx * cos - dy * sin;
    p.y = cy + dx * sin + dy * cos;
}

function scalePoint(p, ox, oy, factor) {
    p.x = ox + (p.x - ox) * factor;
    p.y = oy + (p.y - oy) * factor;
}

function branchCentroid(b) {
    const pts = [...(b.path.left || []), ...(b.path.right || [])];
    if (!pts.length) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
}

function rebuildPath2d(b) {
    if (!b.path.left || !b.path.right || !b.path.left.length) return;
    const p2d = new Path2D();
    p2d.moveTo(b.path.left[0].x, b.path.left[0].y);
    for (let i = 1; i < b.path.left.length; i++)
        p2d.lineTo(b.path.left[i].x, b.path.left[i].y);
    for (let i = b.path.right.length - 1; i >= 0; i--)
        p2d.lineTo(b.path.right[i].x, b.path.right[i].y);
    p2d.closePath();

    if (b.isLeaf && b.leafData) {
        const size = b.leafData.size;
        const ang = b.leafData.angle;
        // Center of the leaf body:
        const cx = b.leafData.x + (size / 4) * Math.sin(ang);
        const cy = b.leafData.y - (size / 4) * Math.cos(ang);
        const radius = size * 0.45;

        p2d.moveTo(cx + radius, cy);
        p2d.arc(cx, cy, radius, 0, Math.PI * 2);
    }

    b.path2d = p2d;
}

// ── Branch geometry snapshot / restore ─────────────────────────────────────
// Captures only the mutable geometric data that the agent changes.
export function snapshotBranches(allBranches) {
    return allBranches.map(b => ({
        nodeId: b.nodeId,
        left: (b.path?.left || []).map(p => ({ x: p.x, y: p.y })),
        right: (b.path?.right || []).map(p => ({ x: p.x, y: p.y })),
        samples: (b.path?.samples || []).map(p => p ? { x: p.x, y: p.y } : null),
        tipX: b.path?.tipX,
        tipY: b.path?.tipY,
        tipNormX: b.path?.tipNormX,
        tipNormY: b.path?.tipNormY,
        tipTangentAngle: b.path?.tipTangentAngle,
        leafData: b.leafData ? { ...b.leafData } : null,
    }));
}

export function restoreBranches(allBranches, snapshot) {
    const byId = new Map(snapshot.map(s => [s.nodeId, s]));
    for (const b of allBranches) {
        const s = byId.get(b.nodeId);
        if (!s || !b.path) continue;
        // Restore in-place so references held elsewhere stay valid
        const copyArr = (src, dst) => {
            dst.length = src.length;
            for (let i = 0; i < src.length; i++)
                dst[i] = src[i] ? { x: src[i].x, y: src[i].y } : null;
        };
        copyArr(s.left, b.path.left || (b.path.left = []));
        copyArr(s.right, b.path.right || (b.path.right = []));
        copyArr(s.samples, b.path.samples || (b.path.samples = []));
        b.path.tipX = s.tipX;
        b.path.tipY = s.tipY;
        b.path.tipNormX = s.tipNormX;
        b.path.tipNormY = s.tipNormY;
        b.path.tipTangentAngle = s.tipTangentAngle;
        if (s.leafData && b.leafData) Object.assign(b.leafData, s.leafData);
        rebuildPath2d(b);
    }
}

// 
export class Agent {
    constructor() {
        this.active = false;
        this.x = -100;
        this.y = -100;
        this.target = null;
        this.state = "IDLE";
        this.pupilAngle = 0;
        this.currentFixAngle = 0;
        this.fixDir = 1;
        this.triedBothDirs = false;
        this.descendants = [];
        // Branches we've done our best on; skip until next full clear
        this.exhaustedNodes = new Set();
        this.madeProgress = false;
        this.currentRule = "Idle";

        this._parentMap = new Map();
    }

    /** Returns 'Leaf' or 'Branch' for a given branch object */
    _label(b) { return b && b.isLeaf ? 'Leaf' : 'Branch'; }

    //  Parent-map (to skip natural joint touches) 
    _buildParentMap(treeRoot) {
        this._parentMap.clear();
        const walk = (node, pid) => {
            if (!node) return;
            if (pid != null) this._parentMap.set(node.id, pid);
            for (const c of (node.children || [])) walk(c, node.id);
        };
        walk(treeRoot, null);
    }

    _areAdjacent(b1, b2) {
        const n1 = b1.nodeId, n2 = b2.nodeId;
        if (n1 === n2) return true;
        if (this._parentMap.get(n1) === n2) return true;
        if (this._parentMap.get(n2) === n1) return true;
        return false;
    }

    //  Build the descendant branch list (branch objects) for a startBranch 
    _buildDescendants(startBranch, state) {
        const nodeMap = new Map();
        const walk = n => {
            if (!n) return;
            nodeMap.set(n.id, n);
            (n.children || []).forEach(walk);
        };
        if (state.tree) walk(state.tree);

        const ids = new Set();
        const mark = nId => {
            if (ids.has(nId)) return;
            ids.add(nId);
            const node = nodeMap.get(nId);
            if (node) (node.children || []).forEach(c => mark(c.id));
        };
        if (startBranch.nodeId != null) mark(startBranch.nodeId);

        return state.allBranches.filter(b => ids.has(b.nodeId));
    }

    //  External contact test 
    // Returns a Set of indices into state.allBranches for every branch the
    // given subtree collides with (excluding adj/self).
    _getExternalContacts(descendants, allBranches) {
        const descSet = new Set(descendants);
        const contacts = new Set();

        for (const bd of descendants) {
            if (!bd.path?.samples) continue;
            for (let j = 0; j < allBranches.length; j++) {
                if (contacts.has(j)) continue; // already counted
                const b2 = allBranches[j];
                if (descSet.has(b2)) continue;
                if (!b2.path2d) continue;
                if (this._areAdjacent(bd, b2)) continue;

                const s = bd.path.samples;
                for (let k = 4; k < s.length; k += 3) {
                    if (!s[k]) continue;
                    if (ctx.isPointInPath(b2.path2d, s[k].x, s[k].y)) {
                        contacts.add(j);
                        break;
                    }
                }
                if (!contacts.has(j) && bd.isLeaf && bd.leafData) {
                    const sz = bd.leafData.size;
                    const ang = bd.leafData.angle;
                    const lps = [
                        { x: bd.leafData.x, y: bd.leafData.y },
                        { x: bd.leafData.x + (sz / 3) * Math.sin(ang), y: bd.leafData.y - (sz / 3) * Math.cos(ang) }
                    ];
                    for (const pt of lps) {
                        if (ctx.isPointInPath(b2.path2d, pt.x, pt.y)) { contacts.add(j); break; }
                    }
                }
            }
        }
        return contacts;
    }

    // ── Score a single branch by its OWN geometry's overlaps ─────────────────
    // Only checks b1.path.samples against external branches (no subtree walk).
    // Returns { hits, collidingBranch, overlapMinIdx, overlapMaxIdx }
    _scoreSelf(b1, allBranches) {
        if (!b1.path?.samples) return { hits: 0, partners: 0 };
        const s = b1.path.samples;
        let totalHits = 0, partners = 0;
        let worstHits = 0, collidingBranch = null;
        let overlapMinIdx = -1, overlapMaxIdx = -1;

        for (let j = 0; j < allBranches.length; j++) {
            const b2 = allBranches[j];
            if (b2 === b1) continue;
            if (!b2.path2d) continue;
            if (this._areAdjacent(b1, b2)) continue;

            let hits = 0, minI = Infinity, maxI = -1;
            // Check every sample (dense scan – only on one branch, so cheap)
            for (let k = 4; k < s.length; k++) {
                if (!s[k]) continue;
                if (ctx.isPointInPath(b2.path2d, s[k].x, s[k].y)) {
                    hits++;
                    if (k < minI) minI = k;
                    if (k > maxI) maxI = k;
                }
            }
            let leafBodyHit = false;
            if (b1.isLeaf && b1.leafData) {
                const sz = b1.leafData.size;
                const ang = b1.leafData.angle;
                const lps = [
                    { x: b1.leafData.x, y: b1.leafData.y },
                    { x: b1.leafData.x + (sz / 3) * Math.sin(ang), y: b1.leafData.y - (sz / 3) * Math.cos(ang) }
                ];
                for (const pt of lps) {
                    if (ctx.isPointInPath(b2.path2d, pt.x, pt.y)) {
                        hits += 5;
                        leafBodyHit = true;
                        if (minI === Infinity) minI = s.length - 1;
                        maxI = s.length - 1;
                    }
                }
            }
            if (hits > 0) {
                totalHits += hits;
                partners++;
                if (hits > worstHits) {
                    worstHits = hits;
                    collidingBranch = b2;
                    overlapMinIdx = minI;
                    overlapMaxIdx = maxI;
                    this._worstIsLeafBody = leafBodyHit;
                }
            }
        }
        return { hits: totalHits, partners, collidingBranch, overlapMinIdx, overlapMaxIdx, isLeafBody: this._worstIsLeafBody };
    }

    // ── Find the branch to fix ──────────────────────────────────────────────
    //
    // Strategy (deepest-first, level-by-level):
    //   1. Score every non-trunk branch by ITS OWN overlaps only.
    //   2. Collect all branches that actually collide (hits > 0).
    //   3. Sort by depth DESCENDING — deepest first (leaves & tips).
    //      Tiebreak by hit count descending (worst collision first).
    //   4. Each branch is tried at its own level first.
    //      If boxed in, escalation walks up ONE parent at a time.
    //
    // This clears leaf-level problems before moving structural branches.
    _findBestTarget(state) {
        const candidates = [];

        for (const b1 of state.allBranches) {
            if (b1.depth === 0) continue;
            if (!b1.path2d) continue;
            if (!b1.path?.samples?.length) continue;

            const r = this._scoreSelf(b1, state.allBranches);
            if (r.hits > 0) candidates.push({ b1, r });
        }

        if (candidates.length === 0) return null;

        // Most collision partners first (fixes the most pairs at once),
        // then deepest first, then worst hit count.
        candidates.sort((a, b) => {
            if (a.r.partners !== b.r.partners) return b.r.partners - a.r.partners; // most partners first
            if (a.b1.depth !== b.b1.depth) return b.b1.depth - a.b1.depth; // deepest first
            return b.r.hits - a.r.hits; // worst collision first
        });

        for (const { b1: rawB1, r } of candidates) {
            let pivotB1 = rawB1;

            // Check exhaustion against the PIVOT
            if (this.exhaustedNodes.has(pivotB1.nodeId)) continue;

            const allCollisions = this._collectSubtreeCollisions(pivotB1, state);
            return {
                b1: pivotB1,
                collidingBranch: r.collidingBranch,
                overlapBranch: rawB1,
                overlapMinIdx: r.overlapMinIdx,
                overlapMaxIdx: r.overlapMaxIdx,
                isLeafBody: r.isLeafBody,
                allCollisions,
                initialTotalHits: allCollisions.reduce((s, c) => s + c.hits, 0),
                score: r.hits,
                targetX: pivotB1.path.samples[0].x,
                targetY: pivotB1.path.samples[0].y,
            };
        }
        return null; // every candidate's pivot is exhausted
    }

    // ── Collect ALL collision pairs across a branch's full subtree ────────────
    // Returns Array<{overlapBranch, collidingBranch, overlapMinIdx, overlapMaxIdx, hits, isLeafBody}>
    _collectSubtreeCollisions(pivotB1, state) {
        const descendants = this._buildDescendants(pivotB1, state);
        const descSet = new Set(descendants);
        const result = [];

        for (const bd of descendants) {
            if (!bd.path?.samples) continue;
            const s = bd.path.samples;

            for (let j = 0; j < state.allBranches.length; j++) {
                const b2 = state.allBranches[j];
                if (descSet.has(b2)) continue;
                if (!b2.path2d) continue;
                if (this._areAdjacent(bd, b2)) continue;

                let hits = 0, minI = Infinity, maxI = -1;
                for (let k = 4; k < s.length; k++) {
                    if (!s[k]) continue;
                    if (ctx.isPointInPath(b2.path2d, s[k].x, s[k].y)) {
                        hits++;
                        if (k < minI) minI = k;
                        if (k > maxI) maxI = k;
                    }
                }
                let leafBodyHit = false;
                if (bd.isLeaf && bd.leafData) {
                    const sz = bd.leafData.size;
                    const ang = bd.leafData.angle;
                    const lps = [
                        { x: bd.leafData.x, y: bd.leafData.y },
                        { x: bd.leafData.x + (sz / 3) * Math.sin(ang), y: bd.leafData.y - (sz / 3) * Math.cos(ang) }
                    ];
                    for (const pt of lps) {
                        if (ctx.isPointInPath(b2.path2d, pt.x, pt.y)) {
                            hits += 5;
                            leafBodyHit = true;
                            if (minI === Infinity) minI = s.length - 1;
                            maxI = s.length - 1;
                        }
                    }
                }
                if (hits > 0) {
                    result.push({
                        overlapBranch: bd,
                        collidingBranch: b2,
                        overlapMinIdx: minI,
                        overlapMaxIdx: maxI,
                        isLeafBody: leafBodyHit,
                        hits
                    });
                }
            }
        }
        return result;
    }

    // ── Weighted-vote direction using ALL collision pairs ─────────────────────
    // Each pair votes proportional to its hit-count for which side to rotate away from.
    // Net positive vote → +1 (right), net negative → -1 (left).
    _calcFixDirectionFromAll(b1, allCollisions) {
        if (!allCollisions?.length) return 1;
        const pivot = b1.path.samples[0];
        const bDx = b1.path.tipX - pivot.x;
        const bDy = b1.path.tipY - pivot.y;
        let vote = 0;

        for (const { collidingBranch, hits } of allCollisions) {
            const c = branchCentroid(collidingBranch);
            const cross = bDx * (c.y - pivot.y) - bDy * (c.x - pivot.x);
            vote += (cross > 0 ? 1 : -1) * hits;
        }
        return vote >= 0 ? 1 : -1;
    }


    // ── Virtual space probe ──────────────────────────────────────────────────
    // Without mutating any geometry, project each descendant sample point
    // to where it WOULD be at a given total rotation angle and test for
    // new contacts.  Returns true if the rotation would create a new hit.
    _wouldCreateNewContacts(descendants, allBranches, priorContacts, totalAngle, pivot) {
        const cos = Math.cos(totalAngle);
        const sin = Math.sin(totalAngle);
        const cx = pivot.x, cy = pivot.y;
        const descSet = new Set(descendants);

        for (const bd of descendants) {
            if (!bd.path?.samples) continue;
            const s = bd.path.samples;
            for (let k = 4; k < s.length; k += 3) {  // match _getExternalContacts stride
                const pt = s[k];
                if (!pt) continue;
                const dx = pt.x - cx, dy = pt.y - cy;
                const rx = cx + dx * cos - dy * sin;
                const ry = cy + dx * sin + dy * cos;

                for (let j = 0; j < allBranches.length; j++) {
                    if (priorContacts.has(j)) continue; // pre-existing, not "new"
                    const b2 = allBranches[j];
                    if (descSet.has(b2)) continue;
                    if (!b2.path2d) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (ctx.isPointInPath(b2.path2d, rx, ry)) return true;
                }
            }
            if (bd.isLeaf && bd.leafData) {
                const sz = bd.leafData.size;
                const ang = bd.leafData.angle;
                const lps = [
                    { x: bd.leafData.x, y: bd.leafData.y },
                    { x: bd.leafData.x + (sz / 3) * Math.sin(ang), y: bd.leafData.y - (sz / 3) * Math.cos(ang) }
                ];
                for (const pt of lps) {
                    const dx = pt.x - cx, dy = pt.y - cy;
                    const rx = cx + dx * cos - dy * sin;
                    const ry = cy + dx * sin + dy * cos;
                    for (let j = 0; j < allBranches.length; j++) {
                        if (priorContacts.has(j)) continue;
                        const b2 = allBranches[j];
                        if (descSet.has(b2)) continue;
                        if (!b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (ctx.isPointInPath(b2.path2d, rx, ry)) return true;
                    }
                }
            }
        }
        return false;
    }

    // Returns the max clean rotation (radians) in each direction before a
    // new collision would be created.  Probes in 5° increments up to maxAngle.
    _probeAvailableSpace(descendants, allBranches, pivot, priorContacts, maxPos, maxNeg) {
        const step = deg2rad(5);
        const spaceInDir = (dir, limit) => {
            for (let a = step; a <= limit + 0.001; a += step) {
                if (this._wouldCreateNewContacts(
                    descendants, allBranches, priorContacts, a * dir, pivot
                )) {
                    return Math.max(0, a - step);
                }
            }
            return limit;
        };
        return { spacePos: spaceInDir(1, maxPos), spaceNeg: spaceInDir(-1, maxNeg) };
    }

    //  Direction to swing b1 away from b2: cross-product of direction 
    _calcFixDirection(b1, b2) {
        const pivot = b1.path.samples[0];
        const c2 = branchCentroid(b2);
        const bDx = b1.path.tipX - pivot.x;
        const bDy = b1.path.tipY - pivot.y;
        const tDx = c2.x - pivot.x;
        const tDy = c2.y - pivot.y;
        // positive cross  b2 is to LEFT of b1  rotate RIGHT (+1) to move away
        // negative cross  b2 is to RIGHT        rotate LEFT  (-1)
        return (bDx * tDy - bDy * tDx) > 0 ? 1 : -1;
    }

    // ── Refresh ALL overlap zones each frame (indices + hit counts) ──────────
    _refreshOverlap(state) {
        if (!this.target?.b1) return;
        // Perform a fresh, universal scan every frame so that NEW collisions are caught
        this.target.allCollisions = this._collectSubtreeCollisions(this.target.b1, state);
    }

    //  Check if the tracked subtree still has ANY external collision 
    _subtreeStillCollides(state) {
        const descSet = new Set(this.descendants);
        for (const bd of this.descendants) {
            if (!bd.path?.samples) continue;
            const s = bd.path.samples;
            for (let j = 0; j < state.allBranches.length; j++) {
                const b2 = state.allBranches[j];
                if (descSet.has(b2)) continue;
                if (!b2.path2d) continue;
                if (this._areAdjacent(bd, b2)) continue;
                for (let k = 4; k < s.length; k += 3) {
                    if (!s[k]) continue;
                    if (ctx.isPointInPath(b2.path2d, s[k].x, s[k].y)) return true;
                }
            }
        }
        return false;
    }

    //  Branch straight-line length (sample[0]  last sample) 
    _branchLength(b) {
        if (!b.path?.samples?.length) return 0;
        const s = b.path.samples;
        const e = s[s.length - 1];
        return Math.hypot(e.x - s[0].x, e.y - s[0].y);
    }

    // ── Calculate safe rotation limits relative to parent ────────────────────
    _calcLimitsToParent(b, state, defaultMaxA) {
        let maxPos = defaultMaxA;
        let maxNeg = defaultMaxA;

        const parentId = this._parentMap.get(b.nodeId);
        if (parentId == null) return { maxPos, maxNeg };

        const parent = state.allBranches.find(pb => pb.nodeId === parentId);
        if (!parent || !parent.path || !parent.path.samples || !b.path || !b.path.samples || b.path.samples.length < 2) return { maxPos, maxNeg };

        const pivot = b.path.samples[0];

        // Find parent's tangent near the pivot
        let parentSampleIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < parent.path.samples.length; i++) {
            const p = parent.path.samples[i];
            if (!p) continue;
            const d = Math.hypot(p.x - pivot.x, p.y - pivot.y);
            if (d < minDist) { minDist = d; parentSampleIdx = i; }
        }

        let s1 = parent.path.samples[parentSampleIdx];
        let s2 = parentSampleIdx + 3 < parent.path.samples.length ? parent.path.samples[parentSampleIdx + 3] : parent.path.samples[parent.path.samples.length - 1];

        if (s1 === s2 && parentSampleIdx >= 3) {
            s1 = parent.path.samples[parentSampleIdx - 3];
        } else if (s1 === s2) {
            s2 = { x: parent.path.tipX, y: parent.path.tipY }; // fallback tip
        }

        const pVx = s2.x - s1.x;
        const pVy = s2.y - s1.y;

        const cVx = b.path.tipX - pivot.x;
        const cVy = b.path.tipY - pivot.y;

        let angleDiff = Math.atan2(cVy, cVx) - Math.atan2(pVy, pVx);
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const margin = 0.05; // rough ~3 deg buffer
        if (angleDiff > 0) {
            maxNeg = Math.min(maxNeg, Math.max(0, angleDiff - margin));
        } else {
            maxPos = Math.min(maxPos, Math.max(0, -angleDiff - margin));
        }

        return { maxPos, maxNeg };
    }

    // ── Virtual collision counter at a given rotation angle ────────────────
    // Projects every descendant sample to where it WOULD be at totalAngle
    // and counts how many land inside external branches.
    // Also checks the REVERSE: external samples inside descendant paths
    // (to detect crossings from both directions).
    // Does NOT mutate any geometry.
    _countCollisionsAtAngle(descendants, allBranches, totalAngle, pivot) {
        const cos = Math.cos(totalAngle);
        const sin = Math.sin(totalAngle);
        const cx = pivot.x, cy = pivot.y;
        const descSet = new Set(descendants);
        let hits = 0;

        for (const bd of descendants) {
            if (!bd.path?.samples) continue;
            const s = bd.path.samples;
            // Check EVERY descendant sample inside external branches (dense for crossing detection)
            for (let k = 4; k < s.length; k++) {
                const pt = s[k];
                if (!pt) continue;
                const dx = pt.x - cx, dy = pt.y - cy;
                const rx = cx + dx * cos - dy * sin;
                const ry = cy + dx * sin + dy * cos;
                for (const b2 of allBranches) {
                    if (descSet.has(b2) || !b2.path2d) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (ctx.isPointInPath(b2.path2d, rx, ry)) { hits++; break; }
                }
            }
            // Also check EXTERNAL samples inside descendant's rotated polygon
            // (catches crossings where the external branch enters the descendant)
            if (bd.path2d) {
                for (const b2 of allBranches) {
                    if (descSet.has(b2) || !b2.path?.samples) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    const s2 = b2.path.samples;
                    for (let k = 4; k < s2.length; k += 2) {
                        if (!s2[k]) continue;
                        // Inverse-rotate external point to test against descendant's original path
                        const dx2 = s2[k].x - cx, dy2 = s2[k].y - cy;
                        const irx = cx + dx2 * cos + dy2 * sin;
                        const iry = cy - dx2 * sin + dy2 * cos;
                        if (ctx.isPointInPath(bd.path2d, irx, iry)) { hits++; break; }
                    }
                }
            }
            if (bd.isLeaf && bd.leafData) {
                const sz = bd.leafData.size;
                const ang = bd.leafData.angle;
                const lps = [
                    { x: bd.leafData.x, y: bd.leafData.y },
                    { x: bd.leafData.x + (sz / 3) * Math.sin(ang), y: bd.leafData.y - (sz / 3) * Math.cos(ang) }
                ];
                for (const pt of lps) {
                    const dx = pt.x - cx, dy = pt.y - cy;
                    const rx = cx + dx * cos - dy * sin;
                    const ry = cy + dx * sin + dy * cos;
                    let ptHits = 0;
                    for (const b2 of allBranches) {
                        if (descSet.has(b2) || !b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (ctx.isPointInPath(b2.path2d, rx, ry)) { ptHits++; break; }
                    }
                    hits += ptHits * 5;
                }
            }
        }
        return hits;
    }

    // Scan the full ±maxAngle range in 5° steps and return the angle+direction
    // that results in the fewest total overlapping samples.
    _findLeastCollisionAngle(descendants, allBranches, pivot, maxPos, maxNeg) {
        const step = deg2rad(5);
        let bestHits = Infinity, bestAngle = 0, bestDir = 1;

        for (let a = 0; a <= maxPos + 0.001; a += step) {
            const hits = this._countCollisionsAtAngle(
                descendants, allBranches, a, pivot
            );
            if (hits < bestHits) { bestHits = hits; bestAngle = a; bestDir = 1; }
        }
        for (let a = step; a <= maxNeg + 0.001; a += step) {
            const hits = this._countCollisionsAtAngle(
                descendants, allBranches, -a, pivot
            );
            if (hits < bestHits) { bestHits = hits; bestAngle = a; bestDir = -1; }
        }
        return { angle: bestAngle, dir: bestDir, hits: bestHits };
    }

    // ── Leaf Sliding Logic ─────────────────────────────────────────────
    _countCollisionsAtTranslation(descendants, allBranches, dx, dy) {
        const descSet = new Set(descendants);
        let hits = 0;
        for (const bd of descendants) {
            if (!bd.path?.samples) continue;
            const s = bd.path.samples;
            for (let k = 4; k < s.length; k += 3) {
                const pt = s[k];
                if (!pt) continue;
                const rx = pt.x + dx;
                const ry = pt.y + dy;
                for (const b2 of allBranches) {
                    if (descSet.has(b2) || !b2.path2d) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (ctx.isPointInPath(b2.path2d, rx, ry)) { hits++; break; }
                }
            }
            if (bd.isLeaf && bd.leafData) {
                const sz = bd.leafData.size;
                const ang = bd.leafData.angle;
                const lps = [
                    { x: bd.leafData.x + dx, y: bd.leafData.y + dy },
                    { x: bd.leafData.x + dx + (sz / 3) * Math.sin(ang), y: bd.leafData.y + dy - (sz / 3) * Math.cos(ang) }
                ];
                for (const pt of lps) {
                    let ptHits = 0;
                    for (const b2 of allBranches) {
                        if (descSet.has(b2) || !b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (ctx.isPointInPath(b2.path2d, pt.x, pt.y)) { ptHits++; break; }
                    }
                    hits += ptHits * 5;
                }
            }
        }
        return hits;
    }

    _findLeastCollisionSlide(b1, parent, allBranches, state) {
        // Find if this leaf is the "Tip" child (index 0 implies tip usually)
        let isTipChild = false;

        // Let's actually find the real tree node for parent and check if b1 is the first child
        if (state && state.tree) {
            let pNode = null, bNode = null;
            const walk = n => {
                if (n.id === parent.nodeId) pNode = n;
                if (n.id === b1.nodeId) bNode = n;
                (n.children || []).forEach(walk);
            };
            walk(state.tree);
            // In tree logic, the FIRST child is usually the tip continuation (unless lateral random)
            // But fundamentally, if b1's root sample is near parent.tip, it's a tip branch
            if (pNode && pNode.children && pNode.children.indexOf(bNode) === 0) {
                isTipChild = true;
            }
        }

        const pivot = b1.path.samples[0];
        const distToParentTip = Math.hypot(pivot.x - parent.path.tipX, pivot.y - parent.path.tipY);
        if (distToParentTip < 8) isTipChild = true; // Also geometric check

        if (isTipChild) return { hits: Infinity };

        if (!parent.path || !parent.path.left || !parent.path.right) return { hits: Infinity };

        let dLeft = Infinity, idxLeft = 0;
        let dRight = Infinity, idxRight = 0;

        parent.path.left.forEach((p, i) => {
            const d = Math.hypot(p.x - pivot.x, p.y - pivot.y);
            if (d < dLeft) { dLeft = d; idxLeft = i; }
        });
        parent.path.right.forEach((p, i) => {
            const d = Math.hypot(p.x - pivot.x, p.y - pivot.y);
            if (d < dRight) { dRight = d; idxRight = i; }
        });

        const isLeft = dLeft < dRight;
        const arr = isLeft ? parent.path.left : parent.path.right;
        const startIdx = isLeft ? idxLeft : idxRight;

        let bestHits = Infinity;
        let bestTargetIdx = startIdx;
        let maxSlideSteps = 25;

        // Slide DOWN the branch (toward base)
        for (let i = startIdx - 1; i >= Math.max(0, startIdx - maxSlideSteps); i--) {
            const pt = arr[i];
            const dx = pt.x - pivot.x;
            const dy = pt.y - pivot.y;
            const hits = this._countCollisionsAtTranslation([b1], allBranches, dx, dy);
            if (hits < bestHits) { bestHits = hits; bestTargetIdx = i; }
            if (bestHits === 0 && Math.abs(i - startIdx) > 2) break;
        }

        // Slide UP the branch (toward tip)
        for (let i = startIdx + 1; i <= Math.min(arr.length - 1, startIdx + maxSlideSteps); i++) {
            const pt = arr[i];
            const dx = pt.x - pivot.x;
            const dy = pt.y - pivot.y;
            const hits = this._countCollisionsAtTranslation([b1], allBranches, dx, dy);
            if (hits < bestHits) { bestHits = hits; bestTargetIdx = i; }
            if (bestHits === 0 && Math.abs(i - startIdx) > 2) break;
        }

        const outPt = arr[bestTargetIdx];

        return {
            hits: bestHits,
            dx: outPt.x - pivot.x,
            dy: outPt.y - pivot.y,
            targetIdx: bestTargetIdx,
            targetArr: arr,
            startIdx: startIdx
        };
    }

    // No longer called — logic inlined in FLYING→FIXING arrival block above.
    _exhaustCurrentDir() { }


    // 
    // Public life-cycle
    // 
    start(state) {
        this.active = true;
        this.x = canvas.width / window.devicePixelRatio / 2;
        this.y = 100;
        this.state = "SCANNING";
        this.target = null;
        this.triedBothDirs = false;
        this.exhaustedNodes.clear();
        this.madeProgress = false;
        this._buildParentMap(state.tree);
        for (const b of state.allBranches) b.isHighlightWhite = false;
    }

    stop(state) {
        this.active = false;
        this.exhaustedNodes.clear();
        for (const b of state.allBranches) { if (b) b.isHighlightWhite = false; }
        this.target = null;
    }

    //  Main update (called every animation frame) 
    update(state) {
        if (!this.active) return false;

        // ── SCANNING ─────────────────────────────────────────────────────────
        if (this.state === "SCANNING") {
            for (const b of state.allBranches) b.isHighlightWhite = false;

            let best = this._findBestTarget(state);
            if (!best && this.exhaustedNodes.size > 0 && this.madeProgress) {
                // All non-exhausted branches are clear but we made progress.
                // Do a new pass over exhausted ones in case space opened up!
                this.exhaustedNodes.clear();
                this.madeProgress = false; // Reset for this pass
                best = this._findBestTarget(state);
            }
            if (best) {
                this.target = best;
                this.state = "FLYING";
                this.triedBothDirs = false;
                best.b1.isHighlightWhite = true;
                this.currentRule = `Selecting branch ${this.target.b1.nodeId} (${this.target.score} hits). Flying to it...`;
            } else {
                this.state = "IDLE";
                this.active = false;
                this.currentRule = "No collisions left to fix! Agent entering scan sleep.";
            }

            //  FLYING: glide toward the pivot of the worst branch 
        } else if (this.state === "FLYING") {
            const dx = this.target.targetX - this.x;
            const dy = this.target.targetY - this.y;
            const dist = Math.hypot(dx, dy);
            this.pupilAngle = Math.atan2(dy, dx);

            if (dist < 8) {
                // ─── ARRIVED ──────────────────────────────────────────────────────
                this.currentFixAngle = 0;
                this.descendants = this._buildDescendants(this.target.b1, state);

                const pivot = this.target.b1.path.samples[0];
                const maxA = deg2rad(90);
                const { maxPos, maxNeg } = this._calcLimitsToParent(this.target.b1, state, maxA);

                let parent = null;
                const pId = this._parentMap.get(this.target.b1.nodeId);
                if (pId != null) parent = state.allBranches.find(pb => pb.nodeId === pId);

                let bestSlide = null;
                if (this.target.b1.isLeaf && parent) {
                    bestSlide = this._findLeastCollisionSlide(this.target.b1, parent, state.allBranches, state);
                }

                // Find the globally optimal angle BEFORE we start
                const bestRot = this._findLeastCollisionAngle(
                    this.descendants, state.allBranches, pivot, maxPos, maxNeg
                );

                let choseSlide = false;
                if (bestSlide && bestSlide.hits < Infinity) {
                    if (bestSlide.hits === 0 && bestSlide.targetIdx !== bestSlide.startIdx) {
                        choseSlide = true;
                    } else if (bestSlide.hits < bestRot.hits && bestSlide.targetIdx !== bestSlide.startIdx) {
                        choseSlide = true;
                    }
                }

                if (choseSlide) {
                    this.slideData = {
                        targetArr: bestSlide.targetArr,
                        startIdx: bestSlide.startIdx,
                        targetIdx: bestSlide.targetIdx,
                        currentIdx: bestSlide.startIdx,
                        step: bestSlide.targetIdx < bestSlide.startIdx ? -1 : 1
                    };
                    this.state = "SLIDING";
                    this.currentRule = `Rule: Sliding leaf ${this.target.b1.nodeId} along parent edge to escape overlap.`;
                } else if (bestRot.hits === 0 && bestRot.angle === 0) {
                    // Seems clear at current angle. But if we escalated here,
                    // the child might collide with a SIBLING (both in descSet → invisible to _countCollisionsAtAngle).
                    if (this.target.escalatedFrom) {
                        const childBranch = state.allBranches.find(b => b.nodeId === this.target.escalatedFrom);
                        const childScore = childBranch ? this._scoreSelf(childBranch, state.allBranches) : { hits: 0 };
                        if (childScore.hits > 0) {
                            // Child still collides (sibling conflict) — escalate further
                            this.exhaustedNodes.add(this.target.b1.nodeId);
                            this.target.b1.isHighlightWhite = false;
                            let currentNodeId = this.target.b1.nodeId;
                            let ancestor = null;
                            while (true) {
                                const pId = this._parentMap.get(currentNodeId);
                                if (!pId) break;
                                const pb = state.allBranches.find(b => b.nodeId === pId && b.depth > 0);
                                if (!pb) break;
                                if (!this.exhaustedNodes.has(pId)) { ancestor = pb; break; }
                                currentNodeId = pId;
                            }
                            if (ancestor) {
                                this.currentRule = `Rule: ${this._label(this.target.b1)} ${this.target.b1.nodeId} clear externally but child ${this.target.escalatedFrom} still collides. Escalating to ${ancestor.nodeId}.`;
                                const allColls = this._collectSubtreeCollisions(ancestor, state);
                                let maxScore = 0;
                                for (const c of allColls) maxScore = Math.max(maxScore, c.hits);
                                this.target = {
                                    b1: ancestor,
                                    targetX: ancestor.path.samples[0].x,
                                    targetY: ancestor.path.samples[0].y,
                                    allCollisions: allColls,
                                    initialTotalHits: allColls.reduce((s, c) => s + c.hits, 0),
                                    score: maxScore,
                                    escalatedFrom: this.target.escalatedFrom
                                };
                                ancestor.isHighlightWhite = true;
                                this.state = "FLYING";
                            } else {
                                this.currentRule = `Rule: ${this._label(state.allBranches.find(b => b.nodeId === this.target.escalatedFrom))} ${this.target.escalatedFrom} stuck, no further ancestors. Skipping.`;
                                this.target.b1.isHighlightWhite = false;
                                this.state = "SCANNING";
                            }
                        } else {
                            // Child is actually clear now — done!
                            this.exhaustedNodes.add(this.target.b1.nodeId);
                            this.target.b1.isHighlightWhite = false;
                            this.state = "SCANNING";
                            this.currentRule = `Rule: Escalated to ${this.target.b1.nodeId} — child ${this.target.escalatedFrom} is now clear.`;
                        }
                    } else {
                        // Non-escalated branch, genuinely clear
                        this.exhaustedNodes.add(this.target.b1.nodeId);
                        this.target.b1.isHighlightWhite = false;
                        this.state = "SCANNING";
                        this.currentRule = `Rule: ${this._label(this.target.b1)} ${this.target.b1.nodeId} has no collision on its own body. Skipping.`;
                    }
                } else if (bestRot.hits === 0) {
                    // Perfectly clear at bestRot.angle — animate there
                    this.fixDir = bestRot.dir;
                    this.bestEffortAngle = bestRot.angle;
                    this.state = "FIXING";
                    this.currentRule = this.target.escalatedFrom
                        ? `Rule: Rotating ${this._label(this.target.b1)} ${this.target.b1.nodeId} to clear child ${this.target.escalatedFrom}.`
                        : `Rule: ${this._label(this.target.b1)} ${this.target.b1.nodeId} body collides. Found a perfectly clear rotation angle.`;
                } else {
                    // No 0-collision angle. Try TRUE MIRROR FLIP before escalating.
                    let flipped = false;
                    const flipPivot = pivot;
                    const pId = this._parentMap.get(this.target.b1.nodeId);
                    const parentBr = pId ? state.allBranches.find(b => b.nodeId === pId) : null;
                    if (parentBr && parentBr.path?.samples?.length > 1) {
                        // Find parent tangent at attachment point
                        let closestIdx = 0, closestDist = Infinity;
                        for (let i = 0; i < parentBr.path.samples.length; i++) {
                            const ps = parentBr.path.samples[i];
                            if (!ps) continue;
                            const d = Math.hypot(ps.x - flipPivot.x, ps.y - flipPivot.y);
                            if (d < closestDist) { closestDist = d; closestIdx = i; }
                        }
                        const ps1 = parentBr.path.samples[closestIdx];
                        const nextIdx = Math.min(closestIdx + 3, parentBr.path.samples.length - 1);
                        const ps2 = parentBr.path.samples[nextIdx];
                        if (ps1 && ps2 && (ps1.x !== ps2.x || ps1.y !== ps2.y)) {
                            const ax = ps2.x - ps1.x, ay = ps2.y - ps1.y;
                            const alen = Math.hypot(ax, ay);
                            const nx = ax / alen, ny = ay / alen; // unit axis direction
                            const axisAngle = Math.atan2(ny, nx);

                            // Reflection formula: reflect point across line through pivot with direction (nx,ny)
                            const reflectPt = (p) => {
                                const dx = p.x - flipPivot.x, dy = p.y - flipPivot.y;
                                const dot = dx * nx + dy * ny;
                                p.x = flipPivot.x + 2 * dot * nx - dx;
                                p.y = flipPivot.y + 2 * dot * ny - dy;
                            };

                            // Save pre-flip geometry for revert
                            const preFlip = this.descendants.map(b => ({
                                left: b.path?.left?.map(p => ({ x: p.x, y: p.y })),
                                right: b.path?.right?.map(p => ({ x: p.x, y: p.y })),
                                samples: b.path?.samples?.map(p => p ? { x: p.x, y: p.y } : null),
                                tipX: b.path?.tipX, tipY: b.path?.tipY,
                                tipNormX: b.path?.tipNormX, tipNormY: b.path?.tipNormY,
                                tipTangentAngle: b.path?.tipTangentAngle,
                                leafData: b.leafData ? { ...b.leafData } : null,
                            }));

                            // Apply true mirror reflection
                            for (const bd of this.descendants) {
                                if (bd.path?.samples) for (const p of bd.path.samples) if (p) reflectPt(p);
                                if (bd.path?.left) for (const p of bd.path.left) reflectPt(p);
                                if (bd.path?.right) for (const p of bd.path.right) reflectPt(p);
                                if (bd.path) {
                                    const tip = { x: bd.path.tipX, y: bd.path.tipY };
                                    reflectPt(tip);
                                    bd.path.tipX = tip.x; bd.path.tipY = tip.y;
                                    // Reflect tip normal
                                    const tn = { x: flipPivot.x + bd.path.tipNormX, y: flipPivot.y + bd.path.tipNormY };
                                    reflectPt(tn);
                                    bd.path.tipNormX = tn.x - flipPivot.x; bd.path.tipNormY = tn.y - flipPivot.y;
                                    bd.path.tipTangentAngle = 2 * axisAngle - bd.path.tipTangentAngle;
                                    // SWAP left/right edges — reflection reverses winding order
                                    const tmpEdge = bd.path.left;
                                    bd.path.left = bd.path.right;
                                    bd.path.right = tmpEdge;
                                }
                                if (bd.leafData) {
                                    const lp = { x: bd.leafData.x, y: bd.leafData.y };
                                    reflectPt(lp);
                                    bd.leafData.x = lp.x; bd.leafData.y = lp.y;
                                    // Reflect angle + PI to keep leaf right-side up
                                    // (the leaf bezier draws tip at negative-Y, so reflection
                                    //  reverses the sense — adding PI compensates)
                                    bd.leafData.angle = 2 * axisAngle - bd.leafData.angle + Math.PI;
                                }
                                rebuildPath2d(bd);
                            }

                            // Check if flip gives 0 collisions for EVERYTHING
                            // (not just the flipped subtree — flip must not hurt children/neighbours)
                            const flipRot = this._findLeastCollisionAngle(
                                this.descendants, state.allBranches, pivot, maxPos, maxNeg
                            );
                            // Also verify no NEW collisions appear on any branch in the tree
                            let flipCausesNewCollisions = false;
                            if (flipRot.hits === 0) {
                                for (const b of state.allBranches) {
                                    if (this.descendants.includes(b)) continue; // already checked
                                    const sc = this._scoreSelf(b, state.allBranches);
                                    if (sc.hits > 0) {
                                        // Check if this collision existed BEFORE the flip
                                        // by seeing if any of b's partners are in the flipped set
                                        for (const bd of this.descendants) {
                                            if (bd === b || !bd.path2d) continue;
                                            if (this._areAdjacent(b, bd)) continue;
                                            const s = b.path?.samples;
                                            if (s) {
                                                for (let k = 4; k < s.length; k += 3) {
                                                    if (s[k] && ctx.isPointInPath(bd.path2d, s[k].x, s[k].y)) {
                                                        flipCausesNewCollisions = true;
                                                        break;
                                                    }
                                                }
                                            }
                                            if (flipCausesNewCollisions) break;
                                        }
                                    }
                                    if (flipCausesNewCollisions) break;
                                }
                            }
                            if (flipRot.hits === 0 && !flipCausesNewCollisions) {
                                flipped = true;
                                this.fixDir = flipRot.dir;
                                this.bestEffortAngle = flipRot.angle;
                                this.state = "FIXING";
                                this.currentRule = `Rule: Flipped ${this._label(this.target.b1)} ${this.target.b1.nodeId} across parent axis. Found clear angle.`;
                            } else {
                                // Revert mirror
                                for (let i = 0; i < this.descendants.length; i++) {
                                    const bd = this.descendants[i];
                                    const pre = preFlip[i];
                                    if (bd.path && pre.left && pre.right) {
                                        bd.path.left = pre.left.map(p => ({ x: p.x, y: p.y }));
                                        bd.path.right = pre.right.map(p => ({ x: p.x, y: p.y }));
                                    }
                                    if (bd.path?.samples && pre.samples) {
                                        for (let j = 0; j < pre.samples.length; j++) {
                                            if (pre.samples[j] && bd.path.samples[j]) {
                                                bd.path.samples[j].x = pre.samples[j].x;
                                                bd.path.samples[j].y = pre.samples[j].y;
                                            }
                                        }
                                    }
                                    if (bd.path) {
                                        bd.path.tipX = pre.tipX; bd.path.tipY = pre.tipY;
                                        bd.path.tipNormX = pre.tipNormX; bd.path.tipNormY = pre.tipNormY;
                                        bd.path.tipTangentAngle = pre.tipTangentAngle;
                                    }
                                    if (bd.leafData && pre.leafData) Object.assign(bd.leafData, pre.leafData);
                                    rebuildPath2d(bd);
                                }
                            }
                        }
                    }

                    if (!flipped) {
                        // Flip didn't work — check if escalation is useful before escalating.
                        // If ALL collision partners of the original child are also descendants
                        // of the proposed ancestor, escalating won't help (they all move together).
                        this.exhaustedNodes.add(this.target.b1.nodeId);
                        this.target.b1.isHighlightWhite = false;

                        // Find the child whose collisions we're trying to resolve
                        const origId = this.target.escalatedFrom || this.target.b1.nodeId;
                        const origBranch = state.allBranches.find(b => b.nodeId === origId);

                        let currentNodeId = this.target.b1.nodeId;
                        let ancestor = null;
                        let escalationPath = [currentNodeId];
                        while (true) {
                            const pId2 = this._parentMap.get(currentNodeId);
                            if (!pId2) break;
                            const parentBranch = state.allBranches.find(b => b.nodeId === pId2 && b.depth > 0);
                            if (!parentBranch) break;
                            escalationPath.push(pId2);
                            if (this.exhaustedNodes.has(pId2)) { currentNodeId = pId2; continue; }

                            // Check: would ALL collision partners of the original child
                            // be descendants of this ancestor? If so, skip it.
                            const ancDescs = new Set(this._buildDescendants(parentBranch, state).map(b => b.nodeId));
                            let allPartnersInside = true;
                            if (origBranch) {
                                // Check each branch that origBranch collides with — DENSE sampling
                                for (const b2 of state.allBranches) {
                                    if (b2 === origBranch || !b2.path2d) continue;
                                    if (this._areAdjacent(origBranch, b2)) continue;
                                    // Dense check: does origBranch overlap b2?
                                    let overlaps = false;
                                    const s = origBranch.path?.samples;
                                    if (s) {
                                        for (let k = 4; k < s.length; k++) {
                                            if (s[k] && ctx.isPointInPath(b2.path2d, s[k].x, s[k].y)) { overlaps = true; break; }
                                        }
                                    }
                                    // Also check reverse: b2's samples inside origBranch
                                    if (!overlaps && origBranch.path2d) {
                                        const s2 = b2.path?.samples;
                                        if (s2) {
                                            for (let k = 4; k < s2.length; k++) {
                                                if (s2[k] && ctx.isPointInPath(origBranch.path2d, s2[k].x, s2[k].y)) { overlaps = true; break; }
                                            }
                                        }
                                    }
                                    if (overlaps && !ancDescs.has(b2.nodeId)) {
                                        allPartnersInside = false;
                                        break;
                                    }
                                }
                            }
                            if (allPartnersInside) {
                                // All collision partners are siblings within this ancestor's subtree.
                                // Escalating here won't help — mark exhausted and try next.
                                this.exhaustedNodes.add(pId2);
                                currentNodeId = pId2;
                                continue;
                            }
                            ancestor = parentBranch;
                            break;
                        }

                        if (ancestor) {
                            const levelJump = escalationPath.length - 1;
                            this.currentRule = `Rule: No 0-collision angle (flip failed too) for ${this._label(this.target.b1)} ${this.target.b1.nodeId}. Escalating ${levelJump} level${levelJump > 1 ? 's' : ''} up to ${ancestor.nodeId}.`;
                            const allColls = this._collectSubtreeCollisions(ancestor, state);
                            let maxScore = 0;
                            for (const c of allColls) maxScore = Math.max(maxScore, c.hits);
                            this.target = {
                                b1: ancestor,
                                targetX: ancestor.path.samples[0].x,
                                targetY: ancestor.path.samples[0].y,
                                allCollisions: allColls,
                                initialTotalHits: allColls.reduce((s, c) => s + c.hits, 0),
                                score: maxScore,
                                escalatedFrom: this.target.escalatedFrom || this.target.b1.nodeId
                            };
                            ancestor.isHighlightWhite = true;
                            this.state = "FLYING";
                        } else {
                            this.currentRule = `Rule: ${this._label(origBranch)} ${origId} stuck — all collision partners are children of the selected ancestor. Skipping.`;
                            this.target.b1.isHighlightWhite = false;
                            this.state = "SCANNING";
                        }
                    }
                }
            } else {
                const speed = Math.min(dist * 0.06, 4);
                this.x += (dx / dist) * speed;
                this.y += (dy / dist) * speed;
            }

            // ── FIXING: animate 0.25°/frame toward the pre-computed best angle ───
            // Single-pass, no safety guard (the best angle was chosen globally to
            // minimise total hits, which naturally accounts for any new contacts).
        } else if (this.state === "FIXING") {
            const b = this.target.b1;
            const pivot = b.path.samples[0];
            const step = deg2rad(0.25);

            this._rotateBranchTree(this.descendants, step * this.fixDir, pivot);
            this.currentFixAngle += step;
            this._refreshOverlap(state);

            // STOP EARLY if the branch hit 0 collisions globally, OR if we reached the max best angle
            if (this.target.allCollisions.length === 0 || this.currentFixAngle >= this.bestEffortAngle - step / 2) {
                this.madeProgress = true; // We successfully committed a rotation
                // ── Arrived at best angle (or cleared early) ───
                const fresh = this.target.allCollisions;

                if (fresh.length === 0) {
                    // Truly clear
                    this.target.b1.isHighlightWhite = false;
                    this.state = "SCANNING";
                } else {
                    // Still colliding at the best achievable angle
                    // Best we can do with rotation — move on
                    this.exhaustedNodes.add(b.nodeId);
                    this.state = "SCANNING";
                }
            }

            // ── SLIDING: Move the leaf along the branch edge ────────────────────
        } else if (this.state === "SLIDING") {
            const arr = this.slideData.targetArr;
            const maxIdx = arr.length - 1;

            // Previous position on the edge
            const prevIdx = Math.max(0, Math.min(maxIdx, Math.floor(this.slideData.currentIdx)));
            const prevPt = arr[prevIdx];

            // Advance along the edge curve
            this.slideData.currentIdx += this.slideData.step * 0.5;
            this.slideData.currentIdx = Math.max(0, Math.min(maxIdx, this.slideData.currentIdx));

            // Reached target?
            let reached = false;
            if (this.slideData.step < 0 && this.slideData.currentIdx <= this.slideData.targetIdx) reached = true;
            if (this.slideData.step > 0 && this.slideData.currentIdx >= this.slideData.targetIdx) reached = true;

            const nextIdx = Math.max(0, Math.min(maxIdx, Math.floor(this.slideData.currentIdx)));
            const currPt = arr[nextIdx];
            const dx = currPt.x - prevPt.x;
            const dy = currPt.y - prevPt.y;

            if (dx !== 0 || dy !== 0) {
                this._translateBranchTree(this.descendants, dx, dy);
            }
            this._refreshOverlap(state);

            if (this.target.allCollisions.length === 0 || reached) {
                this.madeProgress = true;
                if (this.target.allCollisions.length === 0) {
                    this.target.b1.isHighlightWhite = false;
                    this.state = "SCANNING";
                } else {
                    this.exhaustedNodes.add(this.target.b1.nodeId);
                    this.state = "SCANNING";
                }
            }
        }

        return true;
    }

    // 
    // Geometry operations on a branch list
    // 
    _translateBranchTree(branches, dx, dy) {
        for (const b of branches) {
            if (!b.path) continue;
            if (b.path.samples) for (const p of b.path.samples) { p.x += dx; p.y += dy; }
            if (b.path.left) for (const p of b.path.left) { p.x += dx; p.y += dy; }
            if (b.path.right) for (const p of b.path.right) { p.x += dx; p.y += dy; }

            b.path.tipX += dx;
            b.path.tipY += dy;

            if (b.isLeaf && b.leafData) {
                b.leafData.x += dx;
                b.leafData.y += dy;
            }

            rebuildPath2d(b);
        }
    }

    _rotateBranchTree(branches, angle, pivot) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const cx = pivot.x, cy = pivot.y;

        for (const b of branches) {
            if (!b.path) continue;
            if (b.path.samples) for (const p of b.path.samples) rotatePoint(p, cx, cy, cos, sin);
            if (b.path.left) for (const p of b.path.left) rotatePoint(p, cx, cy, cos, sin);
            if (b.path.right) for (const p of b.path.right) rotatePoint(p, cx, cy, cos, sin);

            const tip = { x: b.path.tipX, y: b.path.tipY };
            rotatePoint(tip, cx, cy, cos, sin);
            b.path.tipX = tip.x; b.path.tipY = tip.y;

            const tN = { x: cx + b.path.tipNormX, y: cy + b.path.tipNormY };
            rotatePoint(tN, cx, cy, cos, sin);
            b.path.tipNormX = tN.x - cx; b.path.tipNormY = tN.y - cy;
            b.path.tipTangentAngle += angle;

            if (b.isLeaf && b.leafData) {
                const lp = { x: b.leafData.x, y: b.leafData.y };
                rotatePoint(lp, cx, cy, cos, sin);
                b.leafData.x = lp.x; b.leafData.y = lp.y;
                b.leafData.angle += angle;
            }

            rebuildPath2d(b);
        }
    }

    _scaleBranchTree(branches, factor, pivot) {
        const ox = pivot.x, oy = pivot.y;

        for (const b of branches) {
            if (!b.path) continue;
            if (b.path.samples) for (const p of b.path.samples) scalePoint(p, ox, oy, factor);
            if (b.path.left) for (const p of b.path.left) scalePoint(p, ox, oy, factor);
            if (b.path.right) for (const p of b.path.right) scalePoint(p, ox, oy, factor);

            b.path.tipX = ox + (b.path.tipX - ox) * factor;
            b.path.tipY = oy + (b.path.tipY - oy) * factor;
            // tipNorm is a unit direction vector  does not scale
            b.path.tipTangentAngle; // unchanged by scaling

            if (b.isLeaf && b.leafData) {
                b.leafData.x = ox + (b.leafData.x - ox) * factor;
                b.leafData.y = oy + (b.leafData.y - oy) * factor;
            }

            rebuildPath2d(b);
        }
    }

    // 
    // Drawing
    // 
    draw(ctx) {
        if (!this.active) return;

        // ── Visualise the Area being Probed ──────────────────────────────────
        if (this.state === 'FIXING' && this.probeData) {
            ctx.save();
            ctx.translate(this.probeData.x, this.probeData.y);
            const { baseAn, bestA, dir, radius } = this.probeData;

            ctx.lineCap = "round";

            if (bestA > deg2rad(2)) {
                // Flow mark mapping the area it will rotate to
                ctx.beginPath();
                ctx.arc(0, 0, radius, dir > 0 ? baseAn : baseAn - bestA, dir > 0 ? baseAn + bestA : baseAn, false);
                ctx.strokeStyle = "rgba(76, 175, 80, 0.7)";
                ctx.lineWidth = 3;
                ctx.setLineDash([7, 7]);
                ctx.stroke();
                ctx.setLineDash([]);

                // Arrow head at destination
                ctx.beginPath();
                const endAngle = dir > 0 ? baseAn + bestA : baseAn - bestA;
                ctx.translate(radius * Math.cos(endAngle), radius * Math.sin(endAngle));
                ctx.rotate(endAngle + (dir > 0 ? Math.PI / 2 : -Math.PI / 2));
                ctx.moveTo(0, 0);
                ctx.lineTo(-7, -9);
                ctx.lineTo(7, -9);
                ctx.closePath();
                ctx.fillStyle = "rgba(76, 175, 80, 0.9)";
                ctx.fill();
            }

            ctx.restore();
        }

        // ── All red overlap zones (one polygon per collision pair) ────────────
        if (this.target?.allCollisions?.length) {
            for (const coll of this.target.allCollisions) {
                const { overlapBranch, overlapMinIdx, overlapMaxIdx, isLeafBody } = coll;
                if (!overlapBranch?.path?.left) continue;
                if (overlapMinIdx < 0 || overlapMaxIdx < overlapMinIdx) continue;

                const L = overlapBranch.path.left;
                const R = overlapBranch.path.right;
                const maxI = Math.min(overlapMaxIdx, Math.min(L.length, R.length) - 1);
                const minI = Math.max(4, overlapMinIdx);

                if (isLeafBody && overlapBranch.isLeaf && overlapBranch.leafData) {
                    const leaf = overlapBranch.leafData;
                    ctx.save();
                    ctx.translate(leaf.x, leaf.y);
                    ctx.rotate(leaf.angle);
                    const sz = leaf.size / 18;
                    ctx.scale(sz, sz);
                    ctx.translate(0, 9);
                    ctx.beginPath();
                    ctx.moveTo(0, -18);
                    ctx.bezierCurveTo(3.25, -11.7, 4.55, -7.2, 3.9, -5.4);
                    ctx.bezierCurveTo(3.25, -3.15, 1.3, -1.35, 0, 0);
                    ctx.bezierCurveTo(-1.3, -1.35, -3.25, -3.15, -3.9, -5.4);
                    ctx.bezierCurveTo(-4.55, -7.2, -3.25, -11.7, 0, -18);
                    ctx.closePath();
                    ctx.fillStyle = "rgba(255, 50, 10, 0.60)";
                    ctx.fill();
                    ctx.strokeStyle = "rgba(255, 160, 30, 1.0)";
                    ctx.lineWidth = 1.5 / sz;
                    ctx.filter = "drop-shadow(0 0 3px #ff3010)";
                    ctx.stroke();
                    ctx.restore();
                }

                if (maxI < minI) continue;

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(L[minI].x, L[minI].y);
                for (let i = minI + 1; i <= maxI; i++) ctx.lineTo(L[i].x, L[i].y);
                for (let i = maxI; i >= minI; i--)     ctx.lineTo(R[i].x, R[i].y);
                ctx.closePath();
                ctx.fillStyle = "rgba(255, 50, 10, 0.60)";
                ctx.fill();
                ctx.strokeStyle = "rgba(255, 160, 30, 1.0)";
                ctx.lineWidth = 1.5;
                ctx.filter = "drop-shadow(0 0 3px #ff3010)";
                ctx.stroke();
                ctx.filter = "none";
                ctx.restore();
            }
        }

        // ── Collision % label above the eyeball ────────────────────────────
        if (this.target && this.state === 'FIXING') {
            const initHits = this.target.initialTotalHits || 0;
            const curHits = (this.target.allCollisions || [])
                .reduce((s, c) => s + (c.hits || 0), 0);
            const pct = initHits > 0 ? Math.round(curHits / initHits * 100) : 0;
            const label = pct === 0 ? '✓ Clear!' : `${pct}%`;
            const r = Math.min(255, Math.round(pct * 2.55));
            const g = Math.min(255, Math.round((100 - pct) * 2.55));

            ctx.save();
            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            // Drop shadow for readability
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillText(label, this.x + 1, this.y - 21);
            ctx.fillStyle = `rgb(${r},${g},30)`;
            ctx.fillText(label, this.x, this.y - 22);
            ctx.restore();
        }

        //  Agent eyeball 
        ctx.save();
        ctx.translate(this.x, this.y);

        // Glow halo
        const grd = ctx.createRadialGradient(0, 0, 5, 0, 0, 18);
        grd.addColorStop(0, "rgba(76,175,80,0)");
        grd.addColorStop(1, "rgba(76,175,80,0.4)");
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#4CAF50";
        ctx.stroke();

        // Iris
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fillStyle = "#E0F7FA";
        ctx.fill();

        // Pupil (looks toward current target base)
        ctx.save();
        ctx.rotate(this.pupilAngle);
        ctx.beginPath();
        ctx.arc(4, 0, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#000000";
        ctx.fill();
        ctx.restore();

        ctx.restore();
    }

    // Keep old name for compatibility (app.js calls agent.start / stop / update / draw)
    rotateBranchTree(branches, angle, pivot) {
        this._rotateBranchTree(branches, angle, pivot);
    }
}