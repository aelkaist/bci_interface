"""Cached load of every artefact the dashboard needs, plus fast filter masks.

Everything is small (1.7k rows), so the whole table, the embedding matrix and
one boolean mask per taxonomy code live in memory. Filtering is then a handful
of numpy boolean ops.
"""

from __future__ import annotations

import gzip
import json
import os
import textwrap
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from codebook import DIMS, expand, leaf_codes

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")


class Store(object):
    def __init__(self) -> None:
        fb = pd.read_parquet(os.path.join(DATA, "feedback.parquet"))
        pts = pd.read_parquet(os.path.join(DATA, "points.parquet"))
        df = fb.merge(pts, on="id", how="left").sort_values("id").reset_index(drop=True)

        df["perf_bucket"] = df["perf_bucket"].astype("Int64")
        df["perf_raw"] = df["perf_raw"].astype("Int64")
        # Agent count is the layout suffix, not "does the filename contain a 4":
        # 01_preprocess.py already captured that suffix as `variant` (the
        # optional _4 between the difficulty and the seed), so "4" -> 4 agents
        # and "base" -> 2. 05_divergence.py derives the same value straight from
        # layoutName.endswith("_4") and the build report cross-checks the two.
        df["n_agents"] = np.where(df["variant"].astype(str) == "4", 4, 2)
        df["conf_any"] = np.where(df["any_partial"], "partial fit", "confident")
        df["text_wrapped"] = [self._wrap(t) for t in df["text"].astype(str)]
        df["short"] = [self._short(t) for t in df["text"].astype(str)]
        df["text_lower"] = df["text"].astype(str).str.lower()

        for d in DIMS:
            df["d%d_list" % d] = df["d%d_codes" % d].map(lambda s: s.split())

        self.df = df
        self.n = len(df)
        self.pos = {int(i): p for p, i in enumerate(df["id"].to_numpy())}

        E = np.load(os.path.join(DATA, "embeddings.npy")).astype("float32")
        E /= (np.linalg.norm(E, axis=1, keepdims=True) + 1e-12)
        self.E = E

        with open(os.path.join(DATA, "cluster_labels.json")) as fh:
            self.cluster_labels = json.load(fh)

        # code -> boolean mask over rows (leaf codes as they occur in the data)
        self.mask: Dict[str, np.ndarray] = {}
        for d in DIMS:
            lists = df["d%d_list" % d].tolist()
            for c in leaf_codes(d):
                self.mask[c] = np.fromiter((c in row for row in lists),
                                           dtype=bool, count=self.n)
        self.code_count = {c: int(m.sum()) for c, m in self.mask.items()}

        self.trajectories = sorted(df["traj"].unique().tolist())
        self.groups = [g for g in ["low", "mid", "high"] if g in set(df["group"])]
        self.regimes = sorted(df["regime"].dropna().unique().tolist())
        self.buckets = sorted(int(b) for b in df["perf_bucket"].dropna().unique())
        self.agent_counts = sorted(int(a) for a in df["n_agents"].unique())

        self._load_separability()
        self._load_divergence()

    # ------------------------------------------------------- separability --
    def _load_separability(self) -> None:
        """Optional outputs of 04_separability.py. Absent until it is run, so
        every consumer must tolerate None."""
        def maybe(path, reader):
            return reader(path) if os.path.exists(path) else None

        self.sep_dim = maybe(os.path.join(RESULTS, "separability_by_dimension.csv"),
                             pd.read_csv)
        self.sep_code = maybe(os.path.join(RESULTS, "separability_by_code.csv"),
                              pd.read_csv)
        self.umap_stab = maybe(os.path.join(RESULTS, "umap_stability",
                                            "coords.parquet"), pd.read_parquet)
        self.has_sep = self.sep_dim is not None and len(self.sep_dim) > 0
        self.label_sets = (sorted(self.sep_dim["label_set"].unique().tolist())
                           if self.has_sep else [])

    def sep_dim_row(self, d: int, label_set: str = "as-coded"):
        if not self.has_sep:
            return None
        m = self.sep_dim[(self.sep_dim["dimension"] == d)
                         & (self.sep_dim["label_set"] == label_set)]
        return m.iloc[0].to_dict() if len(m) else None

    def sep_code_auroc(self, code: str, label_set: str = "as-coded"):
        if self.sep_code is None:
            return None
        m = self.sep_code[(self.sep_code["code"] == code)
                          & (self.sep_code["label_set"] == label_set)]
        return float(m.iloc[0]["AUROC"]) if len(m) else None

    def stability_runs(self):
        """[(seed, n_neighbors), ...] present in the stability re-projections."""
        if self.umap_stab is None:
            return []
        u = self.umap_stab[["seed", "n_neighbors"]].drop_duplicates()
        return sorted((int(r.seed), int(r.n_neighbors)) for r in u.itertuples())

    # -------------------------------------------------------- divergence ----
    def _load_divergence(self) -> None:
        """Optional outputs of 05_divergence.py, same contract as separability:
        absent until the script is run, so every consumer tolerates None.

        Map scores, bands and diagnostics are read, never recomputed. The panel
        selects *which* maps to draw; it does not re-derive what they score.
        """
        maps = os.path.join(DATA, "divergence_maps.parquet")
        detail = os.path.join(DATA, "divergence_detail.json.gz")
        report = os.path.join(DATA, "divergence_report.json")

        self.div_maps = pd.read_parquet(maps) if os.path.exists(maps) else None
        self.div_detail = {}
        if os.path.exists(detail):
            with gzip.open(detail, "rt", encoding="utf-8") as fh:
                self.div_detail = json.load(fh)
        self.div_report = {}
        if os.path.exists(report):
            with open(report) as fh:
                self.div_report = json.load(fh)

        self.has_divergence = (self.div_maps is not None
                               and len(self.div_maps) > 0
                               and bool(self.div_detail))
        # basename (the id every other panel uses) <-> full episode.fileName
        # (the trajectory id the divergence build keys on).
        self.traj_id_of = {}
        if self.has_divergence:
            self.traj_id_of = dict(zip(self.div_maps["traj"],
                                       self.div_maps["traj_id"]))

    def divergence_view(self, ids, mode: str) -> pd.DataFrame:
        """Map rows for one analysis mode, restricted to the current selection.

        The single selector both the distribution and the detail drawer go
        through, so the two can never disagree about which trajectories are in
        scope. A map is in scope when at least one of its feedback rows survived
        the rail filters.
        """
        if not self.has_divergence:
            return pd.DataFrame()
        sub = self.div_maps[self.div_maps["mode"] == mode]
        keep = set(self.df.loc[self.df["id"].isin(list(ids or [])), "traj"])
        return (sub[sub["traj"].isin(keep)]
                .sort_values("traj_id").reset_index(drop=True))

    def divergence_detail(self, traj_id: str, mode: str) -> Optional[dict]:
        """Per-map observer lanes, items and metric inspectors, or None."""
        return (self.div_detail.get(str(traj_id)) or {}).get(mode)

    def divergence_thresholds(self, metric: str, mode: str):
        """Frozen global (q33, q67) for one (metric, mode), or None."""
        t = ((self.div_report.get("band_thresholds") or {})
             .get(metric, {}).get(mode))
        return (float(t[0]), float(t[1])) if t else None

    # ------------------------------------------------------------- helpers --
    @staticmethod
    def _wrap(t: str, width: int = 62, max_lines: int = 9) -> str:
        lines = textwrap.wrap(t.strip(), width=width) or ["(empty)"]
        if len(lines) > max_lines:
            lines = lines[:max_lines] + ["..."]
        return "<br>".join(lines)

    @staticmethod
    def _short(t: str, n: int = 90) -> str:
        t = " ".join(t.split())
        return t if len(t) <= n else t[:n - 1] + "…"

    def code_mask(self, code: str) -> np.ndarray:
        """Mask for a possibly-parent code (parent = OR over its children)."""
        parts = [self.mask[c] for c in expand(code) if c in self.mask]
        if not parts:
            return np.zeros(self.n, dtype=bool)
        out = parts[0].copy()
        for p in parts[1:]:
            out |= p
        return out

    # -------------------------------------------------------------- filter --
    def filter_mask(self, sel_codes: Dict[int, List[str]], groups, score_range,
                    valences, regimes, trajs, buckets, confident_only,
                    keyword, within_dim_and: bool, agents=()) -> np.ndarray:
        m = np.ones(self.n, dtype=bool)

        # dimensions: OR inside a dimension (default), AND between dimensions
        for d in DIMS:
            codes = sel_codes.get(d) or []
            if not codes:
                continue
            parts = [self.code_mask(c) for c in codes]
            acc = parts[0].copy()
            for p in parts[1:]:
                if within_dim_and:
                    acc &= p
                else:
                    acc |= p
            m &= acc

        if groups:
            m &= self.df["group"].isin(groups).to_numpy()
        if score_range:
            s = self.df["score"].to_numpy()
            m &= (s >= score_range[0]) & (s <= score_range[1])
        if valences:
            m &= self.df["valence"].isin(valences).to_numpy()
        if regimes:
            m &= self.df["regime"].isin(regimes).to_numpy()
        if trajs:
            m &= self.df["traj"].isin(trajs).to_numpy()
        if buckets:
            m &= self.df["perf_bucket"].isin([int(b) for b in buckets]).to_numpy()
        if agents:
            m &= self.df["n_agents"].isin([int(a) for a in agents]).to_numpy()
        if confident_only:
            m &= (~self.df["any_partial"]).to_numpy()
        if keyword and keyword.strip():
            m &= self.df["text_lower"].str.contains(
                keyword.strip().lower(), regex=False).to_numpy()
        return m

    # ---------------------------------------------------------- neighbours --
    def neighbors(self, fid: int, k: int = 5):
        p = self.pos[int(fid)]
        sims = self.E @ self.E[p]
        order = np.argsort(-sims)
        out = []
        for j in order:
            if j == p:
                continue
            out.append((int(self.df["id"].iloc[j]), float(sims[j])))
            if len(out) >= k:
                break
        return out


STORE = Store()
