"""Phase 1b - UMAP projection + clustering of the feedback embeddings.

Reads data/embeddings.npy, produces
  * UMAP 2D coordinates normalised to 0-100        -> x, y
  * KMeans(12) labels (default colouring, no noise) -> km
  * HDBSCAN labels on an 8D UMAP (noise = -1)       -> hdb
  * TF-IDF top-5 terms per cluster (legend labels)  -> data/cluster_labels.json

Writes data/points.parquet keyed by `id`.

Usage:  python 03_reduce_cluster.py
"""

from __future__ import annotations

import json
import os
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
FEEDBACK = os.path.join(DATA, "feedback.parquet")
EMB = os.path.join(DATA, "embeddings.npy")
POINTS = os.path.join(DATA, "points.parquet")
LABELS = os.path.join(DATA, "cluster_labels.json")

SEED = 42
N_KMEANS = 12

STOP_EXTRA = [
    "robot", "robots", "agent", "agents", "yellow", "blue", "green", "red",
    "left", "right", "just", "like", "think", "seems", "seem", "really",
    "bit", "lot", "way", "one", "two", "does", "doing", "did", "going",
]


def norm01_100(v: np.ndarray) -> np.ndarray:
    lo, hi = float(v.min()), float(v.max())
    if hi - lo < 1e-9:
        return np.zeros_like(v)
    return (v - lo) / (hi - lo) * 100.0


def tfidf_labels(texts, labels):
    from sklearn.feature_extraction.text import TfidfVectorizer

    stop = list(TfidfVectorizer(stop_words="english").get_stop_words()) + STOP_EXTRA
    vec = TfidfVectorizer(stop_words=stop, min_df=2, max_df=0.5,
                          ngram_range=(1, 2), sublinear_tf=True)
    X = vec.fit_transform(texts)
    terms = np.asarray(vec.get_feature_names_out())
    out = {}
    for lab in sorted(set(labels)):
        mask = labels == lab
        if mask.sum() == 0:
            continue
        centroid = np.asarray(X[mask].mean(axis=0)).ravel()
        top = terms[np.argsort(-centroid)[:5]]
        out[str(int(lab))] = ", ".join(top)
    return out


def main() -> int:
    import hdbscan
    import umap
    from sklearn.cluster import KMeans

    df = pd.read_parquet(FEEDBACK).sort_values("id").reset_index(drop=True)
    E = np.load(EMB).astype("float32")
    if E.shape[0] != len(df):
        raise SystemExit("embeddings (%d) and feedback rows (%d) disagree - "
                         "re-run 02_embed.py" % (E.shape[0], len(df)))

    E /= (np.linalg.norm(E, axis=1, keepdims=True) + 1e-12)
    print("embeddings %s (L2 normalised)" % (E.shape,))

    print("UMAP 2D ...")
    xy = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.12,
                   metric="cosine", random_state=SEED).fit_transform(E)

    print("UMAP 8D (for density clustering) ...")
    e8 = umap.UMAP(n_components=8, n_neighbors=15, min_dist=0.0,
                   metric="cosine", random_state=SEED).fit_transform(E)

    print("KMeans(%d) ..." % N_KMEANS)
    km = KMeans(n_clusters=N_KMEANS, random_state=SEED, n_init=10).fit_predict(E)

    print("HDBSCAN ...")
    hdb = hdbscan.HDBSCAN(min_cluster_size=20, min_samples=3,
                          prediction_data=False).fit_predict(e8.astype("float64"))

    pts = pd.DataFrame({
        "id": df["id"].to_numpy(),
        "x": norm01_100(np.asarray(xy)[:, 0]),
        "y": norm01_100(np.asarray(xy)[:, 1]),
        "km": km.astype(int),
        "hdb": hdb.astype(int),
    })
    pts.to_parquet(POINTS, index=False)

    texts = df["text"].astype(str).tolist()
    labels = {
        "km": tfidf_labels(texts, pts["km"].to_numpy()),
        "hdb": tfidf_labels(texts, pts["hdb"].to_numpy()),
    }
    with open(LABELS, "w") as fh:
        json.dump(labels, fh, indent=2)

    n_noise = int((pts["hdb"] == -1).sum())
    print("\nKMeans sizes : %s" % pts["km"].value_counts().sort_index().to_dict())
    print("HDBSCAN      : %d clusters, %d noise (%.1f%%)"
          % (pts.loc[pts["hdb"] >= 0, "hdb"].nunique(), n_noise,
             100.0 * n_noise / len(pts)))
    print("\ncluster keywords (KMeans):")
    for k in sorted(labels["km"], key=lambda s: int(s)):
        print("  %2s  %s" % (k, labels["km"][k]))
    print("\nwrote %s and %s" % (POINTS, LABELS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
