"""Phase 1a - OpenAI embeddings for every unique feedback text.

Reads data/feedback.parquet, embeds `text` with text-embedding-3-large in
batches, and caches the result to data/embeddings.npy in `id` order. A second
run loads the cache and makes no API call (unless --force is passed or the
cached vectors no longer match the current texts).

The API key is read from the OPENAI_API_KEY environment variable only.

Usage:  export OPENAI_API_KEY="sk-..."  &&  python 02_embed.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from typing import List

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
FEEDBACK = os.path.join(DATA, "feedback.parquet")
EMB = os.path.join(DATA, "embeddings.npy")
META = os.path.join(DATA, "embeddings.meta.json")

MODEL = "text-embedding-3-large"
BATCH = 200
MAX_RETRIES = 5


def texts_fingerprint(texts: List[str]) -> str:
    h = hashlib.sha256()
    for t in texts:
        h.update(t.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def embed(texts: List[str]) -> np.ndarray:
    from openai import OpenAI

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("OPENAI_API_KEY is not set. Export it in the shell, do not "
                 "put it in a file.")
    client = OpenAI(api_key=key)

    out = []
    n_batches = (len(texts) + BATCH - 1) // BATCH
    for bi, i in enumerate(range(0, len(texts), BATCH), start=1):
        chunk = texts[i:i + BATCH]
        delay = 2.0
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = client.embeddings.create(model=MODEL, input=chunk)
                out += [d.embedding for d in r.data]
                break
            except Exception as exc:                      # noqa: BLE001
                if attempt == MAX_RETRIES:
                    raise
                print("  batch %d failed (%s: %s), retry %d in %.0fs"
                      % (bi, type(exc).__name__, str(exc)[:120], attempt, delay))
                time.sleep(delay)
                delay *= 2
        print("  batch %d/%d  (%d vectors)" % (bi, n_batches, len(out)))
    return np.asarray(out, dtype="float32")


def main() -> int:
    force = "--force" in sys.argv
    df = pd.read_parquet(FEEDBACK).sort_values("id").reset_index(drop=True)
    # Empty strings are rejected by the API; one feedback is a single character.
    texts = [t if t.strip() else " " for t in df["text"].astype(str)]
    fp = texts_fingerprint(texts)

    if os.path.exists(EMB) and not force:
        cached = np.load(EMB)
        meta = {}
        if os.path.exists(META):
            with open(META) as fh:
                meta = json.load(fh)
        if cached.shape[0] == len(texts) and meta.get("fingerprint") in (None, fp):
            print("cache hit: %s %s (model=%s) - no API call"
                  % (EMB, cached.shape, meta.get("model", "?")))
            return 0
        print("cache present but stale (rows %d vs %d / fingerprint mismatch) "
              "- re-embedding" % (cached.shape[0], len(texts)))

    print("embedding %d texts with %s ..." % (len(texts), MODEL))
    vecs = embed(texts)
    if vecs.shape[0] != len(texts):
        sys.exit("got %d vectors for %d texts" % (vecs.shape[0], len(texts)))

    np.save(EMB, vecs)
    with open(META, "w") as fh:
        json.dump({"model": MODEL, "n": int(vecs.shape[0]),
                   "dim": int(vecs.shape[1]), "fingerprint": fp}, fh, indent=2)
    print("wrote %s %s" % (EMB, vecs.shape))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
