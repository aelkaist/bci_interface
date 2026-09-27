"""Phase 5 - observer divergence: normalise, join, validate, score every map.

Reads the two raw sources, joins them on the composite feedback key, then
computes the four divergence metrics for all 108 trajectories in both analysis
modes and writes three artefacts the dashboard reads:

    data/divergence_maps.parquet     one row per (trajectory, mode): scores,
                                     divergence bands and quality diagnostics
    data/divergence_detail.json.gz   per-map observer lanes, feedback items and
                                     the four metric inspectors
    data/divergence_report.json      join validation, unmatched/duplicate report,
                                     frozen band thresholds, config provenance

Nothing here is recomputed at request time: the panel reads these files, so a
filter change can never silently move a score or a threshold.

Usage:  python 05_divergence.py [--json PATH] [--xlsx PATH]

Paths default to the copies inside the repository and can be overridden with
--json / --xlsx or with the DIVERGENCE_JSON / FEEDBACK_XLSX environment
variables, matching how 01_preprocess.py resolves its workbook.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple

import pandas as pd

import divergence as dv
from codebook import CODE_NAME, DIMS

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

DEFAULT_JSON = os.environ.get(
    "DIVERGENCE_JSON",
    os.path.join(REPO, "analysis", "dashboard", "data", "main-all.json"))
DEFAULT_XLSX = os.environ.get(
    "FEEDBACK_XLSX",
    os.path.join(REPO, "analysis", "data", "feedback_100%_labeled.xlsx"))
SEEDS_DIR = os.path.join(REPO, "analysis", "dashboard", "seeds")

OUT_DIR = os.path.join(HERE, "data")
OUT_MAPS = os.path.join(OUT_DIR, "divergence_maps.parquet")
OUT_DETAIL = os.path.join(OUT_DIR, "divergence_detail.json.gz")
OUT_REPORT = os.path.join(OUT_DIR, "divergence_report.json")

WIDE_SHEET = 0            # the check-mark sheet: 27 binary code columns
REASONS_SHEET = "Reasons"  # tidy long format: confidence / partial / reason

# Expected values from the build spec. Reported, and a mismatch is loud, but
# nothing is asserted away - the report keeps whatever the data actually says.
EXPECT = {
    "participants": 216, "episode_observations": 864, "trajectories": 108,
    "observers_per_trajectory": 8, "feedback_items": 1746,
    "ranged_items": 1595, "range_free_items": 151,
    "labeled_rows_joined": 1746, "unmatched_rows": 0,
    "cells": 12, "maps_per_cell": 9,
}

GROUP_NORMAL = {"low": "low", "l": "low",
                "mid": "mid", "middle": "mid", "medium": "mid", "m": "mid",
                "high": "high", "h": "high"}


# ------------------------------------------------------------ normalisation ---

def norm_text(value) -> str:
    """Join-key form of a feedback string.

    NFKC, curly quotes folded to ASCII, whitespace collapsed, case-folded. The
    two sources went through different export paths, so the key has to be
    insensitive to exactly those cosmetic differences and to nothing else.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    s = unicodedata.normalize("NFKC", str(value))
    for a, b in (("’", "'"), ("‘", "'"), ("“", '"'),
                 ("”", '"'), ("–", "-"), ("—", "-"),
                 (" ", " ")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip().lower()


def norm_group(value) -> str:
    """participant.group -> low / mid / high ('Middle' and 'Mid' both -> mid)."""
    key = str(value or "").strip().lower()
    return GROUP_NORMAL.get(key, key)


def policy_of(layout_name: str) -> str:
    """forced / incentivized, read off the layout name."""
    ln = str(layout_name or "")
    if "_forced" in ln:
        return "forced"
    if "_incentivized" in ln:
        return "incentivized"
    return "unknown"


def agent_count_of(layout_name: str) -> int:
    """4 only when the layout name *ends with* '_4'.

    Testing for a stray '4' anywhere in the filename would misclassify every
    seed4 / _4020000_ / _40 trajectory, which is most of the corpus.
    """
    return 4 if str(layout_name or "").endswith("_4") else 2


def trajectory_total_frames(file_name: str) -> Optional[int]:
    """Frame count from the trajectory file itself - never from the filename.

    The 40/60/80/100 tail is a condition label, not a duration; the real length
    is len(dynamicState) in the seed JSON.
    """
    path = os.path.join(SEEDS_DIR, file_name)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as fh:
            return len(json.load(fh).get("dynamicState") or []) or None
    except (ValueError, OSError):
        return None


# -------------------------------------------------------------- JSON source ---

def load_json_side(path: str) -> Tuple[pd.DataFrame, dict]:
    """main-all.json -> one row per feedback item, plus a structural report.

    Only ``episodes[].feedbackItems`` is read. The participant-level
    ``feedbackItems`` array is a flattened duplicate of exactly those items and
    is deliberately not aggregated - counting both would double every total.
    """
    with open(path) as fh:
        raw = json.load(fh)

    rows: List[dict] = []
    episodes: List[dict] = []
    dup_top_level = 0
    for pid, participant in raw.items():
        group = norm_group(participant.get("group"))
        dup_top_level += len(participant.get("feedbackItems") or [])
        for ep in participant.get("episodes") or []:
            file_name = ep.get("fileName") or ""
            layout = ep.get("layoutName") or ""
            episodes.append({
                "pid": pid, "traj_id": file_name,
                "traj": os.path.basename(file_name),
                "layout_name": layout,
                "performance_group": group,
                "policy": policy_of(layout),
                "agent_count": agent_count_of(layout),
                "monitoring_difficulty": ep.get("monitoringDifficulty"),
                "collaboration_rating": ep.get("collaborationRating"),
            })
            for order, item in enumerate(ep.get("feedbackItems") or []):
                did = bool(item.get("DidSpecifyRange"))
                start, end = item.get("startFrame"), item.get("endFrame")
                has_range = did and start is not None and end is not None
                rows.append({
                    "pid": pid, "traj_id": file_name,
                    "traj": os.path.basename(file_name),
                    "layout_name": layout,
                    "performance_group": group,
                    "policy": policy_of(layout),
                    "agent_count": agent_count_of(layout),
                    "doc_id": item.get("docId"),
                    "item_index": item.get("index"),
                    "json_order": order,
                    "feedback": item.get("feedback") or "",
                    "reason": item.get("reason") or "",
                    "sentiment": int(item.get("sentiment") or 0),
                    "did_specify_range": did,
                    "start_frame": None if start is None else int(start),
                    "end_frame": None if end is None else int(end),
                    "base_frame": int(item.get("baseFrame") or 0),
                    "has_range": has_range,
                    "txt": norm_text(item.get("feedback")),
                })

    J = pd.DataFrame(rows)
    # Occurrence index inside a duplicate composite key, in JSON array order:
    # a few participants submitted byte-identical feedback twice for the same
    # trajectory and those are separate submissions, not one row to dedupe.
    J = J.sort_values(["pid", "traj_id", "json_order"], kind="mergesort")
    J["occ"] = J.groupby(["pid", "traj", "txt", "sentiment"]).cumcount()

    E = pd.DataFrame(episodes)
    report = {
        "participants": int(len(raw)),
        "episode_observations": int(len(E)),
        "trajectories": int(E["traj_id"].nunique()),
        "feedback_items": int(len(J)),
        "participant_level_feedback_items_ignored": int(dup_top_level),
        "ranged_items": int(J["has_range"].sum()),
        "range_free_items": int((~J["has_range"]).sum()),
        "duplicate_key_occurrences": int((J["occ"] > 0).sum()),
        "observers_per_trajectory": {
            "min": int(E.groupby("traj_id")["pid"].nunique().min()),
            "max": int(E.groupby("traj_id")["pid"].nunique().max()),
        },
    }
    return J.reset_index(drop=True), (E, report)


# ------------------------------------------------------------- Excel source ---

def wide_code_columns(raw: pd.DataFrame) -> Dict[int, str]:
    """Column index -> taxonomy code for the 27 binary check-mark columns.

    The sheet carries a three-row header: dimension group, mid-level code, leaf
    code. A column's code is the leaf label when it has one and the mid-level
    label otherwise ('1.2 Task Resources / Env' has no leaf row, '1.3 Other'
    has neither), so the identity always comes from the sheet rather than from
    a hard-coded column order.
    """
    mid, leaf = raw.iloc[1], raw.iloc[2]
    out: Dict[int, str] = {}
    for col in range(5, raw.shape[1]):
        label = leaf[col] if isinstance(leaf[col], str) and leaf[col].strip() \
            else mid[col]
        if not isinstance(label, str) or not label.strip():
            continue
        code = label.split()[0]
        if code in CODE_NAME:
            out[col] = code
    return out


def load_excel_side(path: str) -> Tuple[pd.DataFrame, dict]:
    """Workbook -> one row per labelled feedback with D1-D5 code sets.

    Codes come from the first sheet's 27 binary columns (the spec's source of
    truth); confidence / partial_codes / reason come from the Reasons sheet and
    are carried for the inspector only - they never weight a metric.
    """
    raw = pd.read_excel(path, sheet_name=WIDE_SHEET, header=None)
    colcode = wide_code_columns(raw)
    body = raw.iloc[3:].reset_index(drop=True)

    rows: List[dict] = []
    for i in range(len(body)):
        codes = {d: [] for d in DIMS}
        for col, code in colcode.items():
            if isinstance(body.iat[i, col], str) and body.iat[i, col].strip():
                codes[int(code.split(".")[0])].append(code)
        rows.append({
            "pid": str(body.iat[i, 0]).strip(),
            "excel_group": norm_group(body.iat[i, 1]),
            "traj": str(body.iat[i, 2]).strip(),
            "sentiment": int(body.iat[i, 3]),
            "txt": norm_text(body.iat[i, 4]),
            "excel_row": i,
            **{"d%d_codes" % d: " ".join(sorted(codes[d])) for d in DIMS},
        })
    X = pd.DataFrame(rows)
    # Excel row order is the tie-breaker inside a duplicate key, mirroring the
    # JSON side's array order so the two occurrences pair up 1:1.
    X["occ"] = X.groupby(["pid", "traj", "txt", "sentiment"]).cumcount()

    reasons = pd.read_excel(path, sheet_name=REASONS_SHEET)
    reasons["pid"] = reasons["participant_id"].astype(str).str.strip()
    reasons["traj"] = reasons["trajectory_name"].astype(str).str.strip()
    reasons["sentiment"] = reasons["feedback_score"].astype(int)
    reasons["txt"] = reasons["feedback"].map(norm_text)
    reasons["dimension"] = reasons["dimension"].astype(int)
    reasons["occ"] = reasons.groupby(
        ["pid", "traj", "txt", "sentiment", "dimension"]).cumcount()
    for col in ("confidence", "partial_codes", "reason", "codes"):
        reasons[col] = reasons[col].fillna("").astype(str).str.strip()

    key = ["pid", "traj", "txt", "sentiment", "occ"]
    for d in DIMS:
        sub = reasons[reasons["dimension"] == d].set_index(key)
        for col, out in (("confidence", "conf"), ("partial_codes", "partial"),
                         ("reason", "reason"), ("codes", "reasons_codes")):
            X["d%d_%s" % (d, out)] = pd.MultiIndex.from_frame(
                X[key]).map(sub[col]).fillna("")

    # Cross-check: the wide sheet and the Reasons sheet must agree on codes.
    disagree = {}
    for d in DIMS:
        a = X["d%d_codes" % d].fillna("")
        b = X["d%d_reasons_codes" % d].fillna("").map(
            lambda s: " ".join(sorted(str(s).split())))
        n = int((a != b).sum())
        if n:
            disagree["d%d" % d] = n
    report = {
        "wide_sheet_rows": int(len(X)),
        "wide_code_columns": len(colcode),
        "reasons_sheet_rows": int(len(reasons)),
        "duplicate_key_occurrences": int((X["occ"] > 0).sum()),
        "wide_vs_reasons_code_disagreements": disagree,
        "code_counts": {code: int(sum(
            code in s.split() for s in X["d%d_codes" % int(code.split(".")[0])]))
            for code in sorted(set(colcode.values()))},
    }
    return X.drop(columns=["d%d_reasons_codes" % d for d in DIMS]), report


# -------------------------------------------------------------------- join ---

JOIN_KEY = ["pid", "traj", "txt", "sentiment", "occ"]


def join_sources(J: pd.DataFrame, X: pd.DataFrame) -> Tuple[pd.DataFrame, dict]:
    """Composite-key join with an explicit unmatched / duplicate report.

    Key = participant_id + basename(fileName) + normalised feedback text +
    sentiment(=feedback_score) + occurrence index inside the duplicate key.
    """
    merged = J.merge(X, on=JOIN_KEY, how="outer", indicator=True,
                     suffixes=("", "_x"))
    both = merged[merged["_merge"] == "both"].copy()
    only_json = merged[merged["_merge"] == "left_only"]
    only_excel = merged[merged["_merge"] == "right_only"]

    def sample(frame: pd.DataFrame) -> List[dict]:
        cols = [c for c in ("pid", "traj", "sentiment", "occ", "doc_id",
                            "excel_row") if c in frame.columns]
        return frame[cols].head(25).to_dict("records")

    group_mismatch = both[both["performance_group"] != both["excel_group"]]
    report = {
        "join_key": "participant_id + basename(fileName) + normalized_text + "
                    "sentiment/feedback_score + occurrence_index",
        "json_rows": int(len(J)),
        "excel_rows": int(len(X)),
        "joined_rows": int(len(both)),
        "unmatched_json_rows": int(len(only_json)),
        "unmatched_excel_rows": int(len(only_excel)),
        "unmatched_rows": int(len(only_json) + len(only_excel)),
        "duplicate_key_groups": int(
            (J.groupby(["pid", "traj", "txt", "sentiment"]).size() > 1).sum()),
        "duplicate_key_extra_occurrences": int((J["occ"] > 0).sum()),
        "group_mismatches_json_vs_excel": int(len(group_mismatch)),
        "unmatched_json_sample": sample(only_json),
        "unmatched_excel_sample": sample(only_excel),
    }
    both = both.drop(columns=["_merge"])
    return both.reset_index(drop=True), report


# ----------------------------------------------------------- per-map records ---

def observer_labels(pids: List[str]) -> Dict[str, str]:
    """Stable anonymised lane label per map: sorted participant id -> O1..O8."""
    return {pid: "O%d" % (i + 1) for i, pid in enumerate(sorted(pids))}


def build_items(rows: pd.DataFrame, labels: Dict[str, str], mode: str,
                total_frames: int) -> Dict[str, List[dict]]:
    """Observer -> items usable in ``mode``, in submission order.

    primary      only items with DidSpecifyRange and a start/end pair.
    sensitivity  the same, plus range-free items widened to baseFrame +/- 2 s
                 and cut at the trajectory boundary.

    The stored baseFrame is carried through untouched in both modes: it is the
    focal anchor for COTC and SMID even when it sits outside the item's own
    window, which happens for 253 of the 1,595 ranged items.
    """
    out: Dict[str, List[dict]] = {labels[p]: [] for p in labels}
    for _, r in rows.sort_values(["pid", "json_order"],
                                 kind="mergesort").iterrows():
        obs = labels.get(r["pid"])
        if obs is None:                 # not on this map's assigned roster
            continue
        if r["has_range"]:
            span = dv.clamp_interval(int(r["start_frame"]), int(r["end_frame"]),
                                     total_frames)
            derived = False
        elif mode == "sensitivity":
            span = dv.base_frame_window(int(r["base_frame"]),
                                        dv.SENSITIVITY_HALF_WIDTH_FRAMES,
                                        total_frames)
            derived = True
        else:
            continue
        if span is None:
            continue
        codes = {d: sorted(str(r["d%d_codes" % d] or "").split()) for d in DIMS}
        out[obs].append({
            "key": "%s#%s" % (obs, r["doc_id"]),
            "observer": obs,
            "doc_id": r["doc_id"],
            "index": int(r["item_index"] or 0),
            "order": int(r["json_order"]),
            "base_frame": int(r["base_frame"]),
            "start": span[0], "end": span[1],
            "derived_range": derived,
            "base_outside_range": not (span[0] <= int(r["base_frame"]) <= span[1]),
            "long_interval": dv.interval_frames(*span)
            > dv.LONG_INTERVAL_FRACTION * total_frames,
            "sentiment": int(r["sentiment"]),
            "feedback": str(r["feedback"]),
            "reason": str(r["reason"]),
            "codes": codes,
            "conf": {d: str(r["d%d_conf" % d] or "") for d in DIMS},
            "partial": {d: str(r["d%d_partial" % d] or "") for d in DIMS},
            "coding_reason": {d: str(r["d%d_reason" % d] or "") for d in DIMS},
        })
    return out


def code_profiles(items_by_observer: Dict[str, List[dict]]
                  ) -> Dict[str, Dict[int, Dict[str, float]]]:
    """Observer -> dimension -> normalised code-frequency profile."""
    out: Dict[str, Dict[int, Dict[str, float]]] = {}
    for obs, items in items_by_observer.items():
        prof: Dict[int, Dict[str, float]] = {}
        for d in DIMS:
            counts: Counter = Counter()
            for it in items:
                counts.update(it["codes"][d])
            norm = dv.normalize_profile(dict(counts))
            if norm:
                prof[d] = norm
        out[obs] = prof
    return out


def covering_intervals(timeline, frame) -> List[List[int]]:
    return [[s, e] for s, e in timeline if s <= frame <= e]


def score_map(traj_id: str, rows: pd.DataFrame, mode: str, total_frames: int,
              assigned_pids: List[str], meta: dict) -> Tuple[dict, dict]:
    """All four metrics for one trajectory in one mode -> (summary, detail).

    ``assigned_pids`` comes from the episode table, not from the feedback rows:
    5 of the 864 episode-observations carry no feedback at all, and those
    observers were still assigned the map. Deriving the roster from submitted
    feedback would silently shrink a lane count to 7 and inflate every
    per-observer mean.
    """
    labels = observer_labels(assigned_pids)
    items = build_items(rows, labels, mode, total_frames)
    timelines = {obs: dv.merge_intervals((it["start"], it["end"])
                                        for it in its)
                 for obs, its in items.items()}
    anchors = {obs: [{"key": it["key"], "base_frame": it["base_frame"]}
                     for it in its] for obs, its in items.items()}

    cotc = dv.cotc_map(anchors, timelines)
    tjac = dv.temporal_jaccard_map(timelines)
    smid = dv.smid_map(items)
    profiles = code_profiles(items)
    jsd = dv.profile_jsd_map(profiles)

    # Which merged peer interval actually covered each anchor - the COTC
    # inspector shows the evidence, not just the count.
    item_pos = {it["key"]: it for its in items.values() for it in its}
    for rec in cotc["per_item"]:
        rec["peer_intervals"] = {
            peer: covering_intervals(timelines[peer], rec["base_frame"])
            for peer in rec["matched_peers"]}

    used = [it for its in items.values() for it in its]
    active = sorted(o for o, its in items.items() if its)
    dim_cov = {int(d): int(sum(1 for it in used if it["codes"][d]))
               for d in DIMS}

    summary = {
        "traj_id": traj_id,
        "traj": os.path.basename(traj_id),
        "layout_name": meta["layout_name"],
        "performance_group": meta["performance_group"],
        "policy": meta["policy"],
        "agent_count": int(meta["agent_count"]),
        "mode": mode,
        "total_frames": total_frames,
        "n_assigned_observers": len(labels),
        "n_active_observers": len(active),
        "n_items_total": int(len(rows)),
        "n_items_used": len(used),
        "n_ranged_items": int(rows["has_range"].sum()),
        "n_range_free_items": int((~rows["has_range"]).sum()),
        "n_base_outside_range": sum(1 for it in used if it["base_outside_range"]),
        "n_long_intervals": sum(1 for it in used if it["long_interval"]),
        "cotc_raw": cotc["raw"],
        "cotc": cotc["divergence"],
        "cotc_focal_observers": cotc["n_focal_observers"],
        "cotc_focal_items": cotc["n_focal_items"],
        "tjac_raw": tjac["raw"],
        "tjac": tjac["divergence"],
        "tjac_valid_pairs": tjac["n_valid_pairs"],
        "tjac_pairs": tjac["n_pairs"],
        "smid": smid["score"],
        "smid_matched_items": smid["n_matched_items"],
        "smid_matched_directed_pairs": smid["n_matched_directed_pairs"],
        "smid_directed_pairs": smid["n_directed_pairs"],
        "smid_match_rate": smid["match_rate"],
        "jsd": jsd["score"],
        "jsd_valid_pairs": jsd["n_valid_pairs"],
        "jsd_pairs": jsd["n_pairs"],
    }
    for d in DIMS:
        summary["smid_d%d" % d] = smid["per_dim"][d]
        summary["jsd_d%d" % d] = jsd["per_dim"][d]
        summary["dim_coverage_d%d" % d] = dim_cov[d]

    detail = {
        "traj_id": traj_id,
        "mode": mode,
        "observers": [
            {"observer": labels[pid],
             "n_items": len(items[labels[pid]]),
             "active": bool(items[labels[pid]]),
             "timeline": [list(iv) for iv in timelines[labels[pid]]],
             "frames_covered": dv.timeline_frames(timelines[labels[pid]])}
            for pid in sorted(labels)],
        "items": [{k: v for k, v in it.items() if k != "codes"}
                  | {"codes": {str(d): it["codes"][d] for d in DIMS}}
                  for it in sorted(used, key=lambda x: (x["observer"], x["order"]))],
        "cotc": {"raw": cotc["raw"], "divergence": cotc["divergence"],
                 "per_observer": cotc["per_observer"],
                 "per_item": cotc["per_item"]},
        "tjac": {"raw": tjac["raw"], "divergence": tjac["divergence"],
                 "pairs": tjac["pairs"]},
        "smid": {"score": smid["score"], "per_dim": {str(d): smid["per_dim"][d]
                                                     for d in DIMS},
                 "per_observer": smid["per_observer"],
                 "pairs": smid["pairs"], "matches": smid["matches"]},
        "jsd": {"score": jsd["score"], "per_dim": {str(d): jsd["per_dim"][d]
                                                   for d in DIMS},
                "pairs": jsd["pairs"],
                "profiles": {o: {str(d): p for d, p in prof.items()}
                             for o, prof in profiles.items()}},
        "highlights": _highlights(cotc["per_item"], item_pos),
        "code_summary": _code_summary(used),
    }
    return summary, detail


def _highlights(per_item: List[dict], item_pos: Dict[str, dict],
                k: int = 2) -> List[dict]:
    """The k most widely shared anchors - the hover preview's sample feedback.

    One per observer where possible: two items from the same person say less
    about a map than two people describing the same moment.
    """
    ranked = sorted(per_item, key=lambda r: (-r["covered"], r["observer"],
                                             r["base_frame"]))
    picked, seen = [], set()
    for rec in ranked:
        if rec["observer"] not in seen:
            picked.append(rec)
            seen.add(rec["observer"])
        if len(picked) >= k:
            break
    for rec in ranked:                  # top up if fewer than k observers wrote
        if len(picked) >= k:
            break
        if rec not in picked:
            picked.append(rec)

    out = []
    for rec in picked[:k]:
        it = item_pos.get(rec["key"])
        if it is None:
            continue
        out.append({"observer": rec["observer"], "covered": rec["covered"],
                    "denominator": rec["denominator"],
                    "base_frame": rec["base_frame"],
                    "sentiment": it["sentiment"],
                    "feedback": it["feedback"],
                    "codes": sorted(c for d in DIMS for c in it["codes"][d])})
    return out


def _code_summary(used: List[dict], k: int = 5) -> List[List]:
    counts: Counter = Counter()
    for it in used:
        for d in DIMS:
            counts.update(it["codes"][d])
    return [[c, n] for c, n in counts.most_common(k)]


# ------------------------------------------------------------------- driver ---

def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", default=DEFAULT_JSON, help="main-all.json")
    ap.add_argument("--xlsx", default=DEFAULT_XLSX, help="labelled workbook")
    args = ap.parse_args(argv)

    for label, path in (("JSON", args.json), ("workbook", args.xlsx)):
        if not os.path.exists(path):
            sys.exit("%s not found: %s" % (label, path))
    os.makedirs(OUT_DIR, exist_ok=True)

    print("json     %s" % args.json)
    print("workbook %s" % args.xlsx)

    J, (E, json_report) = load_json_side(args.json)
    X, excel_report = load_excel_side(args.xlsx)
    F, join_report = join_sources(J, X)

    # ---- trajectory frame counts, read from the trajectory files -------------
    frames = {t: trajectory_total_frames(t) for t in sorted(F["traj_id"].unique())}
    missing = [t for t, n in frames.items() if not n]
    frame_counts = Counter(n for n in frames.values() if n)
    for t in missing:
        frames[t] = dv.TOTAL_FRAMES

    # ---- design grid ---------------------------------------------------------
    grid = (E.drop_duplicates("traj_id")
             .groupby(["performance_group", "policy", "agent_count"])["traj_id"]
             .nunique())

    # ---- score every map in both modes --------------------------------------
    roster = {t: sorted(g["pid"].unique().tolist())
              for t, g in E.groupby("traj_id")}
    meta = {t: g.iloc[0][["layout_name", "performance_group", "policy",
                          "agent_count"]].to_dict()
            for t, g in E.groupby("traj_id")}
    silent = int((E.merge(F.groupby(["traj_id", "pid"]).size().rename("n"),
                          on=["traj_id", "pid"], how="left")["n"]
                  .isna()).sum())

    summaries: List[dict] = []
    details: Dict[str, dict] = defaultdict(dict)
    by_traj = dict(tuple(F.groupby("traj_id")))
    empty = F.iloc[0:0]
    for mode in dv.MODES:
        for traj_id in sorted(roster):
            s, d = score_map(traj_id, by_traj.get(traj_id, empty), mode,
                             frames[traj_id], roster[traj_id], meta[traj_id])
            summaries.append(s)
            details[traj_id][mode] = d
    M = pd.DataFrame(summaries)

    # ---- frozen global bands: whole corpus, per (metric, mode) --------------
    thresholds: Dict[str, Dict[str, Optional[List[float]]]] = {}
    for metric in dv.METRICS:
        thresholds[metric] = {}
        for mode in dv.MODES:
            vals = M.loc[M["mode"] == mode, metric].dropna().tolist()
            t = dv.band_thresholds(vals)
            thresholds[metric][mode] = None if t is None else [t[0], t[1]]
            band = [dv.band_of(v, t) for v in M.loc[M["mode"] == mode, metric]]
            M.loc[M["mode"] == mode, "%s_band" % metric] = band

    # ---- range and NaN guard ------------------------------------------------
    guard: Dict[str, dict] = {}
    for metric in dv.METRICS:
        col = M[metric]
        guard[metric] = {
            "n_missing": int(col.isna().sum()),
            "min": None if col.dropna().empty else float(col.min()),
            "max": None if col.dropna().empty else float(col.max()),
            "out_of_unit_range": int(((col < 0) | (col > 1)).sum()),
        }

    report = {
        "config": {
            "json": args.json, "xlsx": args.xlsx, "seeds_dir": SEEDS_DIR,
            "frame_duration_sec": dv.FRAME_DURATION_SEC,
            "frame_duration_source":
                "overcook_simulation/src/App.jsx:128 (FRAME_DURATION = 0.42)",
            "fps_implied": round(1.0 / dv.FRAME_DURATION_SEC, 4),
            "sensitivity_half_width_sec": dv.SENSITIVITY_HALF_WIDTH_SEC,
            "sensitivity_half_width_frames": dv.SENSITIVITY_HALF_WIDTH_FRAMES,
            "long_interval_fraction": dv.LONG_INTERVAL_FRACTION,
            "n_assigned_observers": dv.N_ASSIGNED_OBSERVERS,
            "trajectory_frame_counts": dict(frame_counts),
            "trajectories_missing_seed_file": missing,
        },
        "json_source": json_report,
        "excel_source": excel_report,
        "join": join_report,
        "coverage": {
            "episode_observations_without_feedback": silent,
            "note": "Those observers were assigned the map and keep a lane; "
                    "the roster comes from episodes[], never from submitted "
                    "feedback.",
        },
        "design_grid": {"cells": int(len(grid)),
                        "maps_per_cell": {"%s|%s|%d" % k: int(v)
                                          for k, v in grid.items()}},
        "expected": EXPECT,
        "score_guard": guard,
        "band_thresholds": thresholds,
        "band_rule": "score < q33 -> low, q33 <= score < q67 -> mid, "
                     "score >= q67 -> high; quantiles over all %d maps per "
                     "(metric, mode), frozen and never refit to a filter"
                     % M["traj_id"].nunique(),
    }

    # ---- checksums ----------------------------------------------------------
    print("\n" + "=" * 70)
    print("CHECKSUMS  (observed vs build spec)")
    print("=" * 70)

    def line(name, got, exp):
        mark = "ok " if exp is None or got == exp else "!! "
        print("  %s%-40s %6s   (spec %s)" % (mark, name, got, exp))

    line("participants", json_report["participants"], EXPECT["participants"])
    line("episode-observations", json_report["episode_observations"],
         EXPECT["episode_observations"])
    line("unique trajectories", json_report["trajectories"],
         EXPECT["trajectories"])
    line("observers per trajectory (min)",
         json_report["observers_per_trajectory"]["min"],
         EXPECT["observers_per_trajectory"])
    line("observers per trajectory (max)",
         json_report["observers_per_trajectory"]["max"],
         EXPECT["observers_per_trajectory"])
    line("feedback items", json_report["feedback_items"],
         EXPECT["feedback_items"])
    line("ranged items", json_report["ranged_items"], EXPECT["ranged_items"])
    line("range-free items", json_report["range_free_items"],
         EXPECT["range_free_items"])
    line("labeled rows joined", join_report["joined_rows"],
         EXPECT["labeled_rows_joined"])
    line("unmatched rows", join_report["unmatched_rows"],
         EXPECT["unmatched_rows"])
    line("design cells (group x policy x agents)", len(grid), EXPECT["cells"])
    line("maps per cell (all equal)",
         int(grid.min()) if len(grid) else 0, EXPECT["maps_per_cell"])
    print("  ok  participant-level feedbackItems ignored (duplicate): %d"
          % json_report["participant_level_feedback_items_ignored"])
    print("  ok  episode-observations with no feedback at all: %d "
          "(lanes kept, roster from episodes[])" % silent)
    print("  ok  duplicate composite keys: %d group(s), %d extra occurrence(s)"
          % (join_report["duplicate_key_groups"],
             join_report["duplicate_key_extra_occurrences"]))
    print("  %s  wide-vs-Reasons code disagreements: %s"
          % ("ok " if not excel_report["wide_vs_reasons_code_disagreements"]
             else "!! ", excel_report["wide_vs_reasons_code_disagreements"] or 0))
    print("  ok  trajectory frame counts (from seed files): %s"
          % dict(frame_counts))
    print("  ok  frame duration %.2fs  ->  %.3f fps  ->  +/-%gs = +/-%d frames"
          % (dv.FRAME_DURATION_SEC, 1.0 / dv.FRAME_DURATION_SEC,
             dv.SENSITIVITY_HALF_WIDTH_SEC, dv.SENSITIVITY_HALF_WIDTH_FRAMES))

    print("\n  metric ranges (must be within [0,1] with no NaN)")
    for metric in dv.METRICS:
        g = guard[metric]
        bad = g["n_missing"] or g["out_of_unit_range"]
        print("  %s%-8s min %.4f  max %.4f  missing %d  out-of-range %d"
              % ("!! " if bad else "ok ", metric, g["min"] or 0.0,
                 g["max"] or 0.0, g["n_missing"], g["out_of_unit_range"]))

    print("\n  divergence bands (global q33 / q67, frozen)")
    for metric in dv.METRICS:
        for mode in dv.MODES:
            t = thresholds[metric][mode]
            print("     %-6s %-12s q33 %.4f   q67 %.4f"
                  % (metric, mode, t[0], t[1]) if t else
                  "     %-6s %-12s (undefined)" % (metric, mode))
    print("=" * 70)

    # ---- write -------------------------------------------------------------
    M.to_parquet(OUT_MAPS, index=False)
    with gzip.open(OUT_DETAIL, "wt", encoding="utf-8") as fh:
        json.dump(details, fh, separators=(",", ":"))
    with open(OUT_REPORT, "w") as fh:
        json.dump(report, fh, indent=2, default=str)

    print("\nwrote %s  (%d rows x %d cols)" % (OUT_MAPS, len(M), M.shape[1]))
    print("wrote %s  (%.1f MB)"
          % (OUT_DETAIL, os.path.getsize(OUT_DETAIL) / 1e6))
    print("wrote %s" % OUT_REPORT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
