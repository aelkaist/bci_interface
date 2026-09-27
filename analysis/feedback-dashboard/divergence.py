"""Observer-divergence metrics - pure functions, no I/O and no plotting.

Every number the Observer Divergence panel shows is computed here or in
``05_divergence.py``; the Dash callbacks only read precomputed values. That
split is what makes the metrics unit-testable (``tests/test_divergence.py``)
and what keeps the panel from silently recomputing a score when a filter moves.

Units and conventions
---------------------
* An **interval** is an inclusive integer frame range ``(start, end)`` with
  ``start <= end``. Its length is ``end - start + 1`` frames, so a single-frame
  interval has length 1 rather than 0 - a Jaccard over point intervals then
  stays defined instead of collapsing to 0/0.
* Two intervals are **adjacent** when ``a.end + 1 == b.start``; adjacent and
  overlapping intervals of the *same* observer are merged before any metric
  runs, so one observer marking 10-20 and 21-30 counts as one 10-30 span.
* ``FRAME_DURATION_SEC`` is the canonical playback step of the study player
  (``overcook_simulation/src/App.jsx:128``, ``FRAME_DURATION = 0.42``), *not*
  2 fps, and *not* anything derived from the 40/60/80/100 tail of the
  trajectory filename. Seconds are ``frame * FRAME_DURATION_SEC``.
* Every ``*_map`` function reports raw convergence *and* the
  divergence-oriented ``1 - x`` form, so the UI never has to guess a direction.
"""

from __future__ import annotations

import math
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

Interval = Tuple[int, int]
Timeline = List[Interval]

# --------------------------------------------------------------- constants ---

# Playback step of the data-collection player. Verified in
# overcook_simulation/src/App.jsx:128 (FRAME_DURATION = 0.42); seed_player uses
# 0.45 but that is a standalone preview tool, not the study client.
FRAME_DURATION_SEC = 0.42

# Every one of the 108 study trajectories has exactly 201 dynamicState entries,
# i.e. frame indices 0..200 (checked against analysis/dashboard/seeds/).
TOTAL_FRAMES = 201

# Design constant: each trajectory is shown to exactly 8 assigned observers, so
# the COTC denominator is a fixed 7 peers rather than "however many were active".
N_ASSIGNED_OBSERVERS = 8

# Sensitivity mode turns a range-free item into baseFrame +/- this many seconds.
SENSITIVITY_HALF_WIDTH_SEC = 2.0

# An interval is flagged "long" in the diagnostics once it spans more than this
# fraction of the trajectory. Diagnostic only - it never weights a metric.
LONG_INTERVAL_FRACTION = 0.25

DIMS: Tuple[int, ...] = (1, 2, 3, 4, 5)

METRICS: Tuple[str, ...] = ("cotc", "tjac", "smid", "jsd")
MODES: Tuple[str, ...] = ("primary", "sensitivity")

# Human-facing names, kept next to the keys so the panel and the build script
# cannot drift apart.
METRIC_LABEL: Dict[str, str] = {
    "cotc": "1 - Cross-Observer Temporal Coverage",
    "tjac": "1 - Pairwise Temporal Jaccard",
    "smid": "Shared-Moment Interpretive Divergence",
    "jsd": "Observer-Profile Jensen-Shannon Divergence",
}
METRIC_SHORT: Dict[str, str] = {
    "cotc": "COTC divergence",
    "tjac": "Temporal Jaccard divergence",
    "smid": "SMID",
    "jsd": "Profile JSD",
}
# Metrics whose stored score is a convergence measure the UI flips to 1 - x.
METRIC_IS_FLIPPED: Dict[str, bool] = {
    "cotc": True, "tjac": True, "smid": False, "jsd": False,
}
MODE_LABEL: Dict[str, str] = {
    "primary": "Primary · ranged items only",
    "sensitivity": "Sensitivity · range-free items as baseFrame ±%gs"
                   % SENSITIVITY_HALF_WIDTH_SEC,
}

BANDS: Tuple[str, ...] = ("low", "mid", "high")
BAND_LABEL: Dict[str, str] = {"low": "Low divergence", "mid": "Mid divergence",
                              "high": "High divergence"}


# ----------------------------------------------------------------- frames ----

def frames_for_seconds(seconds: float,
                       frame_duration: float = FRAME_DURATION_SEC) -> int:
    """Seconds -> whole frames, rounded half-up.

    At the canonical 0.42 s/frame, +/-2 s is +/-5 frames. It would be +/-4 only
    if the player ran at exactly 2 fps, which it does not.
    """
    if frame_duration <= 0:
        raise ValueError("frame_duration must be positive")
    return int(math.floor(abs(seconds) / frame_duration + 0.5))


def seconds_of_frame(frame: float,
                     frame_duration: float = FRAME_DURATION_SEC) -> float:
    return float(frame) * frame_duration


SENSITIVITY_HALF_WIDTH_FRAMES = frames_for_seconds(SENSITIVITY_HALF_WIDTH_SEC)


def clamp_interval(start: int, end: int,
                   total_frames: int = TOTAL_FRAMES) -> Optional[Interval]:
    """Order and clip an interval to the trajectory; None if it falls outside."""
    lo, hi = (int(start), int(end)) if start <= end else (int(end), int(start))
    lo = max(lo, 0)
    hi = min(hi, total_frames - 1)
    if lo > hi:
        return None
    return (lo, hi)


def base_frame_window(base_frame: int,
                      half_width_frames: int = SENSITIVITY_HALF_WIDTH_FRAMES,
                      total_frames: int = TOTAL_FRAMES) -> Optional[Interval]:
    """Range-free item -> baseFrame +/- window, cut at trajectory boundaries."""
    return clamp_interval(base_frame - half_width_frames,
                          base_frame + half_width_frames, total_frames)


# -------------------------------------------------------------- intervals ----

def interval_frames(start: int, end: int) -> int:
    """Inclusive frame count of one interval."""
    return int(end) - int(start) + 1


def merge_intervals(intervals: Iterable[Interval]) -> Timeline:
    """Sort, then fuse overlapping *and* adjacent intervals into one timeline.

    Adjacency is fused too (``(0, 4)`` + ``(5, 9)`` -> ``(0, 9)``): on a
    discrete frame grid those describe one uninterrupted stretch of attention,
    and leaving them apart would understate every overlap downstream.
    """
    items = sorted((min(int(s), int(e)), max(int(s), int(e)))
                   for s, e in intervals)
    out: Timeline = []
    for s, e in items:
        if out and s <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def timeline_frames(timeline: Sequence[Interval]) -> int:
    """Total frames covered by an already-merged timeline."""
    return sum(interval_frames(s, e) for s, e in timeline)


def intersection_frames(a: Sequence[Interval], b: Sequence[Interval]) -> int:
    """Frames covered by both merged timelines."""
    total, i, j = 0, 0, 0
    while i < len(a) and j < len(b):
        lo = max(a[i][0], b[j][0])
        hi = min(a[i][1], b[j][1])
        if lo <= hi:
            total += interval_frames(lo, hi)
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return total


def union_frames(a: Sequence[Interval], b: Sequence[Interval]) -> int:
    """Frames covered by either merged timeline (inclusion-exclusion)."""
    return timeline_frames(a) + timeline_frames(b) - intersection_frames(a, b)


def timeline_contains(timeline: Sequence[Interval], frame: int) -> bool:
    return any(s <= frame <= e for s, e in timeline)


# ------------------------------------------------------------------- COTC ----
#
# Cross-Observer Temporal Coverage. "When observer o flagged this moment, how
# many of the other 7 assigned observers had that same moment inside one of
# their own marked windows?"
#
# The focal anchor is always the item's *stored* baseFrame - never a repaired
# one. 253 of the 1,595 ranged items have a baseFrame outside their own
# start/end window (the player let people drag the window off the anchor), and
# silently snapping those would invent data.

def cotc_item(base_frame: int,
              peer_timelines: Dict[str, Sequence[Interval]],
              n_assigned: int = N_ASSIGNED_OBSERVERS) -> Tuple[float, List[str]]:
    """One focal item -> (covering peers / (n_assigned - 1), covering peers).

    The denominator is the number of *assigned* peers, so an observer who
    submitted nothing usable in this mode counts as a non-covering peer instead
    of vanishing from the denominator.
    """
    matched = sorted(obs for obs, tl in peer_timelines.items()
                     if timeline_contains(tl, base_frame))
    denom = max(n_assigned - 1, 1)
    return min(len(matched) / float(denom), 1.0), matched


def _mean(values: Sequence[float]) -> Optional[float]:
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return float(sum(vals)) / len(vals)


def cotc_map(anchors: Dict[str, Sequence[dict]],
             timelines: Dict[str, Sequence[Interval]],
             n_assigned: int = N_ASSIGNED_OBSERVERS) -> dict:
    """Map-level COTC.

    ``anchors``   observer -> items, each ``{"key": ..., "base_frame": int}``
    ``timelines`` observer -> merged timeline (same observer set, may be empty)

    Aggregation is item -> focal observer -> map, so an observer who wrote six
    items does not outvote one who wrote one.
    """
    per_item: List[dict] = []
    per_observer: Dict[str, Optional[float]] = {}
    for obs in sorted(timelines):
        scores = []
        peers = {o: tl for o, tl in timelines.items() if o != obs}
        for item in anchors.get(obs, ()):
            score, matched = cotc_item(item["base_frame"], peers, n_assigned)
            scores.append(score)
            per_item.append({"observer": obs, "key": item.get("key"),
                             "base_frame": int(item["base_frame"]),
                             "covered": len(matched),
                             "denominator": max(n_assigned - 1, 1),
                             "score": score, "matched_peers": matched})
        per_observer[obs] = _mean(scores) if scores else None

    raw = _mean([v for v in per_observer.values() if v is not None])
    return {
        "raw": raw,
        "divergence": None if raw is None else 1.0 - raw,
        "n_focal_observers": sum(1 for v in per_observer.values()
                                 if v is not None),
        "n_focal_items": len(per_item),
        "per_observer": per_observer,
        "per_item": per_item,
    }


# ------------------------------------------------- pairwise temporal Jaccard --

def temporal_jaccard(a: Sequence[Interval],
                     b: Sequence[Interval]) -> Optional[float]:
    """Frame-level Jaccard of two merged timelines.

    Both empty -> ``None`` (undefined; the pair is dropped from the mean rather
    than scored as perfect agreement about nothing). Exactly one empty -> 0.0,
    which is a real disagreement: one observer marked moments, the other none.
    """
    if not a and not b:
        return None
    union = union_frames(a, b)
    if union == 0:
        return None
    return min(intersection_frames(a, b) / float(union), 1.0)


def temporal_jaccard_map(timelines: Dict[str, Sequence[Interval]]) -> dict:
    """All unordered observer pairs (28 for 8 observers) -> mean valid Jaccard."""
    observers = sorted(timelines)
    pairs: List[dict] = []
    for i, oa in enumerate(observers):
        for ob in observers[i + 1:]:
            a, b = timelines[oa], timelines[ob]
            score = temporal_jaccard(a, b)
            pairs.append({
                "a": oa, "b": ob,
                "intersection": intersection_frames(a, b),
                "union": union_frames(a, b),
                "a_frames": timeline_frames(a), "b_frames": timeline_frames(b),
                "score": score,
            })
    valid = [p["score"] for p in pairs if p["score"] is not None]
    raw = _mean(valid)
    return {
        "raw": raw,
        "divergence": None if raw is None else 1.0 - raw,
        "n_pairs": len(pairs),
        "n_valid_pairs": len(valid),
        "pairs": pairs,
    }


# ----------------------------------------------------- semantic code distance --

def code_set_jaccard_distance(a: Iterable[str],
                              b: Iterable[str]) -> Optional[float]:
    """1 - |A n B| / |A u B| for one dimension; None when both sets are empty.

    Both empty means the dimension carries no information about either item, so
    it is dropped from the macro-average. One empty is a genuine distance of 1.
    """
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return None
    union = sa | sb
    return 1.0 - len(sa & sb) / float(len(union))


def code_distance(codes_a: Dict[int, Iterable[str]],
                  codes_b: Dict[int, Iterable[str]],
                  dims: Sequence[int] = DIMS
                  ) -> Tuple[Optional[float], Dict[int, Optional[float]]]:
    """Macro-average of the per-dimension code-set Jaccard distances."""
    per_dim: Dict[int, Optional[float]] = {}
    for d in dims:
        per_dim[d] = code_set_jaccard_distance(codes_a.get(d, ()),
                                              codes_b.get(d, ()))
    return _mean([v for v in per_dim.values() if v is not None]), per_dim


# ------------------------------------------------------------------- SMID ----
#
# Shared-Moment Interpretive Divergence: hold the *moment* fixed and ask how
# differently two observers coded it. The focal anchor is the stored baseFrame;
# the peer side is matched by its interval, so "same moment" means "the peer
# had this frame inside a window they marked".

def nearest_peer_item(base_frame: int,
                      peer_items: Sequence[dict]) -> Optional[dict]:
    """Peer item whose interval contains ``base_frame``, nearest anchor first.

    Ties break deterministically on interval length, then feedback index, then
    docId - the order given in the spec - so the same input always yields the
    same match regardless of dict or file ordering.
    """
    cands = [it for it in peer_items
             if it["start"] <= base_frame <= it["end"]]
    if not cands:
        return None
    return min(cands, key=lambda it: (
        abs(int(it["base_frame"]) - int(base_frame)),
        interval_frames(it["start"], it["end"]),
        int(it.get("index") or 0),
        str(it.get("doc_id") or ""),
    ))


def smid_map(items_by_observer: Dict[str, Sequence[dict]],
             dims: Sequence[int] = DIMS,
             n_assigned: int = N_ASSIGNED_OBSERVERS) -> dict:
    """Map-level SMID plus its per-dimension breakdown and match bookkeeping.

    ``items_by_observer`` observer -> items with ``base_frame``, ``start``,
    ``end``, ``codes`` (dim -> iterable of codes), ``index``, ``doc_id``, ``key``.

    Aggregation: item -> directed observer pair (focal o, peer p) -> peers
    available to o -> focal observers.
    """
    observers = sorted(items_by_observer)
    matches: List[dict] = []
    per_pair: Dict[Tuple[str, str], dict] = {}
    n_focal_items = 0
    n_attempted = 0

    for focal in observers:
        for item in items_by_observer.get(focal, ()):
            n_focal_items += 1
            for peer in observers:
                if peer == focal:
                    continue
                n_attempted += 1
                hit = nearest_peer_item(item["base_frame"],
                                        items_by_observer.get(peer, ()))
                if hit is None:
                    continue
                dist, per_dim = code_distance(item["codes"], hit["codes"], dims)
                if dist is None:
                    # Neither item carries a code in any dimension: nothing to
                    # compare, so it is not a match for scoring purposes.
                    continue
                rec = {"focal": focal, "peer": peer,
                       "focal_key": item.get("key"), "peer_key": hit.get("key"),
                       "base_frame": int(item["base_frame"]),
                       "peer_base_frame": int(hit["base_frame"]),
                       "peer_start": int(hit["start"]), "peer_end": int(hit["end"]),
                       "distance": dist,
                       "per_dim": {int(d): per_dim[d] for d in dims}}
                matches.append(rec)
                per_pair.setdefault((focal, peer), {"distances": [],
                                                   "per_dim": {d: [] for d in dims}})
                per_pair[(focal, peer)]["distances"].append(dist)
                for d in dims:
                    if per_dim[d] is not None:
                        per_pair[(focal, peer)]["per_dim"][d].append(per_dim[d])

    # directed pair -> focal observer -> map
    by_focal: Dict[str, List[float]] = {}
    by_focal_dim: Dict[int, Dict[str, List[float]]] = {d: {} for d in dims}
    pair_rows: List[dict] = []
    for (focal, peer), agg in sorted(per_pair.items()):
        pair_score = _mean(agg["distances"])
        pair_rows.append({"focal": focal, "peer": peer, "score": pair_score,
                          "n_items": len(agg["distances"]),
                          "per_dim": {int(d): _mean(agg["per_dim"][d])
                                      for d in dims}})
        by_focal.setdefault(focal, []).append(pair_score)
        for d in dims:
            v = _mean(agg["per_dim"][d])
            if v is not None:
                by_focal_dim[d].setdefault(focal, []).append(v)

    per_observer = {o: _mean(v) for o, v in sorted(by_focal.items())}
    score = _mean([v for v in per_observer.values() if v is not None])
    per_dim_score: Dict[int, Optional[float]] = {}
    for d in dims:
        focal_means = [_mean(v) for v in by_focal_dim[d].values()]
        per_dim_score[int(d)] = _mean([v for v in focal_means if v is not None])

    n_directed = n_assigned * (n_assigned - 1)
    return {
        "score": score,
        "per_dim": per_dim_score,
        "n_matched_items": len(matches),
        "n_focal_items": n_focal_items,
        "n_matched_directed_pairs": len(pair_rows),
        "n_directed_pairs": n_directed,
        "match_rate": (len(matches) / float(n_attempted)) if n_attempted else None,
        "per_observer": per_observer,
        "pairs": pair_rows,
        "matches": matches,
    }


# -------------------------------------------- observer-profile JS divergence --

def normalize_profile(counts: Dict[str, float]) -> Dict[str, float]:
    """Code counts -> probabilities summing to 1 inside one dimension."""
    total = float(sum(counts.values()))
    if total <= 0:
        return {}
    return {k: v / total for k, v in counts.items() if v}


def _entropy2(probs: Iterable[float]) -> float:
    return -sum(p * math.log2(p) for p in probs if p > 0)


def jsd_base2(p: Dict[str, float], q: Dict[str, float]) -> Optional[float]:
    """Base-2 Jensen-Shannon divergence: 0 for identical, 1 for disjoint."""
    if not p or not q:
        return None
    keys = set(p) | set(q)
    mix = [(p.get(k, 0.0) + q.get(k, 0.0)) / 2.0 for k in keys]
    val = (_entropy2(mix)
           - 0.5 * _entropy2(p.get(k, 0.0) for k in keys)
           - 0.5 * _entropy2(q.get(k, 0.0) for k in keys))
    return min(max(val, 0.0), 1.0)


def profile_jsd_pair(prof_a: Dict[int, Dict[str, float]],
                     prof_b: Dict[int, Dict[str, float]],
                     dims: Sequence[int] = DIMS
                     ) -> Tuple[Optional[float], Dict[int, Optional[float]]]:
    """Macro-average base-2 JSD over the dimensions both observers populate."""
    per_dim: Dict[int, Optional[float]] = {}
    for d in dims:
        per_dim[d] = jsd_base2(prof_a.get(d) or {}, prof_b.get(d) or {})
    return _mean([v for v in per_dim.values() if v is not None]), per_dim


def profile_jsd_map(profiles: Dict[str, Dict[int, Dict[str, float]]],
                    dims: Sequence[int] = DIMS) -> dict:
    """All unordered observer pairs -> mean macro-averaged base-2 JSD."""
    observers = sorted(profiles)
    pairs: List[dict] = []
    for i, oa in enumerate(observers):
        for ob in observers[i + 1:]:
            score, per_dim = profile_jsd_pair(profiles[oa], profiles[ob], dims)
            pairs.append({"a": oa, "b": ob, "score": score,
                          "per_dim": {int(d): per_dim[d] for d in dims}})
    valid = [p["score"] for p in pairs if p["score"] is not None]
    per_dim_score = {int(d): _mean([p["per_dim"][int(d)] for p in pairs
                                    if p["per_dim"][int(d)] is not None])
                     for d in dims}
    return {
        "score": _mean(valid),
        "per_dim": per_dim_score,
        "n_pairs": len(pairs),
        "n_valid_pairs": len(valid),
        "pairs": pairs,
        "profiles": profiles,
    }


# ------------------------------------------------------------------ bands ----

def band_thresholds(scores: Iterable[float]) -> Optional[Tuple[float, float]]:
    """Global q33 / q67 of a metric's whole-corpus distribution.

    Linear-interpolated quantiles over the finite scores, computed once over all
    108 maps per (metric, mode) and then frozen: a band must not move because
    the user narrowed a filter.
    """
    vals = sorted(float(s) for s in scores
                  if s is not None and math.isfinite(float(s)))
    if not vals:
        return None

    def q(frac: float) -> float:
        if len(vals) == 1:
            return vals[0]
        pos = frac * (len(vals) - 1)
        lo = int(math.floor(pos))
        hi = min(lo + 1, len(vals) - 1)
        return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)

    return q(1.0 / 3.0), q(2.0 / 3.0)


def band_of(score: Optional[float],
            thresholds: Optional[Tuple[float, float]]) -> Optional[str]:
    """score < q33 -> low, q33 <= score < q67 -> mid, score >= q67 -> high."""
    if score is None or thresholds is None or not math.isfinite(float(score)):
        return None
    q33, q67 = thresholds
    if score < q33:
        return "low"
    if score < q67:
        return "mid"
    return "high"
