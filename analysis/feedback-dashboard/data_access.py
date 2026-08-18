"""Cached load of every artefact the dashboard needs, plus fast filter masks.

Everything is small (1.7k rows), so the whole table, the embedding matrix and
one boolean mask per taxonomy code live in memory. Filtering is then a handful
of numpy boolean ops.
"""

from __future__ import annotations

import json
import os
import textwrap
from typing import Dict, List

import numpy as np
import pandas as pd

from codebook import DIMS, expand, leaf_codes

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")


class Store(object):
    def __init__(self) -> None:
        fb = pd.read_parquet(os.path.join(DATA, "feedback.parquet"))
        pts = pd.read_parquet(os.path.join(DATA, "points.parquet"))
        df = fb.merge(pts, on="id", how="left").sort_values("id").reset_index(drop=True)

        df["perf_bucket"] = df["perf_bucket"].astype("Int64")
        df["perf_raw"] = df["perf_raw"].astype("Int64")
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
                    keyword, within_dim_and: bool) -> np.ndarray:
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
