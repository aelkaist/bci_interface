# Human-Perceived Feedback — analysis dashboard

Research tool for the Overcooked 2-agent monitoring study: 1,746 free-text
feedback items written by 216 observers over 108 trajectories, each coded by the
research team on five dimensions.

The dashboard is built to answer four questions:

1. Do the taxonomy codes separate **semantically** (Panel A facet view)?
2. What do people attend to, how do they monitor, how do they judge (Panels B, C)?
3. Does **agent competence** (low/mid/high) shift the perceived-feedback
   distribution (Panel D)?
4. Do the **8 observers of one trajectory** converge or diverge (Panel E)?

## Run

```bash
conda activate neurocontroller
pip install -r requirements.txt

export OPENAI_API_KEY="sk-..."        # shell session only; never commit a key

python 01_preprocess.py               # xlsx -> data/feedback.parquet + checksums
python 02_embed.py                    # OpenAI embeddings, cached after the first run
python 03_reduce_cluster.py           # UMAP 2D + KMeans/HDBSCAN -> data/points.parquet
python app.py                         # http://127.0.0.1:8050
```

`02_embed.py` calls the API only when `data/embeddings.npy` is missing or stale
(row count or text fingerprint changed). Pass `--force` to re-embed deliberately.
Cost for the full set is well under $0.02.

## Files

| File | Role |
|---|---|
| `codebook.py` | Taxonomy, hierarchy helpers, and every validated colour palette |
| `01_preprocess.py` | Long (5 rows/feedback) → one tidy record per feedback, + checksums |
| `02_embed.py` | `text-embedding-3-large`, batched with retry/backoff, disk-cached |
| `03_reduce_cluster.py` | L2-normalise → UMAP 2D/8D → KMeans(12) + HDBSCAN + TF-IDF labels |
| `data_access.py` | In-memory store: table, embeddings, per-code boolean masks |
| `app.py` | Dash app: filter rail, panels A–E, inspector (F) |
| `data/` | Generated artefacts — gitignored |

Source workbook: `../data/feedback_100%_labeled.xlsx`, sheet **`Reasons`** (the
tidy long format). The `Copy of feedback_sample_init-co` sheet is the wide
check-mark version and is not read.

## Data model

One record = one unique feedback text, identified by
`(participant_id, trajectory_name, feedback, feedback_score)`. Three participants
submitted a byte-identical feedback twice for the same trajectory; those are kept
as separate submissions, which is why the unit count is **1,746** (= 8,730 / 5)
rather than the 1,743 distinct strings. That choice makes every per-group and
per-code checksum in the build spec match exactly.

`codes` is a space-separated multi-label field, so a feedback can hold several
codes inside one dimension. Code levels are mixed (`1.1.1` leaf vs `1.2` mid);
selecting a parent (`1.1`) in the filter rail rolls up its leaves.

`trajectory_name` (e.g. `2_forced_hard_seed10_6020000_60.json`) is parsed into
`regime`, `seed`, `variant`, `perf_raw`, `perf_bucket`. **`perf_raw` /
`perf_bucket` are filename-derived guesses, not validated system metrics** —
Panel D exposes them as an explicitly-labelled extension hook; join the real
metric there to make that panel conclusive.

## Filter semantics

- Several codes selected **inside one dimension → OR** (a feedback matching any
  of them passes). An advanced radio switches this to AND; the default is OR
  because multi-label AND inside a dimension collapses to near-zero rows.
- **Between dimensions → AND.** Competence, score, valence, regime, bucket,
  confidence and keyword all AND together as well.
- The live counter shows `N / 1746` plus how many filters are active.
- "⤓ download filtered CSV" exports exactly the current selection.

## Encoding rules

Colour is assigned by the job it does, and the palettes were checked with a
CVD validator against the chart surface `#fbfbfc`:

| Encoding | Type | Why |
|---|---|---|
| Taxonomy codes | categorical, 8 fixed hues **+ marker shape** | no dimension needs more than 7 slots; shape is the secondary channel because no 7-colour palette clears the all-pairs CVD floor, and a scatter shows every category at once |
| Agent competence, perf bucket | sequential single hue | both are ordered (low < mid < high) |
| feedback_score, valence, lift | diverging, neutral-grey midpoint | polarity, not magnitude |
| KMeans / HDBSCAN clusters | 8 largest get a hue, rest fold into "other" | a 9th series is never an invented hue; cluster colour is computed over the whole dataset so filtering never repaints the survivors |

A thicker dark outline on a point means it carries **more than one code** in the
dimension currently coloured. Grey = no code assigned.

## Panels

- **A · Embedding map** — UMAP of `text-embedding-3-large`, 13 colour-by options,
  hover shows the full text, click opens the inspector. The **5-dimension facet**
  toggle repeats the same coordinates coloured by each dimension in turn; this is
  the view that shows which dimensions are semantically coherent (D3 separates
  cleanly, D2 does not).
- **B · Distributions** — code frequency per dimension, splittable by competence
  or valence. ⚠ flags codes held by under 5% of the current selection.
- **C · Co-occurrence** — cross-dimension matrix (count / row % / **lift**) plus
  the within-dimension multi-label overlap (count / Jaccard). Clicking a cell
  pushes that pair into the filter rail.
- **D · Competence lens** — code prevalence and score distribution by competence,
  plus the perf-proxy scatter with "high perf · low perceived" trajectories ringed.
- **E · Trajectory & observers** — observer × code matrix, per-code agreement bar,
  and every observer's raw feedback side by side. "highlight in Panel A" rings
  that trajectory's points on the map.
- **F · Inspector** (right rail) — full text with keyword highlighting, condition
  chips, all five dimensions with codes, confidence and the coder's reason, and
  the 5 nearest neighbours in embedding space as clickable jumps.
