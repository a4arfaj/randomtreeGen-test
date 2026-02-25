/**
 * AGENT
 * - Finds collisions, prioritises the subtree with the MOST collisions.
 * - Calculates the correct rotation direction geometrically (no randomness).
 * - Never commits a rotation step that would CREATE a new collision.
 * - Falls back to elongation if rotation is impossible and branch is short.
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
    b.path2d = p2d;
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
        this.priorContacts = null;
        // Best-effort mode: animate toward the least-collision angle
        this.fixingMode = 'clean';  // 'clean' | 'best-effort'
        this.bestEffortAngle = 0;
        // Branches we've done our best on; skip until next full clear
        this.exhaustedNodes = new Set();
        // For the % label
        this.initialTotalHits = 0;
        this.madeProgress = false;

        this._parentMap = new Map();
    }

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
            }
        }
        return contacts;
    }

    // ── Score a single branch by its OWN geometry's overlaps ─────────────────
    // Only checks b1.path.samples against external branches (no subtree walk).
    // Returns { hits, collidingBranch, overlapMinIdx, overlapMaxIdx }
    _scoreSelf(b1, allBranches) {
        if (!b1.path?.samples) return { hits: 0 };
        const s = b1.path.samples;
        let totalHits = 0;
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
            if (hits > 0) {
                totalHits += hits;
                if (hits > worstHits) {
                    worstHits = hits;
                    collidingBranch = b2;
                    overlapMinIdx = minI;
                    overlapMaxIdx = maxI;
                }
            }
        }
        return { hits: totalHits, collidingBranch, overlapMinIdx, overlapMaxIdx };
    }

    // ── Find the branch to fix ──────────────────────────────────────────────
    //
    // Strategy (bottom-first level-by-level):
    //   1. Score every non-trunk branch by ITS OWN overlaps only.
    //      (A branch only counts its own geometry, not descendants'.)
    //   2. Collect all branches that actually collide (hits > 0).
    //   3. Sort by depth ASCENDING — shallowest first (trunk branches).
    //      Tiebreak by Y-coordinate descending (bottom-most first).
    //   4. If the winning branch is a leaf, escalate to its parent
    //      (because a leaf has no children and must be moved via its stem).
    //
    // This guarantees we fix structural foundations before leaf details.
    _findBestTarget(state) {
        const candidates = [];

        for (const b1 of state.allBranches) {
            if (b1.depth === 0) continue;
            if (!b1.path2d) continue;
            if (!b1.path?.samples?.length) continue;
            // Do NOT filter exhaustedNodes here — must check AFTER leaf escalation

            const r = this._scoreSelf(b1, state.allBranches);
            if (r.hits > 0) candidates.push({ b1, r });
        }

        if (candidates.length === 0) return null;

        // Shallowest branch first (parent → child); tiebreak by Y-coordinate of pivot (bottom-first)
        candidates.sort((a, b) => {
            if (a.b1.depth !== b.b1.depth) return a.b1.depth - b.b1.depth;
            const yA = a.b1.path?.samples?.[0]?.y || 0;
            const yB = b.b1.path?.samples?.[0]?.y || 0;
            return yB - yA;
        });

        // Iterate candidates; for each, escalate leaves to their parent pivot,
        // then skip if THAT pivot is already exhausted.
        // This fixes the flash-loop: previously we added pivotB1.nodeId to
        // exhaustedNodes but checked rawB1.nodeId (the leaf) — they differ!
        for (const { b1: rawB1, r } of candidates) {
            let pivotB1 = rawB1;
            if (rawB1.isLeaf) {
                const parentNodeId = this._parentMap.get(rawB1.nodeId);
                if (parentNodeId != null) {
                    const parent = state.allBranches.find(
                        b => b.nodeId === parentNodeId && b.depth > 0
                    );
                    if (parent) pivotB1 = parent;
                }
            }

            // Check exhaustion against the PIVOT (post-escalation), not the raw leaf
            if (this.exhaustedNodes.has(pivotB1.nodeId)) continue;

            const allCollisions = this._collectSubtreeCollisions(pivotB1, state);
            return {
                b1: pivotB1,
                collidingBranch: r.collidingBranch,
                overlapBranch: rawB1,
                overlapMinIdx: r.overlapMinIdx,
                overlapMaxIdx: r.overlapMaxIdx,
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
    // Returns Array<{overlapBranch, collidingBranch, overlapMinIdx, overlapMaxIdx, hits}>
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
                if (hits > 0) {
                    result.push({
                        overlapBranch: bd,
                        collidingBranch: b2,
                        overlapMinIdx: minI,
                        overlapMaxIdx: maxI,
                        hits,
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
        }
        return false;
    }

    // Returns the max clean rotation (radians) in each direction before a
    // new collision would be created.  Probes in 5° increments up to maxAngle.
    _probeAvailableSpace(descendants, allBranches, pivot, priorContacts, maxAngle) {
        const step = deg2rad(5);
        const spaceInDir = (dir) => {
            for (let a = step; a <= maxAngle + 0.001; a += step) {
                if (this._wouldCreateNewContacts(
                    descendants, allBranches, priorContacts, a * dir, pivot
                )) {
                    return Math.max(0, a - step);
                }
            }
            return maxAngle;
        };
        return { spacePos: spaceInDir(1), spaceNeg: spaceInDir(-1) };
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

    // ── Virtual collision counter at a given rotation angle ────────────────
    // Projects every descendant sample (every 3rd for speed) to where it WOULD
    // be at totalAngle and counts how many land inside external branches.
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
            for (let k = 4; k < s.length; k += 3) {
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
        }
        return hits;
    }

    // Scan the full ±maxAngle range in 5° steps and return the angle+direction
    // that results in the fewest total overlapping samples.
    _findLeastCollisionAngle(descendants, allBranches, pivot, maxAngle) {
        const step = deg2rad(5);
        let bestHits = Infinity, bestAngle = 0, bestDir = 1;

        for (const dir of [1, -1]) {
            for (let a = 0; a <= maxAngle + 0.001; a += step) {
                const hits = this._countCollisionsAtAngle(
                    descendants, allBranches, a * dir, pivot
                );
                if (hits < bestHits) {
                    bestHits = hits;
                    bestAngle = a;
                    bestDir = dir;
                }
            }
        }
        return { angle: bestAngle, dir: bestDir, hits: bestHits };
    }

    // No longer called — logic inlined in FLYING→FIXING arrival block above.
    _exhaustCurrentDir() { }


    // ── Try stretching the subtree from its base pivot ─────────────────────
    // Scale factor grows with how many descendants are still in collision:
    //   1 colliding  → ×1.35   2 → ×1.43   4 → ×1.59   6+ → ×1.65 (cap)
    _tryElongate(state) {
        const { b1 } = this.target;
        if (!b1.path?.samples) { this.state = "SCANNING"; return; }

        const pivot = b1.path.samples[0];

        // Crowd-proportional scale factor
        const crowdCount = new Set(
            (this.target.allCollisions || []).map(c => c.overlapBranch)
        ).size;
        const factor = Math.min(1.65, 1.35 + Math.max(0, crowdCount - 1) * 0.08);

        this._scaleBranchTree(this.descendants, factor, pivot);

        const newContacts = this._getExternalContacts(this.descendants, state.allBranches);
        const stillBad = this._subtreeStillCollides(state);
        let createdNew = false;
        for (const idx of newContacts) {
            if (!this.priorContacts?.has(idx)) { createdNew = true; break; }
        }

        if (!stillBad && !createdNew) {
            // Elongation resolved the collision — keep and move on
        } else {
            // Revert — no viable space even when longer
            this._scaleBranchTree(this.descendants, 1 / factor, pivot);
        }
        this.state = "SCANNING";
    }

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
        this.fixingMode = 'clean';
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
            } else {
                this.state = "IDLE";
                this.active = false;
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

                // Find the globally optimal angle BEFORE we start
                const best = this._findLeastCollisionAngle(
                    this.descendants, state.allBranches, pivot, maxA
                );

                if (best.hits === 0 && best.angle === 0) {
                    // Already clear (or mismatched hit fidelity) — handle gracefully
                    this.exhaustedNodes.add(this.target.b1.nodeId);
                    this.target.b1.isHighlightWhite = false;
                    this.state = "SCANNING";
                } else if (best.hits === 0) {
                    // Perfectly clear at best.angle — animate there (no safety guard needed)
                    this.fixDir = best.dir;
                    this.bestEffortAngle = best.angle;
                    this.state = "FIXING";
                } else {
                    // No angle eliminates all collisions — pick nearest
                    // Before committing to rotation, check if there's any space at all
                    const contacts = this._getExternalContacts(this.descendants, state.allBranches);
                    const { spacePos, spaceNeg } = this._probeAvailableSpace(
                        this.descendants, state.allBranches, pivot, contacts, maxA
                    );
                    const noSpace = spacePos < deg2rad(1) && spaceNeg < deg2rad(1);

                    if (noSpace || best.angle === 0) {
                        // Boxed in, OR staying put is already the global optimum.
                        // Rotation can't help — exhaust and move on
                        this.exhaustedNodes.add(this.target.b1.nodeId);
                        this.state = "SCANNING";
                    } else {
                        // Animate to least-collision angle
                        this.fixDir = best.dir;
                        this.bestEffortAngle = best.angle;
                        this.probeData = {
                            x: pivot.x,
                            y: pivot.y,
                            baseAn: Math.atan2(this.target.b1.path.tipY - pivot.y, this.target.b1.path.tipX - pivot.x),
                            maxA: maxA,
                            bestA: best.angle,
                            dir: best.dir,
                            radius: Math.max(80, this._branchLength(this.target.b1) * 0.8)
                        };
                        this.state = "FIXING";
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

            // ── ELONGATING: stretch the subtree ────────────────────────────────
        } else if (this.state === "ELONGATING") {
            this._tryElongate(state);
        }

        return true;
    }

    // 
    // Geometry operations on a branch list
    // 
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
            const { baseAn, maxA, bestA, dir, radius } = this.probeData;

            // 1) Full +/- 90 Degree Scanning Limit (Faint Blue)
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, baseAn - maxA, baseAn + maxA);
            ctx.closePath();
            ctx.fillStyle = "rgba(70, 130, 255, 0.08)";
            ctx.fill();

            // 2) Target Sector (Green) highlighting the angle it intends to move to
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, radius, dir > 0 ? baseAn : baseAn - bestA, dir > 0 ? baseAn + bestA : baseAn);
            ctx.closePath();
            ctx.fillStyle = "rgba(76, 175, 80, 0.18)";
            ctx.fill();

            ctx.restore();
        }

        // ── All red overlap zones (one polygon per collision pair) ────────────
        if (this.target?.allCollisions?.length) {
            for (const coll of this.target.allCollisions) {
                const { overlapBranch, overlapMinIdx, overlapMaxIdx } = coll;
                if (!overlapBranch?.path?.left) continue;
                if (overlapMinIdx < 0 || overlapMaxIdx < overlapMinIdx) continue;

                const L = overlapBranch.path.left;
                const R = overlapBranch.path.right;
                const maxI = Math.min(overlapMaxIdx, Math.min(L.length, R.length) - 1);
                const minI = Math.max(4, overlapMinIdx);

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
        if (this.target && (this.state === 'FIXING' || this.state === 'ELONGATING')) {
            const initHits = this.target.initialTotalHits || 0;
            const curHits = (this.target.allCollisions || [])
                .reduce((s, c) => s + (c.hits || 0), 0);
            const pct = initHits > 0 ? Math.round(curHits / initHits * 100) : 0;
            const label = pct === 0 ? '✓ Clear!' :
                (this.fixingMode === 'best-effort' ? `⬇ ${pct}%` : `${pct}%`);
            // Colour: green when 0, yellow→red as % stays high
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