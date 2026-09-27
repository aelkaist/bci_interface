"""Phase 2 - how separable is each taxonomy dimension in embedding space?

Turns the visual impression from the Panel A facet view ("D1/D5 split, D4 is
mixed") into numbers a reviewer can check.

Method, and the rules it obeys:
  * every metric is computed on the ORIGINAL 3072-d embeddings, never on the
    UMAP 2D coordinates (measuring separability on the projection that was
    built to show separability would be circular)
  * cross-validation is GroupKFold on participant_id, so a probe cannot win by
    memorising one participant's writing style
  * multi-label is handled honestly: the headline metric is per-code
    one-vs-rest presence, not "primary code only" (that shortcut is confined to
    silhouette, which is undefined for multi-label points)
  * everything is reported against chance: a participant-block label
    permutation null, and a TF-IDF lexical baseline that says how much of the
    separation is just surface wording

Outputs (results/):
  separability_by_dimension.csv   one row per dimension x label set
  separability_by_code.csv        one row per code
  fig_separability.svg / .png     main figure (transformer vs TF-IDF)
  fig_code_auroc.svg / .png       per-code strip plot (appendix)
  umap_stability/coords.parquet   3 seeds x 3 n_neighbors re-projections
  umap_stability/grid.png         qualitative stability grid
  separability_summary.json       machine-readable summary for the dashboard

Usage:
  python 04_separability.py                  # full run
  python 04_separability.py --reps 50        # quicker null
  python 04_separability.py --skip-umap      # skip the stability grid
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import warnings
from collections import Counter

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, roc_auc_score,
                             silhouette_score)
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import normalize

from codebook import CODE_NAME, DIM_LABEL, DIMS

warnings.filterwarnings("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")

SEED = 42
N_SPLITS = 5
MIN_POS = 20          # codes rarer than this are excluded from probing
KNN_K = 10
LABEL_SETS = ("as-coded", "parent")


# ------------------------------------------------------------------ labels ---

def rollup(code: str) -> str:
    """leaf 'a.b.c' -> parent 'a.b'; mid-level codes stay as they are."""
    parts = code.split(".")
    return ".".join(parts[:2]) if len(parts) == 3 else code


def label_matrix(df: pd.DataFrame, d: int, label_set: str):
    """-> (Y multi-hot [n, k], code list) for the codes actually used."""
    lists = [s.split() for s in df["d%d_codes" % d]]
    if label_set == "parent":
        lists = [sorted(set(rollup(c) for c in row)) for row in lists]
    cnt = Counter(c for row in lists for c in row)
    codes = sorted(cnt, key=lambda c: (-cnt[c], c))
    Y = np.zeros((len(df), len(codes)), dtype=np.int8)
    idx = {c: j for j, c in enumerate(codes)}
    for i, row in enumerate(lists):
        for c in row:
            Y[i, idx[c]] = 1
    return Y, codes


# ------------------------------------------------------------------- probe ---

def probe(X, y, groups, folds):
    """One-vs-rest logistic probe under participant-grouped CV.

    Returns pooled out-of-fold AUROC/AP (one number over all folds, as the
    spec asks) plus the per-fold AUROCs, which is what the error bars use.
    """
    oof = np.zeros(len(y), dtype=float)
    per_fold = []
    for tr, te in folds:
        if len(np.unique(y[tr])) < 2 or len(np.unique(y[te])) < 2:
            per_fold.append(np.nan)
            continue
        clf = LogisticRegression(class_weight="balanced", max_iter=2000, C=1.0)
        clf.fit(X[tr], y[tr])
        p = clf.predict_proba(X[te])[:, 1]
        oof[te] = p
        per_fold.append(roc_auc_score(y[te], p))
    return (roc_auc_score(y, oof), average_precision_score(y, oof),
            np.array(per_fold, dtype=float))


def macro_auroc(X, Y, groups, folds, keep):
    """Mean pooled AUROC over the retained codes of one dimension."""
    vals = [probe(X, Y[:, j].astype(int), groups, folds)[0] for j in keep]
    return float(np.mean(vals)) if vals else np.nan


# ------------------------------------------------------- permutation null ----

def block_permuter(groups: np.ndarray, seed: int):
    """Permute label blocks BETWEEN participants of identical block size.

    A plain row-level shuffle would destroy the within-participant label
    structure and make the null far too easy to beat. Swapping whole blocks
    between same-sized participants keeps each participant's label pattern
    intact and only breaks the link between a participant's text and their
    labels — the conservative null.
    """
    rng = np.random.default_rng(seed)
    order = {}
    for g in pd.unique(groups):
        order[g] = np.flatnonzero(groups == g)
    by_size = {}
    for g, idx in order.items():
        by_size.setdefault(len(idx), []).append(g)

    perm = np.arange(len(groups))
    unswappable = 0
    for size, gs in by_size.items():
        if len(gs) < 2:
            unswappable += len(gs)
            continue
        src = list(gs)
        dst = list(rng.permutation(src))
        for a, b in zip(src, dst):
            perm[order[a]] = order[b]
    return perm, unswappable


def permutation_null(X, Y, groups, folds, keep, reps, n_jobs):
    def one(r):
        perm, _ = block_permuter(groups, SEED + 1000 * r)
        return macro_auroc(X, Y[perm], groups, folds, keep)
    vals = Parallel(n_jobs=n_jobs, verbose=0)(delayed(one)(r) for r in range(reps))
    return np.array([v for v in vals if np.isfinite(v)], dtype=float)


# --------------------------------------------------------- geometry checks ---

def silhouette_single_label(X, Y, codes, keep):
    """Silhouette over the points carrying exactly one code of the dimension.

    Silhouette needs a hard partition, which multi-label points do not have, so
    this is a subset statistic and is reported as such.
    """
    kept = Y[:, keep]
    single = kept.sum(axis=1) == 1
    if single.sum() < 50:
        return np.nan, int(single.sum()), np.nan
    lab = kept[single].argmax(axis=1)
    if len(np.unique(lab)) < 2:
        return np.nan, int(single.sum()), np.nan
    s = silhouette_score(X[single], lab, metric="cosine")
    return float(s), int(single.sum()), float(single.mean())


def knn_purity(X, Y, keep, k=KNN_K, null_reps=20, seed=SEED):
    """Share of a point's k nearest neighbours that share >=1 code with it."""
    kept = Y[:, keep].astype(bool)
    S = X @ X.T
    np.fill_diagonal(S, -np.inf)
    nn = np.argpartition(-S, kth=k, axis=1)[:, :k]

    def purity(M):
        hits = np.array([M[i] @ M[nn[i]].T for i in range(len(M))])
        return float((hits > 0).mean())

    obs = purity(kept)
    rng = np.random.default_rng(seed)
    null = [purity(kept[rng.permutation(len(kept))]) for _ in range(null_reps)]
    return obs, float(np.mean(null))


def cramers_v(a: pd.Series, b: pd.Series):
    tab = pd.crosstab(a, b)
    chi2 = 0.0
    n = tab.to_numpy().sum()
    exp = np.outer(tab.sum(axis=1), tab.sum(axis=0)) / n
    obs = tab.to_numpy()
    chi2 = float(((obs - exp) ** 2 / np.where(exp > 0, exp, 1)).sum())
    r, c = tab.shape
    denom = n * (min(r, c) - 1)
    return float(np.sqrt(chi2 / denom)) if denom > 0 else np.nan, tab


# ------------------------------------------------------------------- main ----

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=200,
                    help="permutation null repetitions (default 200)")
    ap.add_argument("--knn-null-reps", type=int, default=20)
    ap.add_argument("--skip-umap", action="store_true")
    ap.add_argument("--n-jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    args = ap.parse_args()

    os.makedirs(RESULTS, exist_ok=True)
    t0 = time.time()

    df = pd.read_parquet(os.path.join(DATA, "feedback.parquet"))
    df = df.sort_values("id").reset_index(drop=True)
    X = normalize(np.load(os.path.join(DATA, "embeddings.npy")).astype("float32"))
    groups = df["pid"].to_numpy()
    n = len(df)
    print("unit of analysis: %d feedback | %d participants | X %s"
          % (n, len(set(groups)), X.shape))

    folds = list(GroupKFold(n_splits=N_SPLITS).split(X, groups=groups))
    print("CV: GroupKFold(%d) on participant_id — test sizes %s"
          % (N_SPLITS, [len(te) for _, te in folds]))

    _, unswappable = block_permuter(groups, SEED)
    print("permutation null: participant-block swap; %d participant(s) have a "
          "unique block size and keep their labels" % unswappable)

    # ---- TF-IDF lexical baseline features ---------------------------------
    tfidf = TfidfVectorizer(ngram_range=(1, 2), min_df=3, sublinear_tf=True,
                            stop_words="english")
    Xt = tfidf.fit_transform(df["text"].astype(str))
    print("TF-IDF baseline features: %s" % (Xt.shape,))

    code_rows, dim_rows = [], []

    for label_set in LABEL_SETS:
        print("\n" + "=" * 70)
        print("LABEL SET: %s" % label_set)
        print("=" * 70)
        for d in DIMS:
            Y, codes = label_matrix(df, d, label_set)
            npos = Y.sum(axis=0)
            keep = [j for j in range(len(codes)) if npos[j] >= MIN_POS]
            dropped = [(codes[j], int(npos[j])) for j in range(len(codes))
                       if j not in keep]
            print("\nD%d %s — %d codes, %d probed"
                  % (d, DIM_LABEL[d], len(codes), len(keep)))
            if dropped:
                print("   excluded (n_pos < %d): %s"
                      % (MIN_POS, ", ".join("%s n=%d" % x for x in dropped)))

            aurocs, aplifts, fold_mat, tf_aurocs = [], [], [], []
            for j in keep:
                y = Y[:, j].astype(int)
                auroc, apv, per_fold = probe(X, y, groups, folds)
                prev = float(y.mean())
                t_auroc, _, _ = probe(Xt, y, groups, folds)
                aurocs.append(auroc)
                aplifts.append(apv / prev if prev > 0 else np.nan)
                fold_mat.append(per_fold)
                tf_aurocs.append(t_auroc)
                code_rows.append(dict(
                    label_set=label_set, dimension=d,
                    dimension_label=DIM_LABEL[d], code=codes[j],
                    code_name=CODE_NAME.get(codes[j], "?"),
                    n_pos=int(y.sum()), prevalence=round(prev, 4),
                    AUROC=round(auroc, 4), AP=round(apv, 4),
                    AP_lift=round(apv / prev, 3) if prev > 0 else np.nan,
                    tfidf_AUROC=round(t_auroc, 4),
                    auroc_gain_over_tfidf=round(auroc - t_auroc, 4)))
                print("   %-7s %-32s n=%4d  AUROC %.3f  AP-lift %5.2f  "
                      "(tfidf %.3f, gain %+.3f)"
                      % (codes[j], CODE_NAME.get(codes[j], "?")[:32],
                         y.sum(), auroc, apv / prev if prev else np.nan,
                         t_auroc, auroc - t_auroc))

            if not keep:
                continue

            npos_keep = np.array([npos[j] for j in keep], dtype=float)
            macro = float(np.mean(aurocs))
            weighted = float(np.average(aurocs, weights=npos_keep))
            fold_mat = np.vstack(fold_mat)
            fold_macro = np.nanmean(fold_mat, axis=0)

            sil, n_single, share_single = silhouette_single_label(X, Y, codes, keep)
            purity, purity_null = knn_purity(X, Y, keep, KNN_K,
                                             args.knn_null_reps, SEED)

            null = permutation_null(X, Y, groups, folds, keep,
                                    args.reps, args.n_jobs)
            p_val = float((np.sum(null >= macro) + 1) / (len(null) + 1))
            z = float((macro - null.mean()) / null.std(ddof=1)) if null.std() else np.nan

            # Paired per-code comparison, transformer vs TF-IDF. With only
            # 4-7 codes per dimension Wilcoxon is underpowered (its floor is
            # p=.031 at n=6), so the sign count is reported alongside it.
            diffs = np.array(aurocs) - np.array(tf_aurocs)
            n_gain_pos = int((diffs > 0).sum())
            try:
                from scipy.stats import wilcoxon
                w_p = (float(wilcoxon(aurocs, tf_aurocs).pvalue)
                       if len(diffs) >= 5 else np.nan)
            except Exception:
                w_p = np.nan

            dim_rows.append(dict(
                dimension=d, dimension_label=DIM_LABEL[d], label_set=label_set,
                n_codes_used=len(keep), n_codes_total=len(codes),
                codes_excluded=";".join("%s(n=%d)" % x for x in dropped),
                macro_AUROC=round(macro, 4),
                macro_AUROC_weighted=round(weighted, 4),
                macro_AUROC_fold_std=round(float(np.nanstd(fold_macro, ddof=1)), 4),
                macro_AP_lift=round(float(np.mean(aplifts)), 3),
                silhouette=round(sil, 4) if np.isfinite(sil) else np.nan,
                silhouette_n_single=n_single,
                silhouette_share_single=round(share_single, 3)
                if np.isfinite(share_single) else np.nan,
                knn_purity=round(purity, 4), knn_purity_null=round(purity_null, 4),
                tfidf_macro_AUROC=round(float(np.mean(tf_aurocs)), 4),
                auroc_gain_over_tfidf=round(float(np.mean(diffs)), 4),
                n_codes_gain_positive=n_gain_pos,
                gain_wilcoxon_p=round(w_p, 5) if np.isfinite(w_p) else np.nan,
                perm_null_mean=round(float(null.mean()), 4),
                perm_null_std=round(float(null.std(ddof=1)), 4),
                perm_reps=len(null), perm_p=round(p_val, 5), perm_z=round(z, 2)))
            print("   -> macro-AUROC %.3f (fold sd %.3f) | tfidf %.3f (gain %+.3f, "
                  "wilcoxon p=%s)" % (macro, np.nanstd(fold_macro, ddof=1),
                                      np.mean(tf_aurocs), np.mean(diffs),
                                      "%.4f" % w_p if np.isfinite(w_p) else "n/a"))
            print("      silhouette %.3f (n=%d single-label) | kNN purity %.3f "
                  "vs null %.3f | perm p=%.4f z=%.1f"
                  % (sil, n_single, purity, purity_null, p_val, z))

    by_code = pd.DataFrame(code_rows)
    by_dim = pd.DataFrame(dim_rows)
    by_code.to_csv(os.path.join(RESULTS, "separability_by_code.csv"), index=False)
    by_dim.to_csv(os.path.join(RESULTS, "separability_by_dimension.csv"), index=False)
    print("\nwrote results/separability_by_code.csv (%d rows)" % len(by_code))
    print("wrote results/separability_by_dimension.csv (%d rows)" % len(by_dim))

    # ---- D1 x D3 association (reviewer question about dimension independence)
    v, tab = cramers_v(df["d1_primary"], df["d3_primary"])
    print("\nD1 primary x D3 primary — Cramer's V = %.3f" % v)
    tab.to_csv(os.path.join(RESULTS, "d1_d3_crosstab.csv"))

    summary = {
        "n_feedback": int(n), "n_participants": int(len(set(groups))),
        "embedding": "text-embedding-3-large (L2-normalised, 3072d)",
        "cv": "GroupKFold(%d) on participant_id" % N_SPLITS,
        "min_pos": MIN_POS, "perm_reps": args.reps,
        "cramers_v_d1_d3": round(v, 4),
        "dimensions": by_dim.to_dict(orient="records"),
    }
    with open(os.path.join(RESULTS, "separability_summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2)

    make_figures(by_dim, by_code)

    if not args.skip_umap:
        umap_stability(X, df)

    print("\ntotal %.1f min" % ((time.time() - t0) / 60))
    return 0


# ---------------------------------------------------------------- figures ---

def make_figures(by_dim: pd.DataFrame, by_code: pd.DataFrame) -> None:
    import plotly.graph_objects as go
    from codebook import CAT8, GREY, SURFACE

    FONT = 'Inter, "SF Pro Text", -apple-system, "Segoe UI", Roboto, sans-serif'
    base = dict(paper_bgcolor="#ffffff", plot_bgcolor=SURFACE,
                font=dict(family=FONT, size=12, color="#2a2f36"))

    sub = by_dim[by_dim["label_set"] == "as-coded"].sort_values("dimension")
    x = ["D%d<br>%s" % (r.dimension, r.dimension_label) for r in sub.itertuples()]

    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=x, y=sub["macro_AUROC"], name="Transformer embedding",
        marker=dict(color=CAT8[0], line=dict(width=1, color=SURFACE)),
        error_y=dict(type="data", array=sub["macro_AUROC_fold_std"],
                     color="#3c424a", thickness=1.2, width=5),
        text=[("%.3f" % v) for v in sub["macro_AUROC"]],
        textposition="outside", textfont=dict(size=11)))
    fig.add_trace(go.Bar(
        x=x, y=sub["tfidf_macro_AUROC"], name="TF-IDF lexical baseline",
        marker=dict(color=CAT8[1], line=dict(width=1, color=SURFACE)),
        text=[("%.3f" % v) for v in sub["tfidf_macro_AUROC"]],
        textposition="outside", textfont=dict(size=11)))
    fig.add_hline(y=0.5, line=dict(dash="dash", width=1.2, color=GREY),
                  annotation_text="chance (0.5)", annotation_position="right",
                  annotation_font=dict(size=10, color="#6b7280"))
    fig.update_layout(
        height=460, width=900, barmode="group", bargap=0.34, bargroupgap=0.08,
        barcornerradius=3,
        title=dict(text="Per-code decodability by taxonomy dimension "
                        "(participant-grouped 5-fold CV)",
                   font=dict(size=13.5), x=0.01),
        legend=dict(orientation="h", y=1.10, x=0.30, borderwidth=0,
                    bgcolor="rgba(0,0,0,0)", font=dict(size=11)),
        margin=dict(l=60, r=30, t=90, b=70), **base)
    fig.update_yaxes(title=dict(text="macro-AUROC", font=dict(size=11)),
                     range=[0.4, 1.03], gridcolor="#eceef1", zeroline=False)
    fig.update_xaxes(tickfont=dict(size=10.5))
    for ext in ("svg", "png"):
        fig.write_image(os.path.join(RESULTS, "fig_separability.%s" % ext),
                        scale=2 if ext == "png" else 1)

    # appendix: per-code AUROC strip plot
    cs = by_code[by_code["label_set"] == "as-coded"]
    fig2 = go.Figure()
    for i, d in enumerate(DIMS):
        s = cs[cs["dimension"] == d]
        fig2.add_trace(go.Scatter(
            x=s["AUROC"], y=["D%d" % d] * len(s), mode="markers+text",
            name="D%d" % d, text=s["code"], textposition="top center",
            textfont=dict(size=8.5, color="#6b7280"),
            marker=dict(size=11, color=CAT8[i % len(CAT8)], opacity=0.85,
                        line=dict(width=1, color=SURFACE)),
            hovertemplate="%{text} %{customdata}<br>AUROC %{x:.3f}<extra></extra>",
            customdata=s["code_name"], showlegend=False))
    fig2.add_vline(x=0.5, line=dict(dash="dash", width=1.2, color=GREY))
    fig2.update_layout(height=380, width=900,
                       title=dict(text="Per-code AUROC within each dimension "
                                       "(as-coded labels)",
                                  font=dict(size=13.5), x=0.01),
                       margin=dict(l=60, r=30, t=60, b=50), **base)
    fig2.update_xaxes(title=dict(text="AUROC", font=dict(size=11)),
                      range=[0.42, 1.02], gridcolor="#eceef1")
    fig2.update_yaxes(autorange="reversed")
    for ext in ("svg", "png"):
        fig2.write_image(os.path.join(RESULTS, "fig_code_auroc.%s" % ext),
                         scale=2 if ext == "png" else 1)
    print("wrote results/fig_separability.{svg,png} and fig_code_auroc.{svg,png}")


# -------------------------------------------------------- UMAP stability ----

def umap_stability(X, df) -> None:
    """Re-project under 3 seeds x 3 n_neighbors so the qualitative pattern in
    the facet view can be shown not to be a hyper-parameter accident."""
    import umap

    out_dir = os.path.join(RESULTS, "umap_stability")
    os.makedirs(out_dir, exist_ok=True)
    seeds, neighbors = [42, 7, 2024], [10, 15, 30]
    rows = []
    for s in seeds:
        for nn in neighbors:
            t = time.time()
            xy = umap.UMAP(n_components=2, n_neighbors=nn, min_dist=0.12,
                           metric="cosine", random_state=s).fit_transform(X)
            xy = np.asarray(xy)
            for axis in (0, 1):
                lo, hi = xy[:, axis].min(), xy[:, axis].max()
                xy[:, axis] = (xy[:, axis] - lo) / (hi - lo) * 100
            rows.append(pd.DataFrame({"id": df["id"].to_numpy(),
                                      "seed": s, "n_neighbors": nn,
                                      "x": xy[:, 0], "y": xy[:, 1]}))
            print("  UMAP seed=%d n_neighbors=%d  %.0fs" % (s, nn, time.time() - t))
    coords = pd.concat(rows, ignore_index=True)
    coords.to_parquet(os.path.join(out_dir, "coords.parquet"), index=False)
    print("wrote results/umap_stability/coords.parquet (%d rows)" % len(coords))

    _stability_grid(coords, df, out_dir, seeds, neighbors)


def _stability_grid(coords, df, out_dir, seeds, neighbors) -> None:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    from codebook import CODE_COLOR, CODE_SYMBOL, GREY, SURFACE

    d = 5   # Feedback Type: the dimension whose split is the visual claim
    prim = df.set_index("id")["d%d_primary" % d]
    fig = make_subplots(rows=len(seeds), cols=len(neighbors),
                        horizontal_spacing=0.02, vertical_spacing=0.05,
                        subplot_titles=["n_neighbors=%d" % nn for nn in neighbors]
                                       + [""] * (len(seeds) - 1) * len(neighbors))
    for i, s in enumerate(seeds, start=1):
        for j, nn in enumerate(neighbors, start=1):
            c = coords[(coords["seed"] == s) & (coords["n_neighbors"] == nn)]
            code = prim.reindex(c["id"]).to_numpy()
            for cat in sorted(set(code)):
                m = code == cat
                fig.add_trace(go.Scattergl(
                    x=c["x"][m], y=c["y"][m], mode="markers", showlegend=False,
                    marker=dict(size=2.6, opacity=0.8,
                                color=CODE_COLOR.get(cat, GREY),
                                symbol=CODE_SYMBOL.get(cat, "circle")),
                    hoverinfo="skip"), row=i, col=j)
        fig.add_annotation(text="seed %d" % s, x=-0.012, y=0.5, xref="paper",
                           yref="y domain", showarrow=False, textangle=-90,
                           font=dict(size=10, color="#6b7280"), row=i, col=1)
    fig.update_layout(height=300 * len(seeds), width=330 * len(neighbors),
                      paper_bgcolor="#ffffff", plot_bgcolor=SURFACE,
                      margin=dict(l=40, r=10, t=40, b=10),
                      title=dict(text="UMAP stability — D5 Feedback Type primary "
                                      "code across seeds x n_neighbors",
                                 font=dict(size=13), x=0.01))
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    fig.write_image(os.path.join(out_dir, "grid.png"), scale=2)
    print("wrote results/umap_stability/grid.png")


if __name__ == "__main__":
    raise SystemExit(main())
