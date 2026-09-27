# Human-Perceived Feedback — analysis dashboard

Research tool for the Overcooked 2-agent monitoring study: 1,746 free-text
feedback items written by 216 observers over 108 trajectories, each coded by the
research team on five dimensions.

The dashboard is built to answer four questions:

1. Do the taxonomy codes separate **semantically** (Panel A facet view)?
2. What do people attend to, how do they monitor, how do they judge (Panels B, C)?
3. Does **agent competence** (low/mid/high) shift the perceived-feedback
   distribution (Panel D)?
4. Do the **8 observers of one trajectory** converge or diverge — descriptively
   (Panel E) and as four measured divergence metrics (Panel F)?

## Run

```bash
conda activate neurocontroller
pip install -r requirements.txt

export OPENAI_API_KEY="sk-..."        # shell session only; never commit a key

python 01_preprocess.py               # xlsx -> data/feedback.parquet + checksums
python 02_embed.py                    # OpenAI embeddings, cached after the first run
python 03_reduce_cluster.py           # UMAP 2D + KMeans/HDBSCAN -> data/points.parquet
python 04_separability.py             # optional: separability metrics -> results/
python 05_divergence.py               # observer divergence -> data/divergence_*
python app.py                         # http://127.0.0.1:8050

python -m pytest tests -q             # divergence metric unit tests
```

`04_separability.py` is optional — the dashboard runs without it and simply
hides the separability views. It takes roughly 90 minutes at the default
`--reps 200`, almost all of it in the permutation null (logistic regression is
far slower to converge on shuffled labels than on real ones). `--reps 50`
or `--skip-umap` cut that down.

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
| `04_separability.py` | Per-code probes, permutation null, TF-IDF baseline, UMAP stability |
| `divergence.py` | Pure observer-divergence metrics: intervals, COTC, temporal Jaccard, SMID, profile JSD, bands |
| `05_divergence.py` | main-all.json + xlsx → normalise, join, validate, score all 108 maps in both modes |
| `data_access.py` | In-memory store: table, embeddings, per-code boolean masks, divergence artefacts |
| `tests/` | pytest unit tests for the divergence metric layer |
| `app.py` | Dash app: filter rail, panels A–F, inspector rail |
| `data/` | Generated artefacts — committed so the app runs without the API |
| `results/` | Separability tables, paper figures, UMAP stability — gitignored |

Source workbook: `../data/feedback_100%_labeled.xlsx`. `01_preprocess.py` reads
sheet **`Reasons`** (the tidy long format). `05_divergence.py` reads **both**:
the first sheet's 27 binary check-mark columns are its source of truth for the
D1–D5 code sets, and `Reasons` supplies confidence, partial codes and the coder's
reason for the inspector. The two agree on codes for all 1,746 rows in all five
dimensions, and the build reports it loudly if they ever stop agreeing.

Behavioural source: `../dashboard/data/main-all.json` (feedback anchors,
intervals, layout names, observer assignment). Both paths are overridable with
`--json` / `--xlsx` or `DIVERGENCE_JSON` / `FEEDBACK_XLSX`.

## Sharing it outside the server

The app binds `127.0.0.1` only. To hand collaborators a link:

```bash
./serve_public.sh            # start app + Cloudflare quick tunnel, prints the URL
./serve_public.sh stop       # tear both down
```

Credentials are generated once into `~/.dash_credentials` (chmod 600, outside
the repo, gitignored) and injected as `DASH_USER` / `DASH_PASS`. **When those
two variables are set the app requires HTTP Basic Auth on every request**; when
they are unset it starts open and prints a warning, which is only acceptable on
loopback.

Authentication is not optional here: every panel renders verbatim participant
feedback plus participant ids, so an open link would publish human-subjects
data. Check what your IRB / consent form permits before sharing the URL at all,
and prefer the SSH tunnel below for anything beyond a quick demo.

Caveats of a quick tunnel: the `*.trycloudflare.com` URL is **ephemeral** — it
changes on every restart and dies with the process — and all traffic transits
Cloudflare. A stable hostname needs a Cloudflare account and a named tunnel.

For your own use, no tunnel is needed — forward the port over SSH instead:

```bash
ssh -N -L 8050:localhost:8050 <user>@<server>   # then http://localhost:8050
```

VSCode Remote-SSH does the same thing from its **PORTS** panel.

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
- **Between dimensions → AND.** Competence, score, valence, regime, agent count,
  bucket, confidence and keyword all AND together as well.
- **Agent count** is the layout suffix (`..._4` → 4 agents, otherwise 2), never
  "does the filename contain a 4" — that test would misread every `seed4`,
  `_4020000_` and `_40` trajectory. Empty means all, so the default behaviour of
  panels A–E is unchanged.
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

## Separability analysis (`04_separability.py`)

Turns "D1 splits, D4 looks mixed" from an impression into a measurement.

- Every metric is computed on the **original 3072-d embeddings**, never on the
  UMAP coordinates — measuring separability on a projection built to display
  separability would be circular.
- Cross-validation is **`GroupKFold(5)` on participant_id**, so a probe cannot
  score by memorising one participant's writing style.
- Multi-label is handled honestly: the headline metric is **per-code
  one-vs-rest presence**, not "primary code only". Silhouette is the one
  exception (it needs a hard partition) and is computed on the single-label
  subset only, which the table footnotes.
- Codes with **n < 20** are excluded from probing and listed in the
  `codes_excluded` column — never silently dropped.
- Chance is stated three ways: AUROC 0.5, a **participant-block permutation
  null** (R=200, whole label blocks swapped between same-sized participants so
  within-participant structure survives), and a **TF-IDF lexical baseline**
  under the identical CV, which says how much of the separation is surface
  wording rather than meaning.
- Both label sets are reported: **as-coded** and **leaf→parent roll-up**.

Outputs land in `results/`: `separability_by_dimension.csv`,
`separability_by_code.csv`, `d1_d3_crosstab.csv`, `separability_summary.json`,
`fig_separability.{svg,png}`, `fig_code_auroc.{svg,png}` and
`umap_stability/`.

These embedding-based measures are **convergent evidence complementing
inter-coder reliability, not a substitute for it** — that sentence belongs in
any write-up that uses these numbers.

## Panels

- **A · Embedding map** — UMAP of `text-embedding-3-large`, 13 colour-by options,
  hover shows the full text, click opens the inspector. Three views:
  - **map** — the projection itself.
  - **5-dimension facet** — the same coordinates coloured by each dimension in
    turn. Each header carries that dimension's probe AUROC and its gain over
    the lexical baseline, and every code in the legend carries its own AUROC,
    so the "this dimension looks mixed" impression is never made on eyeballs
    alone.
  - **UMAP stability** — the same points re-projected across seeds ×
    `n_neighbors`, answering whether a pattern is a property of the data or of
    the hyper-parameters.

  Below the map, the **separability** section reports macro-AUROC against the
  TF-IDF baseline with a chance line and fold error bars, per-code AUROC, and
  a table with silhouette, kNN purity vs. its null, and the permutation p/z.
  All of it is read from `results/`; the section disappears if
  `04_separability.py` has not been run.
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
- **F · Observer divergence** — the four metrics below over the 108 maps, with a
  pinnable per-map drawer. Definitions in *Observer divergence*.
- **Inspector rail** (right) — full text with keyword highlighting, condition
  chips, all five dimensions with codes, confidence and the coder's reason, and
  the 5 nearest neighbours in embedding space as clickable jumps. Driven by
  clicks in Panel A. (Previously labelled "Panel F"; the letter now belongs to
  the divergence tab.)

## Observer divergence (`05_divergence.py`, Panel F)

Turns "these 8 people watched the same replay and wrote different things" into
four numbers per trajectory. **The unit of analysis is the map.** One point in
the distribution is one trajectory; a feedback item and an observer pair are
never treated as independent samples.

All computation lives in `divergence.py` (pure functions) and `05_divergence.py`
(build). The panel reads `data/divergence_maps.parquet`,
`data/divergence_detail.json.gz` and `data/divergence_report.json` and computes
nothing, which is what makes a filter change unable to move a score, a band or
an axis. The panel hides itself with a build hint if those files are missing.

### Normalisation

| Field | Rule |
|---|---|
| trajectory id | the full `episode.fileName`, e.g. `2_forced_hard/Middle/2_forced_hard_seed10_6020000_60.json` |
| performance group | `participant.group` → `low` / `mid` / `high` (`Middle` folds into `mid`) |
| policy | `forced` / `incentivized`, read off `episode.layoutName` |
| agent count | 4 iff `layoutName.endswith("_4")`, else 2 |
| feedback items | `episodes[].feedbackItems` only — the participant-level `feedbackItems` array is a flattened duplicate of exactly those and is never aggregated |

JSON and Excel join on **participant_id + basename(fileName) + normalised
feedback text + sentiment/feedback_score + occurrence index inside the duplicate
key**. Three participants submitted byte-identical feedback twice for the same
trajectory; the occurrence index pairs the two JSON array entries with the two
Excel rows in order, so the join stays 1:1 instead of fanning out to 2×2.
`data/divergence_report.json` records the counts and samples every unmatched or
duplicate row — currently **1,746 joined, 0 unmatched**.

Checked at every build, against the spec: 216 participants, 864
episode-observations, 108 trajectories, 8 observers each, 1,746 feedback items
(1,595 ranged / 151 range-free), and a 3 groups × 2 policies × 2 agent counts ×
9 maps design grid.

### Frames, seconds and the two modes

The playback step is **0.42 s/frame** (`FRAME_DURATION` in
`overcook_simulation/src/App.jsx:128`), i.e. ≈2.38 fps, and each of the 108
trajectories is exactly **201 frames** (`len(dynamicState)` in its seed file).
Neither number is inferred from the `40/60/80/100` tail of the filename, which is
a condition label and not a duration.

- **Primary** — only items with `DidSpecifyRange` and a start/end pair (1,595).
- **Sensitivity** — the same, plus the 151 range-free items widened to
  `baseFrame ± 2 s` and cut at the trajectory boundary. At 0.42 s/frame that is
  **±5 frames**; it would be ±4 only if the player ran at exactly 2 fps.

Intervals are inclusive frame ranges, and one observer's overlapping **and**
adjacent intervals are merged before any metric runs. A stored `baseFrame` is
never repaired: 253 of the 1,595 ranged items have an anchor outside their own
window, because the player let people drag the window off the anchor. COTC and
SMID use that stored anchor as the focal point and peer *intervals* for coverage.

### The four metrics

All four are oriented so **higher = more divergence**, all live in [0,1], and
none is ever NaN. The two temporal metrics are stored as raw convergence and
displayed as `1 − x`, with the raw score in the hover and the drawer.

| Metric | Definition | Aggregation |
|---|---|---|
| **COTC** | is a focal item's `baseFrame` inside each of the other 7 assigned observers' merged timelines? item score = covering peers / 7 | item → focal observer → map |
| **Temporal Jaccard** | frame-level ∩/∪ of two merged timelines over the 28 unordered pairs. One side empty → 0; both empty → undefined and dropped from the mean | pair → map |
| **SMID** | for a focal anchor, the peer item whose interval contains it (nearest peer anchor wins; ties break on interval length, then feedback index, then docId), scored as the macro-average of the per-dimension code-set Jaccard distance over the dimensions not empty on *both* sides | item → directed pair → available peers → focal observers |
| **Profile JSD** | per observer and dimension, a code-frequency profile normalised to sum 1; base-2 JSD per pair, macro-averaged over the dimensions both observers populate | pair → map |

The COTC denominator is the **assigned** peer count (7), not the active one, so
an observer who submitted nothing counts as a non-covering peer instead of
shrinking the denominator.

Stored alongside each map score: the raw convergence score, per-dimension SMID
and JSD, matched item and directed-pair counts, match rate, valid-pair counts,
and — in the detail file — every item anchor with its covering peer intervals,
every pair's ∩/∪, every SMID match with both code sets, and every observer's
normalised profile. The four metric inspectors in the drawer read exactly that.

### Bands

`score < q33` → Low, `q33 ≤ score < q67` → Mid, `score ≥ q67` → High, with the
quantiles taken over **all 108 maps** for that metric and mode and then frozen.
Narrowing a filter never refits a threshold, and the y-axis range is frozen the
same way — otherwise two selections would look equally spread when they are not.
The legend states the rule, the numbers and the mode it was computed in.

### Coverage is shown, not hidden

Every map has 8 assigned observers and the drawer keeps all 8 lanes. In Primary
mode some observers submitted no ranged feedback at all (active observers run
4–8), and 5 of the 864 episode-observations carry no feedback whatsoever — so the
observer roster comes from `episodes[]`, never from submitted feedback. A lane
with nothing usable in the current mode says so explicitly rather than
disappearing. Every map score is shown next to its active-observer, valid-pair
and matched-pair counts, and the panel foot carries the range-free,
anchor-outside-range, long-interval and D1–D5 coverage diagnostics.

Coder confidence, partial codes and coding reasons appear in the inspector and
are deliberately **never used as metric weights**.
