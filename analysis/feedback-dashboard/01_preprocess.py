"""Phase 0 - xlsx ('Reasons' sheet) -> one tidy record per feedback.

Reads the long format (5 rows per feedback, one per dimension), pivots to a
feedback-level table, parses trajectory metadata, prints the §1.5 checksums and
writes data/feedback.parquet.

Usage:  python 01_preprocess.py
"""

from __future__ import annotations

import os
import re
import sys
from collections import Counter

import pandas as pd

from codebook import CODEBOOK, DIMS, DIM_LABEL

HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.abspath(os.path.join(HERE, "..", "data", "feedback_100%_labeled.xlsx"))
SHEET = "Reasons"
OUT_DIR = os.path.join(HERE, "data")
OUT = os.path.join(OUT_DIR, "feedback.parquet")

KEY = ["participant_id", "trajectory_name", "feedback", "feedback_score"]

TRAJ_RE = re.compile(
    r"^(?P<n_agents>\d+)_"
    r"(?P<regime>forced|incentivized)_"
    r"(?P<difficulty>[a-z]+)"
    r"(?:_(?P<variant>\d+))?_"
    r"seed(?P<seed>\d+)_"
    r"(?P<perf_raw>\d+)_"
    r"(?P<perf_bucket>\d+)\.json$"
)

# Expected values from the build spec (§1.5). Reported, never asserted hard.
EXPECT = {
    "units": 1743, "participants": 216, "trajectories": 108,
    "group": {"low": 641, "mid": 574, "high": 531},
    "score": {1: 428, 2: 577, 3: 320, 4: 171, 5: 250},
    "codes": {
        1: {"1.1.1": 693, "1.1.2": 675, "1.1.3": 637, "1.2": 323, "1.3": 74},
        2: {"2.3.1": 839, "2.4.1": 741, "2.1.1": 565, "2.2.2": 488,
            "2.4.2": 290, "2.2.1": 274, "2.5": 116},
        3: {"3.2": 1393, "3.1": 920, "3.3": 356, "3.4": 120, "3.5": 91},
        4: {"4.1": 832, "4.2": 493, "4.4": 481, "4.3": 356},
        5: {"5.1": 603, "5.3": 595, "5.2": 393, "5.4": 291, "5.5": 217, "5.6": 34},
    },
}


def valence_of(score: int) -> str:
    if score <= 2:
        return "negative"
    if score == 3:
        return "neutral"
    return "positive"


def norm_codes(raw) -> str:
    """'  2.3.1  2.4.1 ' -> '2.3.1 2.4.1' (empty string when unlabelled)."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return ""
    return " ".join(str(raw).split())


def main() -> int:
    if not os.path.exists(XLSX):
        sys.exit("Excel file not found: %s" % XLSX)
    os.makedirs(OUT_DIR, exist_ok=True)

    df = pd.read_excel(XLSX, sheet_name=SHEET)
    print("raw rows: %d  (expected 5 x n_feedback)" % len(df))

    for c in ["participant_id", "group", "trajectory_name", "feedback", "confidence"]:
        df[c] = df[c].astype(str).str.strip()
    df["feedback_score"] = df["feedback_score"].astype(int)
    df["dimension"] = df["dimension"].astype(int)
    df["codes"] = df["codes"].map(norm_codes)
    df["partial_codes"] = df["partial_codes"].map(norm_codes)
    df["reason"] = df["reason"].fillna("").astype(str).str.strip()

    # A handful of participants submitted byte-identical feedback twice for the
    # same trajectory. They are separate submissions, so keep them apart: the
    # occurrence index within (key, dimension) disambiguates them.
    df["occ"] = df.groupby(KEY + ["dimension"]).cumcount()
    uid_key = list(zip(df["participant_id"], df["trajectory_name"],
                       df["feedback"], df["feedback_score"], df["occ"]))
    df["id"] = pd.factorize(pd.Series(uid_key), sort=False)[0]

    per_dim = df.groupby("id")["dimension"].nunique()
    if not (per_dim == 5).all():
        bad = per_dim[per_dim != 5]
        print("WARNING: %d feedback units do not have exactly 5 dimension rows"
              % len(bad))

    base = (df.drop_duplicates("id")
              .loc[:, ["id", "participant_id", "group", "trajectory_name",
                       "feedback_score", "feedback"]]
              .rename(columns={"participant_id": "pid", "trajectory_name": "traj",
                               "feedback_score": "score", "feedback": "text"})
              .sort_values("id")
              .reset_index(drop=True))

    for d in DIMS:
        sub = df[df["dimension"] == d].drop_duplicates("id").set_index("id")
        base["d%d_codes" % d] = base["id"].map(sub["codes"]).fillna("")
        base["d%d_conf" % d] = base["id"].map(sub["confidence"]).fillna("")
        base["d%d_partial" % d] = base["id"].map(sub["partial_codes"]).fillna("")
        base["d%d_reason" % d] = base["id"].map(sub["reason"]).fillna("")
        base["d%d_primary" % d] = base["d%d_codes" % d].map(
            lambda s: s.split()[0] if s else "none")
        base["d%d_n" % d] = base["d%d_codes" % d].map(lambda s: len(s.split()))

    # ---- trajectory metadata -------------------------------------------------
    meta = base["traj"].str.extract(TRAJ_RE)
    unparsed = base.loc[meta["regime"].isna(), "traj"].unique()
    if len(unparsed):
        print("WARNING: %d trajectory names did not parse, e.g. %s"
              % (len(unparsed), unparsed[:3]))
    base["regime"] = meta["regime"]
    base["difficulty"] = meta["difficulty"]
    base["variant"] = meta["variant"].fillna("base")
    base["seed"] = "seed" + meta["seed"].astype(str)
    # perf_raw / perf_bucket are parsed only; joining real system metrics onto
    # them is the extension hook for Panel D.
    base["perf_raw"] = pd.to_numeric(meta["perf_raw"], errors="coerce").astype("Int64")
    base["perf_bucket"] = pd.to_numeric(meta["perf_bucket"], errors="coerce").astype("Int64")

    base["valence"] = base["score"].map(valence_of)
    base["any_partial"] = (base[["d%d_conf" % d for d in DIMS]]
                           .eq("partial fit").any(axis=1))
    base["n_partial_dims"] = (base[["d%d_conf" % d for d in DIMS]]
                              .eq("partial fit").sum(axis=1))

    # ---- checksums -----------------------------------------------------------
    print("\n" + "=" * 68)
    print("CHECKSUMS  (parsed vs spec §1.5)")
    print("=" * 68)

    def line(name, got, exp):
        mark = "ok " if exp is None or abs(got - exp) <= max(4, exp * 0.01) else "!! "
        print("  %s%-34s %6d   (spec %s)" % (mark, name, got, exp))

    line("feedback units", len(base), EXPECT["units"])
    line("participants", base["pid"].nunique(), EXPECT["participants"])
    line("trajectories", base["traj"].nunique(), EXPECT["trajectories"])

    obs = base.groupby("traj")["pid"].nunique()
    print("  ok observers per trajectory        min %d / median %d / max %d  (spec 8)"
          % (obs.min(), obs.median(), obs.max()))

    print("\n  group (agent competence)")
    gc = base["group"].value_counts().to_dict()
    for g in ["low", "mid", "high"]:
        line("    %s" % g, gc.get(g, 0), EXPECT["group"].get(g))

    print("\n  feedback_score (participant valence)")
    sc = base["score"].value_counts().to_dict()
    for s in range(1, 6):
        line("    score %d" % s, sc.get(s, 0), EXPECT["score"].get(s))

    for d in DIMS:
        print("\n  dim %d - %s" % (d, DIM_LABEL[d]))
        cnt = Counter()
        for s in base["d%d_codes" % d]:
            for c in s.split():
                cnt[c] += 1
        exp = EXPECT["codes"][d]
        for c, n in sorted(cnt.items(), key=lambda kv: -kv[1]):
            line("    %-6s %s" % (c, CODEBOOK[d]["codes"].get(c, "?")[:26]),
                 n, exp.get(c))
        unlabelled = int((base["d%d_codes" % d] == "").sum())
        if unlabelled:
            print("     .  %-34s %6d" % ("(no code assigned)", unlabelled))
        extra = set(cnt) - set(CODEBOOK[d]["codes"])
        if extra:
            print("     !! codes not in codebook: %s" % sorted(extra))

    print("\n  regime: %s" % base["regime"].value_counts().to_dict())
    print("  perf_bucket: %s" % base["perf_bucket"].value_counts().sort_index().to_dict())
    print("  confidence - feedback with >=1 partial-fit dimension: %d / %d"
          % (int(base["any_partial"].sum()), len(base)))
    print("=" * 68)

    base.to_parquet(OUT, index=False)
    print("\nwrote %s  (%d rows x %d cols)" % (OUT, len(base), base.shape[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
