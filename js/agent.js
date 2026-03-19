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

function transformLeafPoint(leaf, x, y) {
    const s = (leaf.size || 18) / 18;
    const ang = leaf.angle || 0;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const lx = x * s;
    const ly = (y + 9) * s;
    return {
        x: leaf.x + lx * c - ly * sn,
        y: leaf.y + lx * sn + ly * c,
    };
}

function appendLeafBodyPath(path, leaf) {
    const p0 = transformLeafPoint(leaf, 0, -18);
    const p1 = transformLeafPoint(leaf, 3.25, -11.7);
    const p2 = transformLeafPoint(leaf, 4.55, -7.2);
    const p3 = transformLeafPoint(leaf, 3.9, -5.4);
    const p4 = transformLeafPoint(leaf, 3.25, -3.15);
    const p5 = transformLeafPoint(leaf, 1.3, -1.35);
    const p6 = transformLeafPoint(leaf, 0, 0);
    const p7 = transformLeafPoint(leaf, -1.3, -1.35);
    const p8 = transformLeafPoint(leaf, -3.25, -3.15);
    const p9 = transformLeafPoint(leaf, -3.9, -5.4);
    const p10 = transformLeafPoint(leaf, -4.55, -7.2);
    const p11 = transformLeafPoint(leaf, -3.25, -11.7);

    path.moveTo(p0.x, p0.y);
    path.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    path.bezierCurveTo(p4.x, p4.y, p5.x, p5.y, p6.x, p6.y);
    path.bezierCurveTo(p7.x, p7.y, p8.x, p8.y, p9.x, p9.y);
    path.bezierCurveTo(p10.x, p10.y, p11.x, p11.y, p0.x, p0.y);
    path.closePath();
}

function getLeafProbePoints(leaf) {
    if (!leaf) return [];
    const probes = [
        [0, -18],   // tip
        [0, -12],   // upper body center
        [3.9, -5.4], // right shoulder
        [-3.9, -5.4], // left shoulder
        [2.2, -2.7], // right lower body
        [-2.2, -2.7], // left lower body
        [0, 0],     // base
    ];
    return probes.map(([x, y]) => transformLeafPoint(leaf, x, y));
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

    if (b.isLeaf && b.leafData) appendLeafBodyPath(p2d, b.leafData);

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
        this._escalationCheckCooldown = 0;
        this._cascadeNeeds = new Map();
        this.rebuildJob = null;
        this.rebuildRayPhase = 0;
        this.elongateJob = null;
        this.primaryNodeId = null;
        this._elongationFailedFor = new Set();

        this._parentMap = new Map();
    }

    /** Returns 'Leaf' or 'Branch' for a given branch object */
    _label(b) { return b && b.isLeaf ? 'Leaf' : 'Branch'; }

    _targetFocusPoint(t) {
        const b = t?.b1;
        if (!b) return { x: this.x, y: this.y };
        if (b.isLeaf && b.leafData) return { x: b.leafData.x, y: b.leafData.y };
        if (b.path?.samples?.length) {
            const s = b.path.samples;
            const mid = s[Math.max(0, Math.floor(s.length * 0.6))] || s[s.length - 1] || s[0];
            return { x: mid.x, y: mid.y };
        }
        return { x: t.targetX ?? this.x, y: t.targetY ?? this.y };
    }

    _targetPerchPoint(t) {
        const f = this._targetFocusPoint(t);
        let vx = this.x - f.x;
        let vy = this.y - f.y;
        let d = Math.hypot(vx, vy);
        if (d < 1e-6) {
            vx = 0;
            vy = -1;
            d = 1;
        }
        const standOff = 28;
        return { x: f.x + (vx / d) * standOff, y: f.y + (vy / d) * standOff, fx: f.x, fy: f.y };
    }

    _leafProbePointsFromBranch(b) {
        return b?.isLeaf && b?.leafData ? getLeafProbePoints(b.leafData) : [];
    }

    _hasAnyCollisions(state) {
        for (const b of state.allBranches || []) {
            if (!b || b.depth === 0 || !b.path2d || !b.path?.samples?.length) continue;
            if (this._scoreSelf(b, state.allBranches).hits > 0) return true;
        }
        return false;
    }

    _branchCanSelfResolve(branch, state) {
        if (!branch?.path?.samples?.length) return false;
        if (this._scoreSelf(branch, state.allBranches).hits === 0) return true;
        const descendants = this._buildDescendants(branch, state);
        const pivot = branch.path.samples[0];
        const maxA = deg2rad(90);
        const { maxPos, maxNeg } = this._calcLimitsToParent(branch, state, maxA);
        const bestRot = this._findLeastCollisionAngle(
            descendants, state.allBranches, pivot, maxPos, maxNeg
        );
        return bestRot.hits === 0;
    }

    _hasUnresolvedAncestor(branch, state) {
        if (!branch?.nodeId) return false;
        let parentId = this._parentMap.get(branch.nodeId);
        while (parentId != null) {
            const parent = state.allBranches.find((b) => b.nodeId === parentId);
            if (parent?.depth === 0) break;
            if (!parent?.path?.samples?.length) {
                parentId = this._parentMap.get(parentId);
                continue;
            }
            // Skip exhausted parents — they should not block children
            if (this.exhaustedNodes.has(parentId)) {
                parentId = this._parentMap.get(parentId);
                continue;
            }
            // Only block if the parent ITSELF has collisions (not its subtree).
            // _scoreSelf already excludes descendants, so this correctly detects
            // parent-vs-external collisions without the circular child-blocks-self issue.
            const parentSelfHits = this._scoreSelf(parent, state.allBranches).hits;
            if (parentSelfHits > 0) {
                return true;
            }
            parentId = this._parentMap.get(parentId);
        }
        return false;
    }

    _canSelectBranch(branch, state) {
        return !!branch?.path?.samples?.length && !this._hasUnresolvedAncestor(branch, state);
    }

    _promoteToSelectableAncestor(branch, state) {
        if (!branch?.nodeId) return null;
        let current = branch;
        while (current && !this._canSelectBranch(current, state)) {
            const parentId = this._parentMap.get(current.nodeId);
            if (parentId == null) return null;
            current = state.allBranches.find((b) => b.nodeId === parentId) || null;
        }
        return current;
    }

    _scoreSelfIgnoring(b1, allBranches, ignoredIds = null) {
        if (!b1.path?.samples) return { hits: 0, partners: 0 };
        const s = b1.path.samples;
        let totalHits = 0;
        let partners = 0;
        for (let j = 0; j < allBranches.length; j++) {
            const b2 = allBranches[j];
            if (b2 === b1) continue;
            if (ignoredIds?.has(b2.nodeId)) continue;
            if (!b2.path2d) continue;
            if (this._areAdjacent(b1, b2)) continue;

            let hits = 0;
            for (let k = this._sampleProbeStart(b1); k < s.length; k++) {
                if (!s[k]) continue;
                if (this._pointHitsBranch(b1, b2, s[k], k)) hits++;
            }
            if (b1.isLeaf && b1.leafData) {
                for (const pt of this._leafProbePointsFromBranch(b1)) {
                    if (this._pointHitsBranch(b1, b2, pt, -1)) hits += 3;
                }
            }
            if (hits > 0) {
                totalHits += hits;
                partners++;
            }
        }
        return { hits: totalHits, partners };
    }

    _countCollisionsAtAngleIgnoring(descendants, allBranches, totalAngle, pivot, ignoredIds = null) {
        const cos = Math.cos(totalAngle);
        const sin = Math.sin(totalAngle);
        const cx = pivot.x, cy = pivot.y;
        const descSet = new Set(descendants);
        let hits = 0;

        for (const bd of descendants) {
            if (!bd.path?.samples) continue;
            const s = bd.path.samples;
            for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
                const pt = s[k];
                if (!pt) continue;
                const dx = pt.x - cx, dy = pt.y - cy;
                const rx = cx + dx * cos - dy * sin;
                const ry = cy + dx * sin + dy * cos;
                for (const b2 of allBranches) {
                    if (ignoredIds?.has(b2.nodeId)) continue;
                    if (descSet.has(b2) || !b2.path2d) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, k)) { hits++; break; }
                }
            }
            if (bd.path2d) {
                for (const b2 of allBranches) {
                    if (ignoredIds?.has(b2.nodeId)) continue;
                    if (descSet.has(b2) || !b2.path?.samples) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    const s2 = b2.path.samples;
                    for (let k = this._sampleProbeStart(b2); k < s2.length; k += 2) {
                        if (!s2[k]) continue;
                        const dx2 = s2[k].x - cx, dy2 = s2[k].y - cy;
                        const irx = cx + dx2 * cos + dy2 * sin;
                        const iry = cy - dx2 * sin + dy2 * cos;
                        if (this._pointHitsBranch(b2, bd, { x: irx, y: iry }, k)) { hits++; break; }
                    }
                }
            }
            if (bd.isLeaf && bd.leafData) {
                for (const pt of this._leafProbePointsFromBranch(bd)) {
                    const dx = pt.x - cx, dy = pt.y - cy;
                    const rx = cx + dx * cos - dy * sin;
                    const ry = cy + dx * sin + dy * cos;
                    let ptHits = 0;
                    for (const b2 of allBranches) {
                        if (ignoredIds?.has(b2.nodeId)) continue;
                        if (descSet.has(b2) || !b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, -1)) { ptHits++; break; }
                    }
                    hits += ptHits * 3;
                }
            }
        }
        return hits;
    }

    _findLeastCollisionAngleIgnoring(descendants, allBranches, pivot, maxPos, maxNeg, ignoredIds = null) {
        const step = deg2rad(5);
        let bestHits = Infinity, bestAngle = 0, bestDir = 1;
        for (let a = 0; a <= maxPos + 0.001; a += step) {
            const hits = this._countCollisionsAtAngleIgnoring(
                descendants, allBranches, a, pivot, ignoredIds
            );
            if (hits < bestHits) { bestHits = hits; bestAngle = a; bestDir = 1; }
        }
        for (let a = step; a <= maxNeg + 0.001; a += step) {
            const hits = this._countCollisionsAtAngleIgnoring(
                descendants, allBranches, -a, pivot, ignoredIds
            );
            if (hits < bestHits) { bestHits = hits; bestAngle = a; bestDir = -1; }
        }
        return { angle: bestAngle, dir: bestDir, hits: bestHits };
    }

    _branchCanSelfResolveIgnoring(branch, state, ignoredIds = null) {
        if (!branch?.path?.samples?.length) return false;
        if (this._scoreSelfIgnoring(branch, state.allBranches, ignoredIds).hits === 0) return true;
        const descendants = this._buildDescendants(branch, state);
        const pivot = branch.path.samples[0];
        const maxA = deg2rad(90);
        const { maxPos, maxNeg } = this._calcLimitsToParent(branch, state, maxA);
        const bestRot = this._findLeastCollisionAngleIgnoring(
            descendants, state.allBranches, pivot, maxPos, maxNeg, ignoredIds
        );
        return bestRot.hits === 0;
    }

    _getSelfCollisionPartners(branch, state) {
        if (!branch?.path?.samples?.length) return [];
        const out = [];
        const s = branch.path.samples;
        for (const b2 of state.allBranches) {
            if (!b2 || b2 === branch || !b2.path2d) continue;
            if (this._areAdjacent(branch, b2)) continue;
            let overlaps = false;
            for (let k = this._sampleProbeStart(branch); k < s.length; k++) {
                if (s[k] && this._pointHitsBranch(branch, b2, s[k], k)) { overlaps = true; break; }
            }
            if (!overlaps && branch.isLeaf && branch.leafData) {
                for (const pt of this._leafProbePointsFromBranch(branch)) {
                    if (this._pointHitsBranch(branch, b2, pt, -1)) { overlaps = true; break; }
                }
            }
            if (overlaps) out.push(b2);
        }
        return out;
    }

    _getPrimaryCollisionPartner(branch, state) {
        if (!branch) return null;
        const r = this._scoreSelf(branch, state.allBranches);
        return r?.collidingBranch || null;
    }

    _canBranchMoveForRescue(blocker, state) {
        if (!blocker?.path?.samples?.length) return false;
        if (this._branchCanSelfResolve(blocker, state)) return true;
        if (blocker.isLeaf) {
            const pId = this._parentMap.get(blocker.nodeId);
            const parent = pId != null ? state.allBranches.find((b) => b.nodeId === pId) : null;
            if (!parent) return false;
            const bestSlide = this._findLeastCollisionSlide(blocker, parent, state.allBranches, state);
            return !!bestSlide && bestSlide.hits < Infinity && bestSlide.targetIdx !== bestSlide.startIdx;
        }
        return false;
    }

    _setRescueTarget(blocker, state, opensForNodeId, ruleText, fallbackRule = "neighboring", extras = null) {
        const allColls = this._collectSubtreeCollisions(blocker, state);
        let maxScore = 0;
        for (const c of allColls) maxScore = Math.max(maxScore, c.hits);
        blocker.isHighlightWhite = true;
        const targetObj = {
            b1: blocker,
            collidingBranch: null,
            overlapBranch: blocker,
            overlapMinIdx: -1,
            overlapMaxIdx: -1,
            isLeafBody: false,
            allCollisions: allColls,
            initialTotalHits: allColls.reduce((s, c) => s + c.hits, 0),
            score: maxScore,
            targetX: blocker.path.samples[0].x,
            targetY: blocker.path.samples[0].y,
            opensFor: opensForNodeId,
            fallbackRule
        };
        if (extras && typeof extras === "object") Object.assign(targetObj, extras);
        this.target = targetObj;
        this._setPrimaryNode(opensForNodeId ?? blocker.nodeId);
        this.state = "FLYING";
        this._setRuleNow(ruleText, opensForNodeId ?? blocker.nodeId, blocker.nodeId);
    }

    _tryNeighboringFallback(origBranch, state, mode, opensForOverride = null, extras = null) {
        if (!origBranch) return false;
        const partners = this._getSelfCollisionPartners(origBranch, state);
        if (!partners.length) return false;
        const parentId = this._parentMap.get(origBranch.nodeId);
        const candidates = partners.filter((p) => {
            const isSibling = this._parentMap.get(p.nodeId) === parentId;
            return mode === "neighboring" ? isSibling : !isSibling;
        });
        for (const blocker of candidates) {
            if (this.exhaustedNodes.has(blocker.nodeId)) continue;
            const ignored = new Set([blocker.nodeId]);
            // Only move blocker when it can open a resolvable path for the original.
            const opensSpace = this._branchCanSelfResolveIgnoring(origBranch, state, ignored);
            if (!opensSpace) continue;
            if (!this._canBranchMoveForRescue(blocker, state)) continue;
            this._setRescueTarget(
                blocker,
                state,
                opensForOverride ?? origBranch.nodeId,
                mode === "neighboring"
                    ? `Rule: ${this._label(blocker)} ${blocker.nodeId} trying neighboring for ${this._label(origBranch)} ${origBranch.nodeId}.`
                    : `Rule: ${this._label(blocker)} ${blocker.nodeId} trying inter-neighboring for ${this._label(origBranch)} ${origBranch.nodeId}.`,
                mode,
                extras
            );
            return true;
        }
        return false;
    }

    _tryPassingFallback(origBranch, state) {
        if (!origBranch?.path?.samples?.length) return false;
        const currentHits = this._scoreSelf(origBranch, state.allBranches).hits;
        if (currentHits <= 0) return false;

        const primary = this._getPrimaryCollisionPartner(origBranch, state);
        const partners = this._getSelfCollisionPartners(origBranch, state);
        if (primary && !partners.some((p) => p.nodeId === primary.nodeId)) {
            partners.unshift(primary);
        }
        if (!partners.length) return false;

        for (const blocker of partners) {
            if (!blocker?.path?.samples?.length) continue;
            if (this.exhaustedNodes.has(blocker.nodeId)) continue;

            const ignored = new Set([blocker.nodeId]);
            const reducedHits = this._scoreSelfIgnoring(origBranch, state.allBranches, ignored).hits;
            if (reducedHits >= currentHits) continue;

            this._setRescueTarget(
                blocker,
                state,
                origBranch.nodeId,
                `Rule: ${this._label(blocker)} ${blocker.nodeId} trying passing for ${this._label(origBranch)} ${origBranch.nodeId}.`,
                "passing",
                { passBaselineHits: currentHits }
            );
            return true;
        }
        return false;
    }

    _tryCascadingNeighboring(blocked, state, depth = 5, nextOpensFor = null, visited = null) {
        if (!blocked || depth <= 0) return false;
        const seen = visited || new Set();
        seen.add(blocked.nodeId);

        const primary = this._getPrimaryCollisionPartner(blocked, state);
        const partners = this._getSelfCollisionPartners(blocked, state);
        if (primary && !partners.some((p) => p.nodeId === primary.nodeId)) {
            partners.unshift(primary);
        }
        if (!partners.length) return false;
        const blockedParent = this._parentMap.get(blocked.nodeId);
        const ordered = partners.slice().sort((a, b) => {
            const aPrimary = primary && a.nodeId === primary.nodeId ? 0 : 1;
            const bPrimary = primary && b.nodeId === primary.nodeId ? 0 : 1;
            if (aPrimary !== bPrimary) return aPrimary - bPrimary;
            const aSibling = this._parentMap.get(a.nodeId) === blockedParent ? 0 : 1;
            const bSibling = this._parentMap.get(b.nodeId) === blockedParent ? 0 : 1;
            return aSibling - bSibling;
        });

        for (const mover of ordered) {
            if (!mover?.path?.samples?.length) continue;
            if (seen.has(mover.nodeId)) continue;
            const isPrimary = primary && mover.nodeId === primary.nodeId;
            if (!isPrimary && this.exhaustedNodes.has(mover.nodeId)) continue;
            const ignored = new Set([mover.nodeId]);
            const currentHits = this._scoreSelf(blocked, state.allBranches).hits;
            const reducedHits = this._scoreSelfIgnoring(blocked, state.allBranches, ignored).hits;
            const opensBlocked =
                reducedHits < currentHits ||
                this._branchCanSelfResolveIgnoring(blocked, state, ignored);
            if (!opensBlocked) continue;

            if (this._canBranchMoveForRescue(mover, state)) {
                if (nextOpensFor) this._cascadeNeeds.set(blocked.nodeId, nextOpensFor);
                this._setRescueTarget(
                    mover,
                    state,
                    blocked.nodeId,
                    `Rule: ${this._label(mover)} ${mover.nodeId} trying cascading for ${this._label(blocked)} ${blocked.nodeId}.`,
                    "cascading-neighboring"
                );
                return true;
            }

            const childSeen = new Set(seen);
            const chained = this._tryCascadingNeighboring(
                mover,
                state,
                depth - 1,
                blocked.nodeId,
                childSeen
            );
            if (chained) {
                if (nextOpensFor) this._cascadeNeeds.set(blocked.nodeId, nextOpensFor);
                return true;
            }
        }
        return false;
    }

    _calcCondenseRotationToParent(b, state) {
        const pId = this._parentMap.get(b?.nodeId);
        if (!pId || !b?.path?.samples?.length) return null;
        const parent = state.allBranches.find((pb) => pb.nodeId === pId);
        if (!parent?.path?.samples?.length) return null;
        const pivot = b.path.samples[0];

        let parentSampleIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < parent.path.samples.length; i++) {
            const p = parent.path.samples[i];
            if (!p) continue;
            const d = Math.hypot(p.x - pivot.x, p.y - pivot.y);
            if (d < minDist) { minDist = d; parentSampleIdx = i; }
        }
        let s1 = parent.path.samples[parentSampleIdx];
        let s2 = parentSampleIdx + 3 < parent.path.samples.length
            ? parent.path.samples[parentSampleIdx + 3]
            : parent.path.samples[parent.path.samples.length - 1];
        if (s1 === s2 && parentSampleIdx >= 3) s1 = parent.path.samples[parentSampleIdx - 3];
        if (!s1 || !s2) return null;

        let angleDiff = Math.atan2(b.path.tipY - pivot.y, b.path.tipX - pivot.x) -
            Math.atan2(s2.y - s1.y, s2.x - s1.x);
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const margin = 0.06;
        const desired = Math.min(deg2rad(26), Math.max(0, Math.abs(angleDiff) - margin));
        if (desired < deg2rad(1.5)) return null;
        const dir = angleDiff > 0 ? -1 : 1; // rotate back toward parent axis
        return { angle: desired, dir };
    }

    _sumCollisionHits(colls) {
        return (colls || []).reduce((s, c) => s + (c?.hits || 0), 0);
    }

    _findAxisAlongParentAtChild(parent, child) {
        if (!parent?.path?.samples?.length || !child?.path?.samples?.length) return null;
        const pivot = child.path.samples[0];
        let parentSampleIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < parent.path.samples.length; i++) {
            const p = parent.path.samples[i];
            if (!p) continue;
            const d = Math.hypot(p.x - pivot.x, p.y - pivot.y);
            if (d < minDist) {
                minDist = d;
                parentSampleIdx = i;
            }
        }
        let s1 = parent.path.samples[parentSampleIdx];
        let s2 = parentSampleIdx + 3 < parent.path.samples.length
            ? parent.path.samples[parentSampleIdx + 3]
            : parent.path.samples[parent.path.samples.length - 1];
        if (s1 === s2 && parentSampleIdx >= 3) s1 = parent.path.samples[parentSampleIdx - 3];
        if (!s1 || !s2) return null;
        const ax = s2.x - s1.x;
        const ay = s2.y - s1.y;
        const alen = Math.hypot(ax, ay);
        if (alen < 1e-6) return null;
        return { pivot: { x: pivot.x, y: pivot.y }, nx: ax / alen, ny: ay / alen };
    }

    _reflectBranchTree(branches, pivot, nx, ny) {
        const reflectPt = (p) => {
            if (!p) return;
            const dx = p.x - pivot.x;
            const dy = p.y - pivot.y;
            const dot = dx * nx + dy * ny;
            p.x = pivot.x + 2 * dot * nx - dx;
            p.y = pivot.y + 2 * dot * ny - dy;
        };

        for (const bd of branches) {
            if (bd.path?.samples) for (const p of bd.path.samples) if (p) reflectPt(p);
            if (bd.path?.left) for (const p of bd.path.left) reflectPt(p);
            if (bd.path?.right) for (const p of bd.path.right) reflectPt(p);

            if (typeof bd.path?.tipX === "number" && typeof bd.path?.tipY === "number") {
                const tip = { x: bd.path.tipX, y: bd.path.tipY };
                reflectPt(tip);
                bd.path.tipX = tip.x;
                bd.path.tipY = tip.y;
            }

            if (typeof bd.path?.tipNormX === "number" && typeof bd.path?.tipNormY === "number") {
                const tn = { x: pivot.x + bd.path.tipNormX, y: pivot.y + bd.path.tipNormY };
                reflectPt(tn);
                bd.path.tipNormX = tn.x - pivot.x;
                bd.path.tipNormY = tn.y - pivot.y;
            }

            if (bd.path?.left && bd.path?.right) {
                const tmp = bd.path.left;
                bd.path.left = bd.path.right;
                bd.path.right = tmp;
            }

            if (bd.isLeaf && bd.leafData) {
                const lp = { x: bd.leafData.x, y: bd.leafData.y };
                reflectPt(lp);
                bd.leafData.x = lp.x;
                bd.leafData.y = lp.y;
                bd.leafData.angle = 2 * Math.atan2(ny, nx) - bd.leafData.angle;
            }

            rebuildPath2d(bd);
        }
    }

    _planCondenseMove(branch, state) {
        const condenseRot = this._calcCondenseRotationToParent(branch, state);
        if (!condenseRot || condenseRot.angle <= deg2rad(1)) return null;
        const descendants = this._buildDescendants(branch, state);
        const pivot = branch?.path?.samples?.[0];
        if (!pivot || !descendants.length) return null;

        const baselineHits = this._sumCollisionHits(this._collectSubtreeCollisions(branch, state));
        const totalAngle = condenseRot.angle * condenseRot.dir;
        const directHits = this._countCollisionsAtAngle(
            descendants, state.allBranches, totalAngle, pivot
        );
        if (directHits <= baselineHits) {
            return { ...condenseRot, hits: directHits, baselineHits, sweepChildId: null };
        }

        const directChildren = state.allBranches.filter(
            (b) => this._parentMap.get(b.nodeId) === branch.nodeId && b?.path?.samples?.length
        );
        if (!directChildren.length) return null;

        const snap = snapshotBranches(descendants);
        let bestPlan = null;

        for (const child of directChildren) {
            const childDesc = this._buildDescendants(child, state);
            if (!childDesc.length) continue;
            const axis = this._findAxisAlongParentAtChild(branch, child);
            if (!axis) continue;

            this._reflectBranchTree(childDesc, axis.pivot, axis.nx, axis.ny);
            const sweptHits = this._countCollisionsAtAngle(
                descendants, state.allBranches, totalAngle, pivot
            );
            restoreBranches(descendants, snap);

            if (sweptHits > baselineHits) continue;
            if (!bestPlan || sweptHits < bestPlan.hits) {
                bestPlan = {
                    ...condenseRot,
                    hits: sweptHits,
                    baselineHits,
                    sweepChildId: child.nodeId,
                    sweepPivot: axis.pivot,
                    sweepNx: axis.nx,
                    sweepNy: axis.ny,
                };
            }
        }

        return bestPlan;
    }

    _tryCondensingFallback(origBranch, state) {
        if (!origBranch?.path?.samples?.length) return false;
        const partners = this._getSelfCollisionPartners(origBranch, state);
        if (!partners.length || partners.length > 3) return false;

        for (const blocker of partners) {
            if (!blocker?.path?.samples?.length) continue;
            const condensePlan = this._planCondenseMove(blocker, state);
            if (!condensePlan) continue;
            const ignored = new Set([blocker.nodeId]);
            const opens = this._branchCanSelfResolveIgnoring(origBranch, state, ignored) ||
                this._scoreSelfIgnoring(origBranch, state.allBranches, ignored).hits <
                this._scoreSelf(origBranch, state.allBranches).hits;
            if (!opens) continue;
            this._setRescueTarget(
                blocker,
                state,
                origBranch.nodeId,
                condensePlan.sweepChildId
                    ? `Rule: ${this._label(blocker)} ${blocker.nodeId} trying sweeping+condensing for ${this._label(origBranch)} ${origBranch.nodeId}.`
                    : `Rule: ${this._label(blocker)} ${blocker.nodeId} trying condensing for ${this._label(origBranch)} ${origBranch.nodeId}.`,
                "condensing",
                {
                    condenseFor: origBranch.nodeId,
                    condenseDir: condensePlan.dir,
                    condenseAngle: condensePlan.angle,
                    condenseSweepChildId: condensePlan.sweepChildId ?? null,
                }
            );
            return true;
        }

        // Condensing can invoke neighboring/inter-neighboring/cascading on blockers.
        for (const blocker of partners) {
            const rescuedBySibling = this._tryNeighboringFallback(
                blocker, state, "neighboring", origBranch.nodeId, { condenseFor: origBranch.nodeId }
            );
            if (rescuedBySibling) return true;
            const rescuedByInter = this._tryNeighboringFallback(
                blocker, state, "inter-neighboring", origBranch.nodeId, { condenseFor: origBranch.nodeId }
            );
            if (rescuedByInter) return true;
            const rescuedByCascade = this._tryCascadingNeighboring(blocker, state, 4, origBranch.nodeId, new Set());
            if (rescuedByCascade) {
                this.currentRule = `Rule: ${this._label(blocker)} ${blocker.nodeId} trying cascading for ${this._label(origBranch)} ${origBranch.nodeId}.`;
                return true;
            }
        }
        return false;
    }

    _tryRebuildFallback(origBranch, state) {
        if (!origBranch?.path?.samples?.length) return false;
        const descendants = this._buildDescendants(origBranch, state);
        if (!descendants.length) return false;
        const pivot = origBranch.path.samples[0];
        if (!pivot) return false;

        const baselinePairs = this._collectSubtreeCollisions(origBranch, state);
        const baselineHits = baselinePairs.reduce((s, c) => s + (c.hits || 0), 0);
        if (baselineHits <= 0) return false;

        this.rebuildJob = {
            branchId: origBranch.nodeId,
            descendants,
            pivot: { x: pivot.x, y: pivot.y },
            baselineHits,
            bestHits: baselineHits,
            bestSnap: null,
            originalSnap: snapshotBranches(descendants),
            // Width-safe rebuild: never scale above 1.0.
            scales: [0.55, 0.7, 0.85, 0.95, 1.0],
            angleDeg: -85,
            scaleIdx: 0,
            done: false
        };
        if (this.target?.b1) this.target.b1.isHighlightWhite = false;
        origBranch.isHighlightWhite = true;
        this.target = { b1: origBranch, targetX: pivot.x, targetY: pivot.y };
        this._setPrimaryNode(origBranch.nodeId);
        this.state = "REBUILDING";
        this._setRuleNow(`Rule: Rebuilding ${this._label(origBranch)} ${origBranch.nodeId} (base fixed) to fit available space.`, origBranch.nodeId, origBranch.nodeId);
        return true;
    }

    _elongatePointAlongAxis(p, pivot, ux, uy, factor) {
        if (!p) return;
        const dx = p.x - pivot.x;
        const dy = p.y - pivot.y;
        const t = dx * ux + dy * uy;
        const px = dx - t * ux;
        const py = dy - t * uy;
        const nt = t > 0 ? t * factor : t; // only elongate outward from base
        p.x = pivot.x + ux * nt + px;
        p.y = pivot.y + uy * nt + py;
    }

    _elongateBranchTree(branches, pivot, ux, uy, factor) {
        for (const b of branches) {
            if (!b?.path) continue;
            if (b.path.samples) for (const p of b.path.samples) if (p) this._elongatePointAlongAxis(p, pivot, ux, uy, factor);
            if (b.path.left) for (const p of b.path.left) if (p) this._elongatePointAlongAxis(p, pivot, ux, uy, factor);
            if (b.path.right) for (const p of b.path.right) if (p) this._elongatePointAlongAxis(p, pivot, ux, uy, factor);

            if (Number.isFinite(b.path.tipX) && Number.isFinite(b.path.tipY)) {
                const tp = { x: b.path.tipX, y: b.path.tipY };
                this._elongatePointAlongAxis(tp, pivot, ux, uy, factor);
                b.path.tipX = tp.x;
                b.path.tipY = tp.y;
            }
            if (b.isLeaf && b.leafData) {
                const lp = { x: b.leafData.x, y: b.leafData.y };
                this._elongatePointAlongAxis(lp, pivot, ux, uy, factor);
                b.leafData.x = lp.x;
                b.leafData.y = lp.y;
            }
            rebuildPath2d(b);
        }
    }

    _startElongatingFallback(origBranch, state) {
        if (!origBranch?.path?.samples?.length) return false;
        const activeEscalated = !!this.target?.escalatedFrom;
        if (!activeEscalated) return false; // only for escalated flow

        // Elongate the currently escalated branch (the one we're trying to use to free the child),
        // not necessarily the direct parent of origBranch.
        const escalatedBranch = this.target?.b1?.path?.samples?.length ? this.target.b1 : null;
        if (!escalatedBranch) return false;

        const pivot = escalatedBranch.path.samples[0];
        const tipX = escalatedBranch.path.tipX;
        const tipY = escalatedBranch.path.tipY;
        const len = Math.hypot(tipX - pivot.x, tipY - pivot.y);
        if (len < 1e-4) return false;
        const ux = (tipX - pivot.x) / len;
        const uy = (tipY - pivot.y) / len;

        const descendants = this._buildDescendants(escalatedBranch, state);
        if (!descendants.length) return false;

        this.elongateJob = {
            branchId: escalatedBranch.nodeId,
            opensFor: origBranch.nodeId,
            descendants,
            pivot: { x: pivot.x, y: pivot.y },
            ux, uy,
            currentScale: 1,
            maxScale: 2.25,
            stepScale: 1.012,
            baselineHits: this._sumCollisionHits(this._collectSubtreeCollisions(escalatedBranch, state))
        };
        if (this.target?.b1) this.target.b1.isHighlightWhite = false;
        escalatedBranch.isHighlightWhite = true;
        this.target = {
            b1: escalatedBranch,
            targetX: pivot.x,
            targetY: pivot.y,
            opensFor: origBranch.nodeId,
            fallbackRule: "elongating"
        };
        this._setPrimaryNode(origBranch.nodeId);
        this.state = "ELONGATING";
        this._setRuleNow(`Rule: Elongating ${this._label(escalatedBranch)} ${escalatedBranch.nodeId} to open space for child ${origBranch.nodeId}.`, origBranch.nodeId, escalatedBranch.nodeId);
        return true;
    }

    _tryElongatingEscalation(origBranch, state) {
        if (!origBranch?.nodeId) return false;
        let currentNodeId = this.target?.b1?.nodeId || origBranch.nodeId;
        let ancestor = null;
        while (true) {
            const pId = this._parentMap.get(currentNodeId);
            if (!pId) break;
            const pb = state.allBranches.find((b) => b.nodeId === pId && b.depth > 0 && b.path?.samples?.length);
            if (!pb) break;
            if (!this.exhaustedNodes.has(pId)) { ancestor = pb; break; }
            currentNodeId = pId;
        }
        if (!ancestor) return false;

        const allColls = this._collectSubtreeCollisions(ancestor, state);
        let maxScore = 0;
        for (const c of allColls) maxScore = Math.max(maxScore, c.hits);
        if (this.target?.b1) this.target.b1.isHighlightWhite = false;
        ancestor.isHighlightWhite = true;
        this.target = {
            b1: ancestor,
            targetX: ancestor.path.samples[0].x,
            targetY: ancestor.path.samples[0].y,
            allCollisions: allColls,
            initialTotalHits: allColls.reduce((s, c) => s + c.hits, 0),
            score: maxScore,
            escalatedFrom: origBranch.nodeId,
            elongatePreferred: true
        };
        this._setPrimaryNode(origBranch.nodeId);
        this.state = "FLYING";
        this._setRuleNow(`Rule: Elongating escalation. Escalating to ${ancestor.nodeId} and allowing elongation if rotation alone fails.`, origBranch.nodeId, ancestor.nodeId);
        return true;
    }

    _tickElongating(state) {
        const job = this.elongateJob;
        if (!job) return false;
        const escalatedBranch = state.allBranches.find((b) => b.nodeId === job.branchId);
        if (!escalatedBranch) {
            this.elongateJob = null;
            this.state = "SCANNING";
            return true;
        }

        const preStepSnap = snapshotBranches(job.descendants);
        this._elongateBranchTree(job.descendants, job.pivot, job.ux, job.uy, job.stepScale);
        job.currentScale *= job.stepScale;
        const currentHits = this._sumCollisionHits(this._collectSubtreeCollisions(escalatedBranch, state));

        if (currentHits > job.baselineHits) {
            restoreBranches(job.descendants, preStepSnap);
            if (job.opensFor != null) this._elongationFailedFor.add(job.opensFor);
            this.elongateJob = null;
            this.target.b1.isHighlightWhite = false;
            this.state = "SCANNING";
            this.currentRule = `Rule: Elongating failed for ${this._label(escalatedBranch)} ${escalatedBranch.nodeId} because it created more collisions.`;
            return true;
        }

        if (this.target?.opensFor && this._handoffToOpenedOriginal(state)) {
            this.elongateJob = null;
            this.madeProgress = true;
            return true;
        }

        if (job.currentScale >= job.maxScale) {
            if (job.opensFor != null) this._elongationFailedFor.add(job.opensFor);
            this.elongateJob = null;
            this.target.b1.isHighlightWhite = false;
            this.state = "SCANNING";
            this.currentRule = `Rule: Elongating reached max length for ${this._label(escalatedBranch)} ${escalatedBranch.nodeId} without opening enough space.`;
            return true;
        }

        this.currentRule = `Rule: Elongating ${this._label(escalatedBranch)} ${escalatedBranch.nodeId}... scale ${job.currentScale.toFixed(2)}x`;
        return true;
    }

    _tickRebuildJob(state) {
        const job = this.rebuildJob;
        if (!job || job.done) return false;
        const origBranch = state.allBranches.find((b) => b.nodeId === job.branchId);
        if (!origBranch) {
            this.rebuildJob = null;
            this.state = "SCANNING";
            return true;
        }

        const combosPerFrame = 3;
        let checked = 0;
        while (!job.done && checked < combosPerFrame) {
            restoreBranches(job.descendants, job.originalSnap);
            const angle = deg2rad(job.angleDeg);
            const scale = job.scales[job.scaleIdx];
            if (scale !== 1) this._scaleBranchTree(job.descendants, scale, job.pivot);
            if (angle !== 0) this._rotateBranchTree(job.descendants, angle, job.pivot);

            const hits = this._collectSubtreeCollisions(origBranch, state)
                .reduce((s, c) => s + (c.hits || 0), 0);
            if (hits < job.bestHits) {
                job.bestHits = hits;
                job.bestSnap = snapshotBranches(job.descendants);
            }
            checked++;

            job.scaleIdx++;
            if (job.scaleIdx >= job.scales.length) {
                job.scaleIdx = 0;
                job.angleDeg += 5;
                if (job.angleDeg > 85 || job.bestHits === 0) job.done = true;
            }
        }

        if (!job.done) {
            this.rebuildRayPhase += 0.22;
            this.currentRule = `Rule: Rebuilding ${this._label(origBranch)} ${origBranch.nodeId}... best ${job.bestHits}/${job.baselineHits} hits.`;
            return true;
        }

        restoreBranches(job.descendants, job.originalSnap);
        if (!job.bestSnap) {
            this.rebuildJob = null;
            this.state = "SCANNING";
            this.currentRule = `Rule: Rebuild failed for ${this._label(origBranch)} ${origBranch.nodeId}.`;
            return true;
        }
        restoreBranches(job.descendants, job.bestSnap);

        const improvedBy = job.baselineHits - job.bestHits;
        this.rebuildJob = null;
        this.madeProgress = true;
        if (job.bestHits === 0) {
            this.currentRule = `Rule: Rebuild succeeded for ${this._label(origBranch)} ${origBranch.nodeId}. Refit subtree cleared all collisions (base fixed).`;
            if (this.target?.b1) this.target.b1.isHighlightWhite = false;
            this.state = "SCANNING";
            return true;
        }

        this.currentRule = `Rule: Rebuild adjusted ${this._label(origBranch)} ${origBranch.nodeId} (base fixed), reduced ${improvedBy} hit(s). Continuing solve.`;
        if (this.target?.b1) this.target.b1.isHighlightWhite = false;
        origBranch.isHighlightWhite = true;
        const allColls = this._collectSubtreeCollisions(origBranch, state);
        let maxScore = 0;
        for (const c of allColls) maxScore = Math.max(maxScore, c.hits || 0);
        this.target = {
            b1: origBranch,
            targetX: origBranch.path.samples[0].x,
            targetY: origBranch.path.samples[0].y,
            allCollisions: allColls,
            initialTotalHits: allColls.reduce((s, c) => s + (c.hits || 0), 0),
            score: maxScore
        };
        this.state = "FLYING";
        return true;
    }

    _queueInfo(msg) { this.currentRule = msg; }
    _setRuleNow(msg) { this.currentRule = msg; }
    _clearInfoQueue() { }

    _setPrimaryNode(nodeId) {
        this.primaryNodeId = nodeId ?? null;
    }

    _entityTextById(nodeId, state) {
        const b = state?.allBranches?.find((x) => x.nodeId === nodeId);
        if (b) return `${this._label(b)} ${b.nodeId}`;
        return `Branch ${nodeId}`;
    }

    _currentPrimaryId() {
        return this.primaryNodeId ?? this.target?.escalatedFrom ?? this.target?.opensFor ?? this.target?.b1?.nodeId ?? null;
    }

    _currentPrimaryText(state) {
        const id = this._currentPrimaryId();
        return id != null ? this._entityTextById(id, state) : "Primary branch";
    }

    _currentActorText(state) {
        const actorId = this.target?.b1?.nodeId;
        return actorId != null ? this._entityTextById(actorId, state) : "Branch";
    }

    _displayActorText(state) {
        const actor = this._currentActorText(state);
        return this._isEscalatedActorContext() ? `Escalated ${actor}` : actor;
    }

    _isEscalatedActorContext() {
        const pId = this._currentPrimaryId();
        const aId = this.target?.b1?.nodeId ?? null;
        return this.target?.escalatedFrom && pId != null && aId != null && pId !== aId;
    }

    _queueRuleFailToNext(nodeId, state, failedRule, nextRule) {
        this._queueInfo(`Rule: ${this._entityTextById(nodeId, state)} ${failedRule} failed, going to ${nextRule}.`, nodeId, nodeId);
    }

    _formatFallbackSummary(tried) {
        if (!tried?.length) return "none";
        return tried.join(", ");
    }

    _tryEscalationFailFallbacks(origBranch, state) {
        if (!origBranch) return false;
        const id = origBranch.nodeId;
        const tried = [];
        this._setPrimaryNode(id);
        tried.push("neighboring failed");
        if (this._tryNeighboringFallback(origBranch, state, "neighboring")) return true;
        tried.push("inter-neighboring failed");
        if (this._tryNeighboringFallback(origBranch, state, "inter-neighboring")) return true;
        tried.push("condensing failed");
        if (this._tryCondensingFallback(origBranch, state)) return true;
        tried.push("passing failed");
        if (this._tryPassingFallback(origBranch, state)) return true;
        tried.push("cascading failed");
        if (this._tryCascadingNeighboring(origBranch, state, 5, null, new Set())) return true;
        tried.push("elongating failed");
        if (this._startElongatingFallback(origBranch, state)) return true;
        if (this._elongationFailedFor.has(id)) {
            tried.push("rebuilding failed");
        } else {
            tried.push("rebuilding unavailable (waits for elongating failed)");
        }
        if (this._elongationFailedFor.has(id) && this._tryRebuildFallback(origBranch, state)) {
            this._elongationFailedFor.delete(id);
            return true;
        }

        this.currentRule = `Rule: ${this._entityTextById(id, state)} stuck. Tested actions: ${this._formatFallbackSummary(tried)}.`;
        return false;
    }

    _handoffToOpenedOriginal(state) {
        const origId = this.target?.opensFor;
        if (!origId) return false;
        const orig = state.allBranches.find((b) => b.nodeId === origId);
        if (!orig?.path?.samples?.length) return false;
        if (!this._canSelectBranch(orig, state)) return false;
        const cascadeNext = this._cascadeNeeds.get(origId) || null;
        const canChain = !!cascadeNext;
        const canResolveNow = this._branchCanSelfResolve(orig, state);
        const score = this._scoreSelf(orig, state.allBranches);
        const partialPassOpened =
            this.target?.fallbackRule === "passing" &&
            typeof this.target?.passBaselineHits === "number" &&
            score.hits < this.target.passBaselineHits;
        if (!canResolveNow && !canChain && !partialPassOpened) return false;
        if (score.hits <= 0 && !canChain) {
            // Space opened enough that the original is already clear.
            if (cascadeNext) this._cascadeNeeds.delete(origId);
            if (this.target?.b1) this.target.b1.isHighlightWhite = false;
            orig.isHighlightWhite = false;
            this.state = "SCANNING";
            this.currentRule = `Rule: Space opened for ${this._label(orig)} ${orig.nodeId}; it is already clear.`;
            return true;
        }
        if (score.hits <= 0) return false;
        const allColls = this._collectSubtreeCollisions(orig, state);
        let maxScore = 0;
        for (const c of allColls) maxScore = Math.max(maxScore, c.hits);
        if (cascadeNext) this._cascadeNeeds.delete(origId);
        if (this.target?.b1) this.target.b1.isHighlightWhite = false;
        orig.isHighlightWhite = true;
        this.target = {
            b1: orig,
            collidingBranch: score.collidingBranch,
            overlapBranch: orig,
            overlapMinIdx: score.overlapMinIdx,
            overlapMaxIdx: score.overlapMaxIdx,
            isLeafBody: score.isLeafBody,
            allCollisions: allColls,
            initialTotalHits: allColls.reduce((s, c) => s + c.hits, 0),
            score: maxScore || score.hits,
            targetX: orig.path.samples[0].x,
            targetY: orig.path.samples[0].y,
            opensFor: cascadeNext
        };
        this._setPrimaryNode(orig.nodeId);
        this.state = "FLYING";
        this.currentRule = partialPassOpened
            ? `Rule: ${this._label(orig)} ${orig.nodeId} got partial space from passing. Returning to it.`
            : cascadeNext
                ? `Rule: ${this._label(orig)} ${orig.nodeId} trying cascading result space. Returning to it.`
                : `Rule: ${this._label(orig)} ${orig.nodeId} now has space. Returning to it.`;
        return true;
    }

    _handoffToEscalatedChild(state) {
        const childId = this.target?.escalatedFrom;
        if (!childId) return false;
        const child = state.allBranches.find((b) => b.nodeId === childId);
        if (!child?.path?.samples?.length) return false;
        if (!this._canSelectBranch(child, state)) return false;

        const childScore = this._scoreSelf(child, state.allBranches);
        if (childScore.hits <= 0) return false;

        const allColls = this._collectSubtreeCollisions(child, state);
        let maxScore = 0;
        for (const c of allColls) maxScore = Math.max(maxScore, c.hits);

        if (this.target?.b1) this.target.b1.isHighlightWhite = false;
        child.isHighlightWhite = true;
        this.target = {
            b1: child,
            collidingBranch: childScore.collidingBranch,
            overlapBranch: child,
            overlapMinIdx: childScore.overlapMinIdx,
            overlapMaxIdx: childScore.overlapMaxIdx,
            isLeafBody: childScore.isLeafBody,
            allCollisions: allColls,
            initialTotalHits: allColls.reduce((s, c) => s + c.hits, 0),
            score: maxScore || childScore.hits,
            targetX: child.path.samples[0].x,
            targetY: child.path.samples[0].y,
            escalatedFrom: null
        };
        this._setPrimaryNode(child.nodeId);
        this.currentFixAngle = 0;
        this._escalationCheckCooldown = 0;
        this.state = "FLYING";
        this.currentRule = `Rule: ${this._label(child)} ${child.nodeId} now has space after escalation. Returning to it.`;
        return true;
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
        const n1 = b1?.nodeId, n2 = b2?.nodeId;
        return n1 != null && n1 === n2;
    }

    _isParentChild(b1, b2) {
        if (!b1 || !b2) return false;
        const n1 = b1.nodeId, n2 = b2.nodeId;
        return this._parentMap.get(n1) === n2 || this._parentMap.get(n2) === n1;
    }

    _isSibling(b1, b2) {
        if (!b1 || !b2) return false;
        const p1 = this._parentMap.get(b1.nodeId);
        const p2 = this._parentMap.get(b2.nodeId);
        return p1 != null && p1 === p2 && b1.nodeId !== b2.nodeId;
    }

    _baseAllowT(b) {
        return Math.max(0, Math.min(0.95, b?.baseAllowT ?? 0.5));
    }

    _baseSampleLimit(b) {
        const n = b?.path?.samples?.length || 0;
        if (n <= 0) return 0;
        return Math.max(4, Math.floor(n * this._baseAllowT(b)));
    }

    _sampleProbeStart(b) {
        const n = b?.path?.samples?.length || 0;
        if (n <= 0) return 0;
        return Math.min(n - 1, this._baseSampleLimit(b));
    }

    _branchSideAgainstParentAxis(branch, state) {
        if (!branch?.path?.samples?.length) return 0;
        const pId = this._parentMap.get(branch.nodeId);
        if (pId == null) return 0;
        const parent = state?.allBranches?.find((b) => b.nodeId === pId);
        if (!parent?.path?.samples?.length) return 0;

        const pivot = branch.path.samples[0];
        let parentSampleIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < parent.path.samples.length; i++) {
            const p = parent.path.samples[i];
            if (!p) continue;
            const d = Math.hypot(p.x - pivot.x, p.y - pivot.y);
            if (d < minDist) { minDist = d; parentSampleIdx = i; }
        }
        let s1 = parent.path.samples[parentSampleIdx];
        let s2 = parentSampleIdx + 3 < parent.path.samples.length
            ? parent.path.samples[parentSampleIdx + 3]
            : parent.path.samples[parent.path.samples.length - 1];
        if (s1 === s2 && parentSampleIdx >= 3) s1 = parent.path.samples[parentSampleIdx - 3];
        if (!s1 || !s2) return 0;

        const ax = s2.x - s1.x;
        const ay = s2.y - s1.y;
        const bx = branch.path.tipX - pivot.x;
        const by = branch.path.tipY - pivot.y;
        const cross = ax * by - ay * bx;
        if (Math.abs(cross) < 1e-6) return 0;
        return cross > 0 ? 1 : -1;
    }

    _isTipChildBranch(branch, state) {
        if (!branch?.path?.samples?.length) return false;
        const pId = this._parentMap.get(branch.nodeId);
        if (pId == null) return false;
        const parent = state?.allBranches?.find((b) => b.nodeId === pId);
        if (!parent?.path?.samples?.length) return false;

        const pivot = branch.path.samples[0];
        const dTip = Math.hypot(pivot.x - parent.path.tipX, pivot.y - parent.path.tipY);
        if (dTip <= 8) return true;

        if (!state?.tree) return false;
        let pNode = null;
        let bNode = null;
        const walk = (n) => {
            if (!n) return;
            if (n.id === pId) pNode = n;
            if (n.id === branch.nodeId) bNode = n;
            for (const c of (n.children || [])) walk(c);
        };
        walk(state.tree);
        return !!(pNode && bNode && pNode.children && pNode.children.indexOf(bNode) === 0);
    }

    _nearBasePoint(b, pt) {
        const p0 = b?.path?.samples?.[0];
        if (!p0 || !pt) return false;
        const bw = p0.w || 2;
        const r = Math.max(6, bw * 2.2);
        const dx = p0.x - pt.x;
        const dy = p0.y - pt.y;
        return dx * dx + dy * dy <= r * r;
    }

    _isNaturalBaseOnlyTouch(source, target, pt, sourceSampleIdx = -1) {
        if (!source || !target || !pt) return false;
        const sourceNearBase = sourceSampleIdx >= 0
            ? sourceSampleIdx <= this._baseSampleLimit(source)
            : this._nearBasePoint(source, pt);

        if (this._isParentChild(source, target)) {
            const sourceIsChild = this._parentMap.get(source.nodeId) === target.nodeId;
            const child = sourceIsChild ? source : target;
            const parent = sourceIsChild ? target : source;
            if (!child?.path?.samples?.[0] || !parent?.path?.samples?.[0]) return false;

            // Base/base parent-child contacts are structural and should never be treated
            // as collisions (regardless of which branch is the sampled source).
            const nearChildBase = source === child ? sourceNearBase : this._nearBasePoint(child, pt);
            const nearParentBase = source === parent ? sourceNearBase : this._nearBasePoint(parent, pt);
            if (nearChildBase || nearParentBase) return true;

            // Parent sampled against child is also treated as a natural connection.
            if (source === parent) return true;
            // Child sampled against parent is only natural near the child's base.
            return sourceNearBase;
        }

        const targetNearBase = this._nearBasePoint(target, pt);
        if (!sourceNearBase || !targetNearBase) return false;
        return true;
    }

    _pointHitsBranch(source, target, pt, sourceSampleIdx = -1) {
        if (!target?.path2d || !pt) return false;
        if (!source || source === target) return false;
        if (this._isNaturalBaseOnlyTouch(source, target, pt, sourceSampleIdx)) return false;
        return ctx.isPointInPath(target.path2d, pt.x, pt.y);
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
                for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
                    if (!s[k]) continue;
                    if (this._pointHitsBranch(bd, b2, s[k], k)) {
                        contacts.add(j);
                        break;
                    }
                }
                if (!contacts.has(j) && bd.isLeaf && bd.leafData) {
                    for (const pt of this._leafProbePointsFromBranch(bd)) {
                        if (this._pointHitsBranch(bd, b2, pt, -1)) { contacts.add(j); break; }
                    }
                }
            }
        }
        return contacts;
    }

    _branchHitsOwnDescendants(branch, state) {
        if (!branch?.path?.samples?.length) return false;
        const descendants = this._buildDescendants(branch, state).filter((b) => b !== branch);
        if (!descendants.length) return false;

        const s = branch.path.samples;
        for (const child of descendants) {
            if (!child?.path2d) continue;
            for (let k = this._sampleProbeStart(branch); k < s.length; k++) {
                if (s[k] && this._pointHitsBranch(branch, child, s[k], k)) return true;
            }

            const s2 = child.path?.samples;
            if (!s2 || !branch.path2d) continue;
            for (let k = this._sampleProbeStart(child); k < s2.length; k++) {
                if (s2[k] && this._pointHitsBranch(child, branch, s2[k], k)) return true;
            }
        }
        return false;
    }

    // ── Score a single branch by its OWN geometry's overlaps ─────────────────
    // Only checks b1.path.samples against external branches (no subtree walk).
    // Returns { hits, collidingBranch, overlapMinIdx, overlapMaxIdx }
    _isDescendant(possibleParent, possibleChild) {
        if (!possibleParent || !possibleChild) return false;
        let pId = this._parentMap.get(possibleChild.nodeId);
        while (pId != null) {
            if (pId === possibleParent.nodeId) return true;
            pId = this._parentMap.get(pId);
        }
        return false;
    }

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
            if (this._isDescendant(b1, b2)) continue;

            let hits = 0, minI = Infinity, maxI = -1;
            // Check every sample (dense scan – only on one branch, so cheap)
            for (let k = this._sampleProbeStart(b1); k < s.length; k++) {
                if (!s[k]) continue;
                if (this._pointHitsBranch(b1, b2, s[k], k)) {
                    hits++;
                    if (k < minI) minI = k;
                    if (k > maxI) maxI = k;
                }
            }
            let leafBodyHit = false;
            if (b1.isLeaf && b1.leafData) {
                for (const pt of this._leafProbePointsFromBranch(b1)) {
                    if (this._pointHitsBranch(b1, b2, pt, -1)) {
                        hits += 3;
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
    // Strategy (ancestor-first, parent-to-child):
    //   1. Score every non-trunk branch by ITS OWN overlaps only.
    //   2. Promote each colliding branch to the nearest selectable ancestor.
    //   3. Group collisions by that ancestor.
    //   4. Sort ancestors by depth ASCENDING — parents before children.
    //      Tiebreak by total grouped hits descending, then partner count.
    //
    // This forces the agent to work the tree from parent toward child.
    _findBestTarget(state) {
        const candidates = [];

        for (const b1 of state.allBranches) {
            if (b1.depth === 0) continue;
            if (!b1.path2d) continue;
            if (!b1.path?.samples?.length) continue;
            if (this.exhaustedNodes.has(b1.nodeId)) continue;
            const r = this._scoreSelf(b1, state.allBranches);
            if (r.hits <= 0) continue;
            if (!r.collidingBranch) continue;
            // Allow branch through if it collides with its own ancestor
            // (parent-child collision → we target the child).
            // Otherwise enforce strict parent-first: block if ancestor unresolved.
            const hasAncestorPartner = this._isDescendant(r.collidingBranch, b1);
            if (!hasAncestorPartner && !this._canSelectBranch(b1, state)) continue;
            candidates.push({ b1, r });
        }

        if (candidates.length === 0) return null;

        // STRICT depth-ascending sort: always process parents before children.
        // Tiebreak by hits descending, then partners descending.
        candidates.sort((a, b) => {
            if (a.b1.depth !== b.b1.depth) return a.b1.depth - b.b1.depth;
            if (a.r.hits !== b.r.hits) return b.r.hits - a.r.hits;
            return b.r.partners - a.r.partners;
        });

        let { b1, r } = candidates[0];
        const allCollisions = this._collectSubtreeCollisions(b1, state).filter(
            (c) => c?.overlapBranch?.nodeId === b1.nodeId
        );
        const selfHits = this._sumCollisionHits(allCollisions) || r.hits;
        return {
            b1,
            collidingBranch: r.collidingBranch,
            overlapBranch: b1,
            overlapMinIdx: r.overlapMinIdx,
            overlapMaxIdx: r.overlapMaxIdx,
            isLeafBody: r.isLeafBody,
            allCollisions,
            initialTotalHits: selfHits,
            score: selfHits,
            targetX: b1.path.samples[0].x,
            targetY: b1.path.samples[0].y,
        };
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
                for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
                    if (!s[k]) continue;
                    if (this._pointHitsBranch(bd, b2, s[k], k)) {
                        hits++;
                        if (k < minI) minI = k;
                        if (k > maxI) maxI = k;
                    }
                }
                let leafBodyHit = false;
                if (bd.isLeaf && bd.leafData) {
                    for (const pt of this._leafProbePointsFromBranch(bd)) {
                        if (this._pointHitsBranch(bd, b2, pt, -1)) {
                            hits += 3;
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
            for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
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
                    if (this._isDescendant(bd, b2)) continue;
                    if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, k)) return true;
                }
            }
            if (bd.isLeaf && bd.leafData) {
                for (const pt of this._leafProbePointsFromBranch(bd)) {
                    const dx = pt.x - cx, dy = pt.y - cy;
                    const rx = cx + dx * cos - dy * sin;
                    const ry = cy + dx * sin + dy * cos;
                    for (let j = 0; j < allBranches.length; j++) {
                        if (priorContacts.has(j)) continue;
                        const b2 = allBranches[j];
                        if (descSet.has(b2)) continue;
                        if (!b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (this._isDescendant(bd, b2)) continue;
                        if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, -1)) return true;
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

    _currentSelfHits(state) {
        const branch = this.target?.b1;
        if (!branch) return 0;
        return this._scoreSelf(branch, state.allBranches).hits;
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
                for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
                    if (!s[k]) continue;
                    if (this._pointHitsBranch(bd, b2, s[k], k)) return true;
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

        if (this._isTipChildBranch(b, state)) {
            const tipCap = deg2rad(20);
            maxPos = Math.min(maxPos, tipCap);
            maxNeg = Math.min(maxNeg, tipCap);
            // Tip branches must be allowed to search both ways around current pose.
            // Do not further clamp by parent-side bias here.
            return { maxPos, maxNeg };
        }

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
            for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
                const pt = s[k];
                if (!pt) continue;
                const dx = pt.x - cx, dy = pt.y - cy;
                const rx = cx + dx * cos - dy * sin;
                const ry = cy + dx * sin + dy * cos;
                for (const b2 of allBranches) {
                    if (descSet.has(b2) || !b2.path2d) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, k)) { hits++; break; }
                }
            }
            // Also check EXTERNAL samples inside descendant's rotated polygon
            // (catches crossings where the external branch enters the descendant)
            if (bd.path2d) {
                for (const b2 of allBranches) {
                    if (descSet.has(b2) || !b2.path?.samples) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    const s2 = b2.path.samples;
                    for (let k = this._sampleProbeStart(b2); k < s2.length; k++) {
                        if (!s2[k]) continue;
                        // Inverse-rotate external point to test against descendant's original path
                        const dx2 = s2[k].x - cx, dy2 = s2[k].y - cy;
                        const irx = cx + dx2 * cos + dy2 * sin;
                        const iry = cy - dx2 * sin + dy2 * cos;
                        if (this._pointHitsBranch(b2, bd, { x: irx, y: iry }, k)) { hits++; break; }
                    }
                }
            }
            if (bd.isLeaf && bd.leafData) {
                for (const pt of this._leafProbePointsFromBranch(bd)) {
                    const dx = pt.x - cx, dy = pt.y - cy;
                    const rx = cx + dx * cos - dy * sin;
                    const ry = cy + dx * sin + dy * cos;
                    let ptHits = 0;
                    for (const b2 of allBranches) {
                        if (descSet.has(b2) || !b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, -1)) { ptHits++; break; }
                    }
                    hits += ptHits * 3;
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

    _getPriorContacts(descendants, allBranches) {
        const descSet = new Set(descendants);
        const prior = new Map();
        for (const bd of descendants) {
            const hits = new Set();
            if (!bd.path?.samples) continue;
            const s = bd.path.samples;
            for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
                const pt = s[k];
                if (!pt) continue;
                for (let j = 0; j < allBranches.length; j++) {
                    const b2 = allBranches[j];
                    if (descSet.has(b2) || !b2.path2d) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (this._pointHitsBranch(bd, b2, pt, k)) hits.add(b2.nodeId);
                }
            }
            if (bd.path2d) {
                for (const b2 of allBranches) {
                    if (descSet.has(b2) || !b2.path?.samples) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    const s2 = b2.path.samples;
                    for (let k = this._sampleProbeStart(b2); k < s2.length; k++) {
                        if (!s2[k]) continue;
                        if (this._pointHitsBranch(b2, bd, s2[k], k)) hits.add(b2.nodeId);
                    }
                }
            }
            if (bd.isLeaf && bd.leafData) {
                for (const pt of this._leafProbePointsFromBranch(bd)) {
                    for (let j = 0; j < allBranches.length; j++) {
                        const b2 = allBranches[j];
                        if (descSet.has(b2) || !b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (this._pointHitsBranch(bd, b2, pt, -1)) hits.add(b2.nodeId);
                    }
                }
            }
            prior.set(bd.nodeId, hits);
        }
        return prior;
    }

    _checkValidAngle(descendants, enforceZeroNode, allBranches, totalAngle, pivot, priorContacts) {
        const cos = Math.cos(totalAngle);
        const sin = Math.sin(totalAngle);
        const cx = pivot.x, cy = pivot.y;
        const descSet = new Set(descendants);

        for (const bd of descendants) {
            const isTargetZero = enforceZeroNode && (bd.nodeId === enforceZeroNode.nodeId);
            const prior = priorContacts.get(bd.nodeId) || new Set();

            if (!bd.path?.samples) continue;
            const s = bd.path.samples;

            for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
                const pt = s[k];
                if (!pt) continue;
                const dx = pt.x - cx, dy = pt.y - cy;
                const rx = cx + dx * cos - dy * sin;
                const ry = cy + dx * sin + dy * cos;
                for (let j = 0; j < allBranches.length; j++) {
                    const b2 = allBranches[j];
                    if (descSet.has(b2) || !b2.path2d) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (this._isDescendant(bd, b2)) continue;
                    if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, k)) {
                        if (isTargetZero) return false;
                        if (!prior.has(b2.nodeId)) return false;
                    }
                }
            }
            if (bd.path2d) {
                for (let j = 0; j < allBranches.length; j++) {
                    const b2 = allBranches[j];
                    if (descSet.has(b2) || !b2.path?.samples) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (this._isDescendant(bd, b2)) continue;
                    const s2 = b2.path.samples;
                    for (let k = this._sampleProbeStart(b2); k < s2.length; k++) {
                        if (!s2[k]) continue;
                        const dx2 = s2[k].x - cx, dy2 = s2[k].y - cy;
                        const irx = cx + dx2 * cos + dy2 * sin;
                        const iry = cy - dx2 * sin + dy2 * cos;
                        if (this._pointHitsBranch(b2, bd, { x: irx, y: iry }, k)) {
                            if (isTargetZero) return false;
                            if (!prior.has(b2.nodeId)) return false;
                        }
                    }
                }
            }
            if (bd.isLeaf && bd.leafData) {
                for (const pt of this._leafProbePointsFromBranch(bd)) {
                    const dx = pt.x - cx, dy = pt.y - cy;
                    const rx = cx + dx * cos - dy * sin;
                    const ry = cy + dx * sin + dy * cos;
                    for (let j = 0; j < allBranches.length; j++) {
                        const b2 = allBranches[j];
                        if (descSet.has(b2) || !b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (this._isDescendant(bd, b2)) continue;
                        if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, -1)) {
                            if (isTargetZero) return false;
                            if (!prior.has(b2.nodeId)) return false;
                        }
                    }
                }
            }
        }
        return true;
    }

    _findShortestZeroCollisionAngle(descendants, enforceZeroNode, allBranches, pivot, maxPos, maxNeg, priorContacts) {
        const step = deg2rad(5);
        let validAngles = [];

        for (let a = 0; a <= maxPos + 0.001; a += step) {
            if (this._checkValidAngle(descendants, enforceZeroNode, allBranches, a, pivot, priorContacts)) {
                validAngles.push({ angle: a, dir: 1, dist: a });
            }
        }
        for (let a = step; a <= maxNeg + 0.001; a += step) {
            if (this._checkValidAngle(descendants, enforceZeroNode, allBranches, -a, pivot, priorContacts)) {
                validAngles.push({ angle: a, dir: -1, dist: a });
            }
        }

        if (validAngles.length === 0) return { success: false, hits: Infinity, angle: 0, dir: 1 };

        validAngles.sort((a, b) => a.dist - b.dist);
        const best = validAngles[0];
        return { success: true, angle: best.angle, dir: best.dir, hits: 0 };
    }

    _snapshot(branches) {
        return branches.map(b => ({
            left: b.path?.left?.map(p => ({ x: p.x, y: p.y })),
            right: b.path?.right?.map(p => ({ x: p.x, y: p.y })),
            samples: b.path?.samples?.map(p => p ? { x: p.x, y: p.y } : null),
            tipX: b.path?.tipX, tipY: b.path?.tipY,
            tipNormX: b.path?.tipNormX, tipNormY: b.path?.tipNormY,
            tipTangentAngle: b.path?.tipTangentAngle,
            leafData: b.leafData ? { ...b.leafData } : null,
        }));
    }

    _restore(branches, snap) {
        for (let i = 0; i < branches.length; i++) {
            const bd = branches[i];
            const pre = snap[i];
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

    _flipTree(descendants, pivot, nx, ny, axisAngle) {
        const reflectPt = (p) => {
            if (!p) return;
            const dx = p.x - pivot.x, dy = p.y - pivot.y;
            const dot = dx * nx + dy * ny;
            p.x = pivot.x + 2 * dot * nx - dx;
            p.y = pivot.y + 2 * dot * ny - dy;
        };

        for (const bd of descendants) {
            if (bd.path?.samples) for (const p of bd.path.samples) reflectPt(p);
            if (bd.path?.left) for (const p of bd.path.left) reflectPt(p);
            if (bd.path?.right) for (const p of bd.path.right) reflectPt(p);
            if (bd.path) {
                const tip = { x: bd.path.tipX, y: bd.path.tipY };
                reflectPt(tip);
                bd.path.tipX = tip.x; bd.path.tipY = tip.y;
                const tn = { x: pivot.x + bd.path.tipNormX, y: pivot.y + bd.path.tipNormY };
                reflectPt(tn);
                bd.path.tipNormX = tn.x - pivot.x; bd.path.tipNormY = tn.y - pivot.y;
                bd.path.tipTangentAngle = 2 * axisAngle - bd.path.tipTangentAngle;
                const tmpEdge = bd.path.left;
                bd.path.left = bd.path.right;
                bd.path.right = tmpEdge;
            }
            if (bd.leafData) {
                const lp = { x: bd.leafData.x, y: bd.leafData.y };
                reflectPt(lp);
                bd.leafData.x = lp.x; bd.leafData.y = lp.y;
                bd.leafData.angle = 2 * axisAngle - bd.leafData.angle + Math.PI;
            }
            rebuildPath2d(bd);
        }
    }

    _getFlipAxis(element, state) {
        let pId = this._parentMap.get(element.nodeId);
        let parentBr = pId != null ? state.allBranches.find(b => b.nodeId === pId) : null;
        if (!parentBr || !parentBr.path?.samples || parentBr.path.samples.length <= 1) return null;
        let pivot = element.path.samples[0];
        let closestIdx = 0, closestDist = Infinity;
        for (let i = 0; i < parentBr.path.samples.length; i++) {
            const ps = parentBr.path.samples[i];
            if (!ps) continue;
            const d = Math.hypot(ps.x - pivot.x, ps.y - pivot.y);
            if (d < closestDist) { closestDist = d; closestIdx = i; }
        }
        const ps1 = parentBr.path.samples[closestIdx];
        const ps2 = parentBr.path.samples[Math.min(closestIdx + 3, parentBr.path.samples.length - 1)];
        if (!ps1 || !ps2 || (ps1.x === ps2.x && ps1.y === ps2.y)) return null;
        const ax = ps2.x - ps1.x, ay = ps2.y - ps1.y;
        const alen = Math.hypot(ax, ay);
        const nx = ax / alen, ny = ay / alen;
        return { nx, ny, axisAngle: Math.atan2(ny, nx) };
    }

    _rotatoflip(element, state) {
        if (!element?.path?.samples?.length) return { success: false };
        const descendants = this._buildDescendants(element, state);
        const pivot = element.path.samples[0];
        const maxA = deg2rad(90);
        const { maxPos, maxNeg } = this._calcLimitsToParent(element, state, maxA);
        const originalSide = this._branchSideAgainstParentAxis(element, state);

        const priorContacts = this._getPriorContacts(descendants, state.allBranches);
        const bestRot = this._findShortestZeroCollisionAngle(
            descendants, element, state.allBranches, pivot, maxPos, maxNeg, priorContacts
        );
        if (bestRot.success) return { success: true, angle: bestRot.angle * bestRot.dir, flip: false };

        const axis = this._getFlipAxis(element, state);
        if (axis) {
            const preFlip = this._snapshot(descendants);
            this._flipTree(descendants, pivot, axis.nx, axis.ny, axis.axisAngle);
            const flippedSide = this._branchSideAgainstParentAxis(element, state);
            if (originalSide !== 0 && flippedSide !== 0 && flippedSide === originalSide) {
                this._restore(descendants, preFlip);
                return { success: false };
            }

            const flipRot = this._findShortestZeroCollisionAngle(
                descendants, element, state.allBranches, pivot, maxPos, maxNeg, priorContacts
            );
            this._restore(descendants, preFlip);

            if (flipRot.success) {
                return { success: true, angle: flipRot.angle * flipRot.dir, flip: true, flipAxis: axis };
            }
        }
        return { success: false };
    }

    _rotatoflip2(actor, primary, state) {
        if (!actor?.path?.samples?.length) return { success: false };
        const actorDescendants = this._buildDescendants(actor, state);
        const actorPivot = actor.path.samples[0];
        const maxA = deg2rad(90);
        const { maxPos: aMaxPos, maxNeg: aMaxNeg } = this._calcLimitsToParent(actor, state, maxA);

        const step = deg2rad(5);
        const axis = this._getFlipAxis(actor, state);
        let actorPriorContacts = this._getPriorContacts(actorDescendants, state.allBranches);

        let validPlans = [];
        const tryCombination = (actorAngle, isFlip) => {
            const preActor = this._snapshot(actorDescendants);

            if (isFlip && axis) {
                this._flipTree(actorDescendants, actorPivot, axis.nx, axis.ny, axis.axisAngle);
            }
            if (actorAngle !== 0) {
                this._rotateBranchTree(actorDescendants, actorAngle, actorPivot);
            }

            // check if actor move is valid (no NEW collisions for anyone, enforceZero=null)
            let isActorValid = this._checkValidAngle(actorDescendants, null, state.allBranches, 0, actorPivot, actorPriorContacts);

            let primarySol = { success: false };
            if (isActorValid) {
                primarySol = this._rotatoflip(primary, state);
            }

            this._restore(actorDescendants, preActor);

            if (primarySol.success) {
                validPlans.push({
                    actorAngle,
                    actorFlip: isFlip,
                    actorFlipAxis: axis,
                    primarySol,
                    dist: Math.abs(actorAngle) + Math.abs(primarySol.angle) + (isFlip ? deg2rad(30) : 0) // slight penalty for flips
                });
            }
        };

        for (let a = 0; a <= aMaxPos + 0.001; a += step) tryCombination(a, false);
        for (let a = step; a <= aMaxNeg + 0.001; a += step) tryCombination(-a, false);

        if (axis) {
            for (let a = 0; a <= aMaxPos + 0.001; a += step) tryCombination(a, true);
            for (let a = step; a <= aMaxNeg + 0.001; a += step) tryCombination(-a, true);
        }

        if (validPlans.length > 0) {
            validPlans.sort((a, b) => a.dist - b.dist);
            return {
                success: true,
                actorAngle: validPlans[0].actorAngle,
                actorFlip: validPlans[0].actorFlip,
                actorFlipAxis: validPlans[0].actorFlipAxis,
                primarySol: validPlans[0].primarySol
            };
        }
        return { success: false };
    }

    * _solveCollisionWorker(primary, state) {
        const primaryExternalHits = this._sumCollisionHits(this._collectSubtreeCollisions(primary, state));
        if (primaryExternalHits <= 0) {
            // Mark exhausted so we don't re-pick this branch endlessly
            this.exhaustedNodes.add(primary.nodeId);
            this.testedActorId = null;
            yield `Primary n${primary.nodeId} has no external collisions (child-only/internal). Exhausting.`;
            return;
        }

        const primaryPartners = this._getSelfCollisionPartners(primary, state);
        const hasAncestorPartner = primaryPartners.some((p) => this._isDescendant(p, primary));

        yield `Primary: n${primary.nodeId} trying rotatoflipping`;
        let sol = this._rotatoflip(primary, state);
        if (sol.success) {
            this.fixPlan = { primary, primarySol: sol };
            return;
        }

        yield `primary: n${primary.nodeId} rotatoflipping failed`;

        if (hasAncestorPartner) {
            // Mark exhausted so we don't loop on it
            this.exhaustedNodes.add(primary.nodeId);
            this.testedActorId = null;
            yield `Primary n${primary.nodeId} collides with ancestor; parent movement blocked. Exhausting.`;
            return;
        }

        let parentId = this._parentMap.get(primary.nodeId);
        while (parentId != null) {
            let parent = state.allBranches.find(b => b.nodeId === parentId);
            if (!parent || parent.depth === 0) break;

            yield `primary n${primary.nodeId} escalated to n${parent.nodeId}`;
            // Highlight the escalated parent in green even while just testing
            this.testedActorId = parent.nodeId;

            let sol2 = this._rotatoflip2(parent, primary, state);
            if (sol2.success) {
                this.fixPlan = { actor: parent, actorSol: sol2, primary, primarySol: sol2.primarySol };
                return;
            }
            parentId = this._parentMap.get(parentId);
        }
        yield `Escalation fails`;

        yield `primary: n${primary.nodeId} Trying neighboring`;
        let pId = this._parentMap.get(primary.nodeId);
        let siblings = state.allBranches.filter(b => b.nodeId !== primary.nodeId && this._parentMap.get(b.nodeId) === pId);
        for (let sib of siblings) {
            // Highlight sibling in green while testing
            this.testedActorId = sib.nodeId;
            yield `primary n${primary.nodeId} trying sibling n${sib.nodeId}`;
            let sol2 = this._rotatoflip2(sib, primary, state);
            if (sol2.success) {
                this.fixPlan = { actor: sib, actorSol: sol2, primary, primarySol: sol2.primarySol };
                return;
            }
        }
        yield `neighboring failed`;

        this.exhaustedNodes.add(primary.nodeId);
        this.testedActorId = null;
    }

    // ── Leaf Sliding Logic ─────────────────────────────────────────────
    _countCollisionsAtTranslation(descendants, allBranches, dx, dy) {
        const descSet = new Set(descendants);
        let hits = 0;
        for (const bd of descendants) {
            if (!bd.path?.samples) continue;
            const s = bd.path.samples;
            for (let k = this._sampleProbeStart(bd); k < s.length; k++) {
                const pt = s[k];
                if (!pt) continue;
                const rx = pt.x + dx;
                const ry = pt.y + dy;
                for (const b2 of allBranches) {
                    if (descSet.has(b2) || !b2.path2d) continue;
                    if (this._areAdjacent(bd, b2)) continue;
                    if (this._pointHitsBranch(bd, b2, { x: rx, y: ry }, k)) { hits++; break; }
                }
            }
            if (bd.isLeaf && bd.leafData) {
                const shiftedLeaf = { ...bd.leafData, x: bd.leafData.x + dx, y: bd.leafData.y + dy };
                for (const pt of getLeafProbePoints(shiftedLeaf)) {
                    let ptHits = 0;
                    for (const b2 of allBranches) {
                        if (descSet.has(b2) || !b2.path2d) continue;
                        if (this._areAdjacent(bd, b2)) continue;
                        if (this._pointHitsBranch(bd, b2, pt, -1)) { ptHits++; break; }
                    }
                    hits += ptHits * 3;
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
        this._cascadeNeeds.clear();
        this.rebuildJob = null;
        this.rebuildRayPhase = 0;
        this.elongateJob = null;
        this.primaryNodeId = null;
        this._elongationFailedFor.clear();
        this._buildParentMap(state.tree);
        for (const b of state.allBranches) {
            b.isHighlightWhite = false;
            b.isHighlightGreen = false;
            rebuildPath2d(b);
        }
    }

    stop(state) {
        this.active = false;
        this.exhaustedNodes.clear();
        this._cascadeNeeds.clear();
        this.rebuildJob = null;
        this.rebuildRayPhase = 0;
        this.elongateJob = null;
        this.primaryNodeId = null;
        this.testedActorId = null;
        this._elongationFailedFor.clear();
        for (const b of state.allBranches) { if (b) { b.isHighlightWhite = false; b.isHighlightGreen = false; } }
        this.target = null;
    }

    //  Main update (called every animation frame) 
    update(state) {
        if (!this.active) return false;

        // ── SCANNING ─────────────────────────────────────────────────────────
        if (this.state === "SCANNING") {
            for (const b of state.allBranches) {
                b.isHighlightWhite = false;
                b.isHighlightGreen = false;
            }

            let best = this._findBestTarget(state);
            if (best) {
                this.target = best;
                this._setPrimaryNode(best.b1.nodeId);
                this.state = "FLYING";
                this.triedBothDirs = false;
                best.b1.isHighlightWhite = true;
                this.currentRule = `Primary ${this._label(this.target.b1)} ${this.target.b1.nodeId} selected. trying rotation first (${this.target.score} hits).`;
            } else {
                this.target = null;
                this._setPrimaryNode(null);
                this.state = "IDLE";
                this.active = false;
                this.currentRule = this._hasAnyCollisions(state)
                    ? "No resolvable collisions left with current exhausted set. Waiting for another action."
                    : "No collisions left to fix. Agent entering scan sleep.";
            }

            //  FLYING: glide toward the pivot of the worst branch 
        } else if (this.state === "FLYING") {
            const perch = this._targetPerchPoint(this.target);
            const dx = perch.x - this.x;
            const dy = perch.y - this.y;
            const dist = Math.hypot(dx, dy);
            this.pupilAngle = Math.atan2(perch.fy - this.y, perch.fx - this.x);

            if (dist < 6) {
                // ─── ARRIVED ──────────────────────────────────────────────────────
                this.thinker = this._solveCollisionWorker(this.target.b1, state);
                this.thinkerDelay = 10;
                this.fixPlan = null;
                this.state = "THINKING";
            } else {
                const speed = Math.min(dist * 0.06, 4);
                this.x += (dx / dist) * speed;
                this.y += (dy / dist) * speed;
            }

        } else if (this.state === "THINKING") {
            if (this.thinkerDelay > 0) {
                this.thinkerDelay--;
                return true;
            }

            let res;
            try {
                res = this.thinker.next();
            } catch (e) {
                this.currentRule = "Rule: ERROR: " + e.message;
                this.target = null;
                this.state = "SCANNING";
                console.error("Thinker error:", e);
                return true;
            }
            if (!res.done) {
                this.currentRule = "Rule: " + res.value;
                if (res.value) {
                    const textStr = String(res.value).toLowerCase();
                    for (let b of state.allBranches) { b.isHighlightWhite = false; b.isHighlightGreen = false; }

                    let numbers = res.value.match(/n?\d+/g);
                    if (textStr.includes("escalated to")) {
                        let p1 = res.value.split("escalated to");
                        let pIdStr = p1[0].match(/\d+/)?.[0];
                        let aIdStr = p1[1].match(/\d+/)?.[0];
                        let brP = state.allBranches.find(b => b.nodeId == Number(pIdStr));
                        let brA = state.allBranches.find(b => b.nodeId == Number(aIdStr));
                        if (brP) brP.isHighlightWhite = true;
                        if (brA) brA.isHighlightGreen = true;
                    } else if (numbers && numbers.length > 0) {
                        let primaryId = numbers[0].replace('n', '');
                        let brP = state.allBranches.find(b => b.nodeId == Number(primaryId));
                        if (brP) brP.isHighlightWhite = true;

                        if (this.testedActorId) {
                            let brA = state.allBranches.find(b => b.nodeId == this.testedActorId);
                            if (brA) brA.isHighlightGreen = true;
                        }
                    }
                }
                this.thinkerDelay = 40; // UI pause
            } else {
                if (this.fixPlan) {
                    this.state = "APPLYING_SOLUTION";
                    this.animActorProgress = 0;
                    this.animPrimaryProgress = 0;

                    if (this.fixPlan.actor && this.fixPlan.actorSol.actorFlip && this.fixPlan.actorSol.actorFlipAxis) {
                        const actorDesc = this._buildDescendants(this.fixPlan.actor, state);
                        const pivot = this.fixPlan.actor.path.samples[0];
                        const axis = this.fixPlan.actorSol.actorFlipAxis;
                        this._flipTree(actorDesc, pivot, axis.nx, axis.ny, axis.axisAngle);
                    }
                    if (this.fixPlan.primarySol.flip && this.fixPlan.primarySol.flipAxis) {
                        const primaryDesc = this._buildDescendants(this.fixPlan.primary, state);
                        const pivot = this.fixPlan.primary.path.samples[0];
                        const axis = this.fixPlan.primarySol.flipAxis;
                        this._flipTree(primaryDesc, pivot, axis.nx, axis.ny, axis.axisAngle);
                    }
                    this._refreshOverlap(state); // Ensure geometry update
                } else {
                    if (this.target && this.target.b1) this.target.b1.isHighlightWhite = false;
                    this.target = null;
                    this.state = "SCANNING";
                }
            }

        } else if (this.state === "APPLYING_SOLUTION") {
            const stepRad = deg2rad(1); // Rotation speed per frame

            let actorDone = true;
            if (this.fixPlan.actor && this.fixPlan.actorSol) {
                const targetA = this.fixPlan.actorSol.actorAngle;
                const diffA = targetA - this.animActorProgress;
                if (Math.abs(diffA) > 0.005) {
                    actorDone = false;
                    const step = Math.sign(diffA) * Math.min(stepRad, Math.abs(diffA));
                    this.animActorProgress += step;
                    const pivot = this.fixPlan.actor.path.samples[0];
                    const desc = this._buildDescendants(this.fixPlan.actor, state);
                    this._rotateBranchTree(desc, step, pivot);
                }
            }

            let primaryDone = true;
            if (this.fixPlan.primarySol) {
                if (actorDone) {
                    const targetP = this.fixPlan.primarySol.angle;
                    const diffP = targetP - this.animPrimaryProgress;
                    if (Math.abs(diffP) > 0.005) {
                        primaryDone = false;
                        const step = Math.sign(diffP) * Math.min(stepRad, Math.abs(diffP));
                        this.animPrimaryProgress += step;
                        const pivot = this.fixPlan.primary.path.samples[0];
                        const desc = this._buildDescendants(this.fixPlan.primary, state);
                        this._rotateBranchTree(desc, step, pivot);
                    }
                } else {
                    primaryDone = false;
                }
            }

            this._refreshOverlap(state); // make sure canvas sees the rotation in progress

            if (actorDone && primaryDone) {
                this.madeProgress = true;
                // Action done, clear exhausted list!
                this.exhaustedNodes.clear();

                if (this.target && this.target.b1) this.target.b1.isHighlightWhite = false;
                this.target = null;
                this.state = "SCANNING";
                this.testedActorId = null;
            }
        } else if (this.state === "ELONGATING") {
            this._tickElongating(state);
        } else if (this.state === "REBUILDING") {
            this._tickRebuildJob(state);
        }

        this._updateHighlights(state);
        return true;
    }

    _updateHighlights(state) {
        for (const b of state.allBranches) {
            if (b) {
                b.isHighlightWhite = false;
                b.isHighlightGreen = false;
            }
        }
        if (this.target) {
            let primaryId = (this.primaryNodeId ?? this.target?.escalatedFrom ?? this.target?.opensFor ?? null);
            let secondaryId = this.target?.b1 ? this.target.b1.nodeId : null;

            if (primaryId && secondaryId && primaryId !== secondaryId) {
                const p = state.allBranches.find(b => b.nodeId === primaryId);
                const s = state.allBranches.find(b => b.nodeId === secondaryId);
                if (p) p.isHighlightWhite = true;
                if (s) s.isHighlightGreen = true;
            } else if (secondaryId) {
                const s = state.allBranches.find(b => b.nodeId === secondaryId);
                if (s) s.isHighlightWhite = true;
            } else if (primaryId) {
                const p = state.allBranches.find(b => b.nodeId === primaryId);
                if (p) p.isHighlightWhite = true;
            }

            if (this.testedActorId && !this.fixPlan) {
                const s = state.allBranches.find(b => b.nodeId === this.testedActorId);
                if (s) s.isHighlightGreen = true;
            }
        }
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

        if (this.state === "REBUILDING") {
            const t = this.rebuildRayPhase;
            const focus = this._targetFocusPoint(this.target);
            const aim = Math.atan2(focus.y - this.y, focus.x - this.x);
            const dist = Math.hypot(focus.x - this.x, focus.y - this.y);
            const rayCount = 14;
            const spread = 0.6;
            const pupilX = Math.cos(aim) * 4;
            const pupilY = Math.sin(aim) * 4;
            for (let i = 0; i < rayCount; i++) {
                const u = rayCount <= 1 ? 0.5 : i / (rayCount - 1);
                const a = aim + (u - 0.5) * spread + Math.sin(t * 1.2 + i * 0.4) * 0.03;
                const flicker = 0.7 + 0.3 * Math.sin(t * 3 + i);
                const r0 = 2.5;
                const r1 = Math.max(18, Math.min(dist + 10, 75)) * (0.86 + 0.14 * flicker);
                ctx.beginPath();
                ctx.moveTo(pupilX + Math.cos(a) * r0, pupilY + Math.sin(a) * r0);
                ctx.lineTo(pupilX + Math.cos(a) * r1, pupilY + Math.sin(a) * r1);
                ctx.strokeStyle = `rgba(255, 220, 90, ${0.2 + 0.26 * flicker})`;
                ctx.lineWidth = 1.1;
                ctx.stroke();
            }
        }

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
