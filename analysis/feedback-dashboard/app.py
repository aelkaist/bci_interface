"""Overcooked human-perceived feedback - analysis dashboard.

Run:  python app.py   ->  http://127.0.0.1:8050

Left rail = global filters shared by every panel.
Tabs A-E  = embedding map / distributions / co-occurrence / competence lens /
            trajectory & observers.
Right     = feedback inspector (Panel F), driven by clicks in Panel A.
"""

from __future__ import annotations

import io
from typing import Dict, List

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from dash import ALL, Dash, Input, Output, State, ctx, dcc, html, no_update
from plotly.subplots import make_subplots

from codebook import (BUCKET_COLOR, CAT8, CODE_COLOR, CODE_NAME, CODE_SYMBOL,
                      CONF_COLOR, CONF_ORDER, CONF_SYMBOL, DIM_LABEL, DIMS,
                      GHOST, GREY, GROUP_COLOR, GROUP_ORDER, GROUP_SYMBOL,
                      NOISE_GREY, OTHER_GREY, REGIME_COLOR, REGIME_ORDER,
                      REGIME_SYMBOL, SCORE_SCALE, SURFACE, SYMBOLS,
                      VALENCE_COLOR, VALENCE_ORDER, VALENCE_SYMBOL,
                      dim_options, is_parent, leaf_codes, tint)
from data_access import STORE

DF = STORE.df
N_TOTAL = STORE.n

FONT = ('Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, '
        '"Segoe UI", Roboto, sans-serif')

BASE = dict(
    paper_bgcolor="#ffffff",
    plot_bgcolor="#fbfbfc",
    font=dict(family=FONT, size=11.5, color="#2a2f36"),
    margin=dict(l=48, r=16, t=42, b=44),
    hoverlabel=dict(font=dict(family=FONT, size=11.5), align="left",
                    bgcolor="#ffffff", bordercolor="#c9ced6"),
    legend=dict(font=dict(size=10.5), bgcolor="rgba(255,255,255,0.85)",
                bordercolor="#e3e6ea", borderwidth=1),
)

# Diverging scale for lift (obs/exp): validated poles, neutral grey midpoint —
# never a near-white centre, which would dissolve into the chart surface.
DIVERGING = [[0.0, "#B2182B"], [0.28, "#D9736B"], [0.5, "#E7E8EA"],
             [0.72, "#5B9BD1"], [1.0, "#14568A"]]

COLOR_OPTIONS = [
    {"label": "Dimension 1 · Focus of Observation", "value": "d1"},
    {"label": "Dimension 2 · Observed Behavior", "value": "d2"},
    {"label": "Dimension 3 · Monitoring Strategy", "value": "d3"},
    {"label": "Dimension 4 · Interpreting Behavior", "value": "d4"},
    {"label": "Dimension 5 · Feedback Type", "value": "d5"},
    {"label": "Agent competence (low / mid / high)", "value": "group"},
    {"label": "Feedback score 1–5 (continuous)", "value": "score"},
    {"label": "Valence (neg / neu / pos)", "value": "valence"},
    {"label": "Regime (forced / incentivized)", "value": "regime"},
    {"label": "Perf bucket (40/60/80/100)", "value": "perf_bucket"},
    {"label": "KMeans cluster (k=12)", "value": "km"},
    {"label": "HDBSCAN cluster", "value": "hdb"},
    {"label": "Coder confidence", "value": "confidence"},
]


# ---------------------------------------------------------------- encoding ---

def code_label(code: str) -> str:
    return "%s  %s" % (code, CODE_NAME.get(code, "?"))


def _cluster_map(col: str) -> dict:
    """Fixed colour/symbol per cluster, computed once over the whole dataset.

    Colour follows the cluster, never its rank inside the current filter, so
    filtering never repaints the survivors. Only the eight largest clusters get
    a hue; the rest fold into one neutral "other" series rather than inventing
    a ninth colour.
    """
    sizes = DF[col].value_counts()
    top = [int(c) for c in sizes.index if int(c) >= 0][:8]
    colors, symbols, labels = {}, {}, {}
    for i, c in enumerate(top):
        k = str(c)
        colors[k] = CAT8[i]
        symbols[k] = SYMBOLS[i]
        kw = STORE.cluster_labels.get(col, {}).get(k, "")
        labels[k] = ("c%s · %s" % (k, kw))[:44]
    n_other = sum(1 for c in sizes.index if int(c) >= 0 and int(c) not in top)
    colors["other"] = OTHER_GREY
    symbols["other"] = "circle"
    labels["other"] = "other (%d smaller cluster%s)" % (n_other,
                                                        "" if n_other == 1 else "s")
    colors["noise"] = NOISE_GREY
    symbols["noise"] = "circle-open"
    labels["noise"] = "noise (unclustered)"
    return {"top": set(str(c) for c in top), "colors": colors,
            "symbols": symbols, "labels": labels,
            "order": [str(c) for c in top] + (["other"] if n_other else []),
            "has_noise": (DF[col] == -1).any()}


CLUSTER_MAP = {c: _cluster_map(c) for c in ("km", "hdb")}


def encode(kind: str, sub: pd.DataFrame) -> dict:
    """-> {mode, values, cats, colors, symbols, labels, title}"""
    if kind == "score":
        return {"mode": "cont", "values": sub["score"].to_numpy(),
                "title": "feedback score (diverging: 1 negative → 5 positive)"}

    if kind.startswith("d") and kind[1:].isdigit():
        d = int(kind[1:])
        vals = sub["d%d_primary" % d].to_numpy()
        order = [c for c in dim_options(d) if not is_parent(c)]
        cats = [c for c in order if (vals == c).any()]
        if (vals == "none").any():
            cats.append("none")
        colors, symbols = dict(CODE_COLOR), dict(CODE_SYMBOL)
        colors["none"], symbols["none"] = GREY, "circle-open"
        labels = {c: code_label(c) for c in cats if c != "none"}
        labels["none"] = "none  (no code)"
        return {"mode": "cat", "values": vals, "cats": cats, "colors": colors,
                "symbols": symbols, "labels": labels,
                "title": "D%d · %s" % (d, DIM_LABEL[d])}

    if kind == "group":
        vals = sub["group"].to_numpy()
        cats = [c for c in GROUP_ORDER if (vals == c).any()]
        return {"mode": "cat", "values": vals, "cats": cats,
                "colors": GROUP_COLOR, "symbols": GROUP_SYMBOL,
                "labels": {c: c for c in cats},
                "title": "agent competence (ordered)"}

    if kind == "valence":
        vals = sub["valence"].to_numpy()
        cats = [c for c in VALENCE_ORDER if (vals == c).any()]
        return {"mode": "cat", "values": vals, "cats": cats,
                "colors": VALENCE_COLOR, "symbols": VALENCE_SYMBOL,
                "labels": {c: c for c in cats}, "title": "valence"}

    if kind == "regime":
        vals = sub["regime"].astype(str).to_numpy()
        cats = [c for c in REGIME_ORDER if (vals == c).any()]
        return {"mode": "cat", "values": vals, "cats": cats,
                "colors": REGIME_COLOR, "symbols": REGIME_SYMBOL,
                "labels": {c: c for c in cats}, "title": "regime"}

    if kind == "confidence":
        vals = sub["conf_any"].to_numpy()
        cats = [c for c in CONF_ORDER if (vals == c).any()]
        return {"mode": "cat", "values": vals, "cats": cats,
                "colors": CONF_COLOR, "symbols": CONF_SYMBOL,
                "labels": {c: c for c in cats}, "title": "coder confidence"}

    if kind == "perf_bucket":
        vals = sub["perf_bucket"].astype(str).to_numpy()
        cats = [str(b) for b in sorted(BUCKET_COLOR) if (vals == str(b)).any()]
        return {"mode": "cat", "values": vals, "cats": cats,
                "colors": {str(k): v for k, v in BUCKET_COLOR.items()},
                "symbols": {str(k): s for k, s in
                            zip(sorted(BUCKET_COLOR), SYMBOLS)},
                "labels": {c: "bucket %s" % c for c in cats},
                "title": "perf bucket (ordered)"}

    if kind in ("km", "hdb"):
        cm = CLUSTER_MAP[kind]
        raw = sub[kind].astype(int).astype(str).to_numpy()
        vals = np.array(["noise" if v == "-1" else
                         (v if v in cm["top"] else "other") for v in raw])
        cats = [c for c in cm["order"] if (vals == c).any()]
        if (vals == "noise").any():
            cats.append("noise")
        return {"mode": "cat", "values": vals, "cats": cats,
                "colors": cm["colors"], "symbols": cm["symbols"],
                "labels": cm["labels"],
                "title": "%s cluster" % ("KMeans" if kind == "km" else "HDBSCAN")}

    raise ValueError(kind)


def customdata(sub: pd.DataFrame) -> np.ndarray:
    codes = ["  ·  ".join("D%d %s" % (d, sub["d%d_codes" % d].iloc[i] or "—")
                          for d in DIMS) for i in range(len(sub))]
    return np.column_stack([
        sub["id"].to_numpy(),
        sub["text_wrapped"].to_numpy(),
        sub["score"].to_numpy(),
        sub["group"].to_numpy(),
        np.array(codes, dtype=object),
        sub["traj"].to_numpy(),
    ])


HOVER = ("<b>%{customdata[1]}</b><br>"
         "<span style='color:#6b7280'>score %{customdata[2]} · "
         "%{customdata[3]} · %{customdata[5]}</span><br>"
         "<span style='color:#6b7280'>%{customdata[4]}</span><extra></extra>")


def empty_fig(msg: str, height: int = 420) -> go.Figure:
    f = go.Figure()
    f.update_layout(height=height, **BASE)
    f.add_annotation(text=msg, showarrow=False, x=0.5, y=0.5,
                     xref="paper", yref="paper",
                     font=dict(size=13, color="#8b929c"))
    f.update_xaxes(visible=False)
    f.update_yaxes(visible=False)
    return f


# --------------------------------------------------------------- Panel A ----

def fig_embedding(ids: List[int], color_by: str, show_ghost: bool,
                  selected, traj_hi) -> go.Figure:
    fig = go.Figure()
    keep = DF["id"].isin(ids).to_numpy()

    if show_ghost and (~keep).any():
        bg = DF[~keep]
        fig.add_trace(go.Scattergl(
            x=bg["x"], y=bg["y"], mode="markers", name="filtered out",
            marker=dict(size=4, color=GHOST, opacity=0.55, line=dict(width=0)),
            hoverinfo="skip", showlegend=False))

    sub = DF[keep]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 560)

    enc = encode(color_by, sub)
    cd = customdata(sub)

    if enc["mode"] == "cont":
        fig.add_trace(go.Scattergl(
            x=sub["x"], y=sub["y"], mode="markers", customdata=cd,
            marker=dict(size=7.5, color=enc["values"], colorscale=SCORE_SCALE,
                        cmin=1, cmax=5, opacity=0.9,
                        line=dict(width=0.8, color=SURFACE),
                        colorbar=dict(title=dict(text="score", side="right"),
                                      thickness=11, len=0.55, x=1.005,
                                      tickvals=[1, 2, 3, 4, 5])),
            hovertemplate=HOVER, showlegend=False))
    else:
        multi = None
        if color_by.startswith("d") and color_by[1:].isdigit():
            multi = sub["d%d_n" % int(color_by[1:])].to_numpy() > 1
        for cat in enc["cats"]:
            m = enc["values"] == cat
            if not m.any():
                continue
            # 1px surface ring separates overlapping marks; a dark 2px ring is
            # the multi-label flag.
            lw = np.where(multi[m], 1.3, 0.8) if multi is not None else 0.8
            lc = (np.where(multi[m], "rgba(28,32,38,0.55)", SURFACE)
                  if multi is not None else SURFACE)
            fig.add_trace(go.Scattergl(
                x=sub["x"][m], y=sub["y"][m], mode="markers",
                name=enc["labels"].get(cat, cat), customdata=cd[m],
                marker=dict(size=7.5, color=enc["colors"].get(cat, GREY),
                            symbol=enc["symbols"].get(cat, "circle"),
                            opacity=0.88, line=dict(width=lw, color=lc)),
                hovertemplate=HOVER))

    if traj_hi:
        th = sub[sub["traj"] == traj_hi]
        if len(th):
            fig.add_trace(go.Scattergl(
                x=th["x"], y=th["y"], mode="markers", name="trajectory",
                marker=dict(size=15, color="rgba(0,0,0,0)", symbol="circle",
                            line=dict(width=1.6, color="#111318")),
                hoverinfo="skip", showlegend=False))

    if selected is not None and int(selected) in set(sub["id"].tolist()):
        s = DF[DF["id"] == int(selected)]
        fig.add_trace(go.Scattergl(
            x=s["x"], y=s["y"], mode="markers", name="selected",
            marker=dict(size=20, color="rgba(0,0,0,0)", symbol="circle",
                        line=dict(width=2.4, color="#D55E00")),
            hoverinfo="skip", showlegend=False))

    lay = dict(BASE)
    lay["margin"] = dict(l=28, r=16, t=34, b=28)
    fig.update_layout(
        height=560, uirevision="embed", dragmode="pan", hovermode="closest",
        title=dict(text="Semantic embedding map · colour = %s" % enc["title"],
                   font=dict(size=12.5, color="#5a616b"), x=0.008, y=0.985),
        legend=dict(font=dict(size=10.5), bgcolor="rgba(255,255,255,0.88)",
                    bordercolor="#e3e6ea", borderwidth=1,
                    itemsizing="constant", y=1, x=1.003),
        **{k: v for k, v in lay.items() if k not in ("legend",)})
    fig.update_xaxes(visible=False, range=[-4, 104])
    fig.update_yaxes(visible=False, range=[-4, 104], scaleanchor="x")
    return fig


def fig_facet(ids: List[int], show_ghost: bool) -> go.Figure:
    keep = DF["id"].isin(ids).to_numpy()
    sub = DF[keep]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 430)
    bg = DF[~keep]

    fig = make_subplots(rows=1, cols=5, horizontal_spacing=0.008,
                        subplot_titles=["D%d · %s" % (d, DIM_LABEL[d])
                                        for d in DIMS])
    cd = customdata(sub)
    for i, d in enumerate(DIMS, start=1):
        if show_ghost and len(bg):
            fig.add_trace(go.Scattergl(
                x=bg["x"], y=bg["y"], mode="markers",
                marker=dict(size=2.6, color=GHOST, opacity=0.6),
                hoverinfo="skip", showlegend=False), row=1, col=i)
        enc = encode("d%d" % d, sub)
        multi = sub["d%d_n" % d].to_numpy() > 1
        for cat in enc["cats"]:
            m = enc["values"] == cat
            if not m.any():
                continue
            fig.add_trace(go.Scattergl(
                x=sub["x"][m], y=sub["y"][m], mode="markers",
                name=enc["labels"].get(cat, cat),
                legendgroup="d%d" % d,
                legendgrouptitle_text="D%d" % d,
                customdata=cd[m],
                marker=dict(size=4.6, color=enc["colors"].get(cat, GREY),
                            symbol=enc["symbols"].get(cat, "circle"),
                            opacity=0.85,
                            line=dict(width=np.where(multi[m], 0.9, 0.0),
                                      color="rgba(28,32,38,0.55)")),
                hovertemplate=HOVER), row=1, col=i)

    lay = dict(BASE)
    lay["margin"] = dict(l=10, r=10, t=34, b=96)
    fig.update_layout(
        height=430, uirevision="facet", hovermode="closest",
        legend=dict(orientation="h", y=-0.03, x=0, font=dict(size=9),
                    itemsizing="constant", tracegroupgap=6,
                    bgcolor="rgba(255,255,255,0)", borderwidth=0),
        **{k: v for k, v in lay.items() if k != "legend"})
    fig.update_annotations(font=dict(size=11, color="#5a616b"))
    for i in range(1, 6):
        fig.update_xaxes(visible=False, row=1, col=i)
        fig.update_yaxes(visible=False, row=1, col=i,
                         scaleanchor="x%s" % ("" if i == 1 else i))
    return fig


# --------------------------------------------------------------- Panel B ----

def fig_distribution(ids: List[int], split: str) -> go.Figure:
    sub = DF[DF["id"].isin(ids)]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 860)

    fig = make_subplots(rows=3, cols=2, vertical_spacing=0.10,
                        horizontal_spacing=0.26,
                        subplot_titles=["D%d · %s" % (d, DIM_LABEL[d])
                                        for d in DIMS] + [""])
    if split == "group":
        cats, cmap = [g for g in GROUP_ORDER if g in set(sub["group"])], GROUP_COLOR
        col = "group"
    elif split == "valence":
        cats = [v for v in VALENCE_ORDER if v in set(sub["valence"])]
        cmap, col = VALENCE_COLOR, "valence"
    else:
        cats, cmap, col = [None], None, None

    seen = set()
    sparse_cut = max(3, 0.05 * len(sub))
    for k, d in enumerate(DIMS):
        r, c = (k // 2) + 1, (k % 2) + 1
        codes = leaf_codes(d)
        totals = {cd_: int(STORE.mask[cd_][sub.index.to_numpy()].sum())
                  for cd_ in codes}
        order = sorted(codes, key=lambda x: totals[x])
        ylab = [("%s  %s" % (x, CODE_NAME[x]))[:42] +
                ("  ⚠" if totals[x] < sparse_cut else "") for x in order]
        for cat in cats:
            rows = sub if cat is None else sub[sub[col] == cat]
            idx = rows.index.to_numpy()
            vals = [int(STORE.mask[x][idx].sum()) for x in order]
            fig.add_trace(go.Bar(
                y=ylab, x=vals, orientation="h",
                name=(cat or "count"),
                legendgroup=(cat or "count"),
                showlegend=(cat or "count") not in seen,
                marker=dict(color=(cmap[cat] if cmap else CAT8[0]),
                            line=dict(width=1, color=SURFACE)),
                hovertemplate=("%{y}<br>" + ("%s: " % cat if cat else "") +
                               "%{x} feedback<extra></extra>")),
                row=r, col=c)
            seen.add(cat or "count")

    lay = dict(BASE)
    lay["margin"] = dict(l=8, r=16, t=44, b=40)
    fig.update_layout(height=860, barmode="stack", bargap=0.28,
                      barcornerradius=3,
                      legend=dict(orientation="h", y=1.07, x=0.63,
                                  font=dict(size=10.5), borderwidth=0,
                                  bgcolor="rgba(0,0,0,0)"),
                      **{k: v for k, v in lay.items() if k != "legend"})
    fig.update_annotations(font=dict(size=11.5, color="#5a616b"))
    fig.update_yaxes(automargin=True, tickfont=dict(size=10))
    fig.update_xaxes(gridcolor="#eceef1", zeroline=False,
                     title=dict(text="feedback", font=dict(size=9.5)))
    return fig


# --------------------------------------------------------------- Panel C ----

def _pair_matrix(idx: np.ndarray, rows: List[str], cols: List[str]) -> np.ndarray:
    M = np.zeros((len(rows), len(cols)), dtype=float)
    rm = [STORE.mask[r][idx] for r in rows]
    cm = [STORE.mask[c][idx] for c in cols]
    for i, a in enumerate(rm):
        for j, b in enumerate(cm):
            M[i, j] = float((a & b).sum())
    return M


def fig_cross(ids: List[int], dx: int, dy: int, metric: str) -> go.Figure:
    sub = DF[DF["id"].isin(ids)]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 460)
    idx = sub.index.to_numpy()
    # rows are reversed so the first code of the dimension sits at the top of
    # the heatmap (plotly draws row 0 at the bottom)
    cols, rows = leaf_codes(dx), leaf_codes(dy)[::-1]
    M = _pair_matrix(idx, rows, cols)
    n = float(len(sub))
    rtot = np.array([float(STORE.mask[r][idx].sum()) for r in rows])
    ctot = np.array([float(STORE.mask[c][idx].sum()) for c in cols])

    if metric == "row":
        Z = np.divide(M, rtot[:, None], out=np.zeros_like(M),
                      where=rtot[:, None] > 0) * 100
        scale, mid, fmt, cb = "Blues", None, "%{z:.0f}%", "% of row code"
    elif metric == "lift":
        exp = np.outer(rtot, ctot) / max(n, 1.0)
        Z = np.divide(M, exp, out=np.ones_like(M), where=exp > 0)
        scale, mid, fmt, cb = DIVERGING, 1.0, "%{z:.2f}×", "lift (obs/exp)"
    else:
        Z, scale, mid, fmt, cb = M, "Blues", None, "%{z:.0f}", "co-occurrence"

    fig = go.Figure(go.Heatmap(
        z=Z, x=[code_label(c)[:32] for c in cols],
        y=[code_label(r)[:32] for r in rows],
        customdata=M, colorscale=scale, zmid=mid,
        xgap=2, ygap=2,
        colorbar=dict(title=dict(text=cb, side="right"), thickness=11, len=0.7),
        hovertemplate=("D%d %%{y}<br>D%d %%{x}<br>" % (dy, dx)) +
                      fmt + "<br>n = %{customdata:.0f}<extra></extra>"))
    lay = dict(BASE)
    lay["margin"] = dict(l=8, r=16, t=46, b=110)
    fig.update_layout(
        height=460,
        title=dict(text="D%d %s  ×  D%d %s   (click a cell to filter)"
                        % (dy, DIM_LABEL[dy], dx, DIM_LABEL[dx]),
                   font=dict(size=12.5, color="#5a616b"), x=0.005),
        **lay)
    fig.update_xaxes(tickangle=-38, tickfont=dict(size=9.5), automargin=True)
    fig.update_yaxes(tickfont=dict(size=9.5), automargin=True)
    return fig


def fig_within(ids: List[int], d: int, metric: str) -> go.Figure:
    sub = DF[DF["id"].isin(ids)]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 460)
    idx = sub.index.to_numpy()
    codes = leaf_codes(d)
    M = _pair_matrix(idx, codes, codes)   # symmetric; y is flipped at render
    tot = np.array([float(STORE.mask[c][idx].sum()) for c in codes])

    if metric == "jaccard":
        union = tot[:, None] + tot[None, :] - M
        Z = np.divide(M, union, out=np.zeros_like(M), where=union > 0)
        fmt, cb, scale = "%{z:.2f}", "Jaccard", "Purples"
    else:
        Z, fmt, cb, scale = M.copy(), "%{z:.0f}", "co-occurrence", "Purples"
    Zm = Z.copy()
    np.fill_diagonal(Zm, np.nan)

    fig = go.Figure(go.Heatmap(
        z=Zm, x=[code_label(c)[:30] for c in codes],
        y=[code_label(c)[:30] for c in codes],
        customdata=M, colorscale=scale, xgap=2, ygap=2,
        colorbar=dict(title=dict(text=cb, side="right"), thickness=11, len=0.7),
        hovertemplate="%{y}<br>%{x}<br>" + fmt +
                      "<br>n = %{customdata:.0f}<extra></extra>"))
    lay = dict(BASE)
    lay["margin"] = dict(l=8, r=16, t=46, b=110)
    fig.update_layout(
        height=460,
        title=dict(text="Multi-label overlap inside D%d · %s  "
                        "(diagonal blanked)" % (d, DIM_LABEL[d]),
                   font=dict(size=12.5, color="#5a616b"), x=0.005),
        **lay)
    fig.update_xaxes(tickangle=-38, tickfont=dict(size=9.5), automargin=True)
    fig.update_yaxes(tickfont=dict(size=9.5), automargin=True)
    return fig


# --------------------------------------------------------------- Panel D ----

def fig_comp_codes(ids: List[int], d: int) -> go.Figure:
    sub = DF[DF["id"].isin(ids)]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 400)
    codes = leaf_codes(d)
    fig = go.Figure()
    for g in GROUP_ORDER:
        rows = sub[sub["group"] == g]
        if not len(rows):
            continue
        idx = rows.index.to_numpy()
        share = [100.0 * STORE.mask[c][idx].sum() / len(rows) for c in codes]
        raw = [int(STORE.mask[c][idx].sum()) for c in codes]
        fig.add_trace(go.Bar(
            x=[code_label(c)[:28] for c in codes], y=share, name="%s (n=%d)" % (g, len(rows)),
            marker=dict(color=GROUP_COLOR[g], line=dict(width=1, color=SURFACE)),
            customdata=raw,
            hovertemplate="%{x}<br>" + g +
                          ": %{y:.1f}% of its feedback<br>n = %{customdata}"
                          "<extra></extra>"))
    lay = dict(BASE)
    lay["margin"] = dict(l=48, r=16, t=44, b=120)
    fig.update_layout(
        height=400, barmode="group", bargap=0.3, bargroupgap=0.06,
        barcornerradius=3,
        title=dict(text="D%d code prevalence by agent competence "
                        "(within-group %%)" % d,
                   font=dict(size=12.5, color="#5a616b"), x=0.005),
        legend=dict(orientation="h", y=1.10, x=0.55, font=dict(size=10.5),
                    borderwidth=0, bgcolor="rgba(0,0,0,0)"),
        **{k: v for k, v in lay.items() if k != "legend"})
    fig.update_xaxes(tickangle=-32, tickfont=dict(size=9.5), automargin=True)
    fig.update_yaxes(title=dict(text="% of feedback in group", font=dict(size=10)),
                     gridcolor="#eceef1", zeroline=False)
    return fig


def fig_comp_score(ids: List[int]) -> go.Figure:
    sub = DF[DF["id"].isin(ids)]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 400)
    fig = go.Figure()
    notes = []
    for g in GROUP_ORDER:
        rows = sub[sub["group"] == g]
        if not len(rows):
            continue
        vc = rows["score"].value_counts().reindex(range(1, 6), fill_value=0)
        fig.add_trace(go.Bar(
            x=list(range(1, 6)), y=100.0 * vc.to_numpy() / len(rows),
            name="%s (n=%d, mean %.2f)" % (g, len(rows), rows["score"].mean()),
            marker=dict(color=GROUP_COLOR[g], line=dict(width=1, color=SURFACE)),
            customdata=vc.to_numpy(),
            hovertemplate="score %{x}<br>" + g +
                          ": %{y:.1f}%  (n = %{customdata})<extra></extra>"))
        notes.append("%s %.2f" % (g, rows["score"].mean()))
    lay = dict(BASE)
    lay["margin"] = dict(l=48, r=16, t=44, b=44)
    fig.update_layout(
        height=400, barmode="group", bargap=0.28, barcornerradius=3,
        title=dict(text="Participant feedback score by competence · mean: %s"
                        % " / ".join(notes),
                   font=dict(size=12.5, color="#5a616b"), x=0.005),
        legend=dict(orientation="h", y=1.10, x=0.4, font=dict(size=10.5),
                    borderwidth=0, bgcolor="rgba(0,0,0,0)"),
        **{k: v for k, v in lay.items() if k != "legend"})
    fig.update_xaxes(tickmode="linear", dtick=1,
                     title=dict(text="feedback score", font=dict(size=10)))
    fig.update_yaxes(title=dict(text="% of feedback in group", font=dict(size=10)),
                     gridcolor="#eceef1", zeroline=False)
    return fig


def fig_perf(ids: List[int]) -> go.Figure:
    """Extension hook: system-performance proxy vs. human-perceived score."""
    sub = DF[DF["id"].isin(ids)]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 420)
    agg = (sub.groupby(["traj", "group", "regime"], as_index=False)
              .agg(mean_score=("score", "mean"), n=("id", "size"),
                   perf_raw=("perf_raw", "first"),
                   perf_bucket=("perf_bucket", "first")))
    agg["perf_raw"] = agg["perf_raw"].astype(float)
    fig = go.Figure()
    sym = {"forced": "circle", "incentivized": "diamond"}
    for g in GROUP_ORDER:
        for rg in REGIME_ORDER:
            a = agg[(agg["group"] == g) & (agg["regime"] == rg)]
            if not len(a):
                continue
            fig.add_trace(go.Scatter(
                x=a["perf_raw"], y=a["mean_score"], mode="markers",
                name="%s · %s" % (g, rg),
                marker=dict(size=6 + 1.6 * np.sqrt(a["n"]),
                            color=GROUP_COLOR[g], symbol=sym[rg], opacity=0.8,
                            line=dict(width=0.6, color="rgba(30,34,40,0.5)")),
                customdata=np.column_stack([a["traj"], a["n"], a["perf_bucket"]]),
                hovertemplate="%{customdata[0]}<br>mean score %{y:.2f} "
                              "(n=%{customdata[1]})<br>perf_raw %{x:,.0f} · "
                              "bucket %{customdata[2]}<extra></extra>"))
    if len(agg) > 4:
        hi = agg["perf_raw"].quantile(0.75)
        lo = agg["mean_score"].quantile(0.25)
        flag = agg[(agg["perf_raw"] >= hi) & (agg["mean_score"] <= lo)]
        if len(flag):
            fig.add_trace(go.Scatter(
                x=flag["perf_raw"], y=flag["mean_score"], mode="markers",
                name="high perf · low perceived",
                marker=dict(size=20, color="rgba(0,0,0,0)",
                            line=dict(width=1.6, color="#B2182B")),
                hoverinfo="skip"))
    lay = dict(BASE)
    lay["margin"] = dict(l=52, r=16, t=48, b=48)
    fig.update_layout(
        height=420,
        title=dict(text="Trajectory perf proxy (parsed from filename) vs. mean "
                        "perceived score — join real system metrics here",
                   font=dict(size=12.5, color="#5a616b"), x=0.005),
        legend=dict(font=dict(size=10), borderwidth=0, y=1, x=1.005,
                    bgcolor="rgba(0,0,0,0)"),
        **{k: v for k, v in lay.items() if k != "legend"})
    fig.update_xaxes(title=dict(text="perf_raw (unvalidated proxy)",
                                font=dict(size=10)), gridcolor="#eceef1")
    fig.update_yaxes(title=dict(text="mean feedback score", font=dict(size=10)),
                     gridcolor="#eceef1", range=[0.8, 5.2])
    return fig


# --------------------------------------------------------------- Panel E ----

def fig_observers(traj: str, ids: List[int]) -> go.Figure:
    sub = DF[(DF["traj"] == traj) & (DF["id"].isin(ids))]
    if len(sub) == 0:
        return empty_fig("No feedback for this trajectory under current filters.", 460)
    obs = sorted(sub["pid"].unique().tolist())
    codes, seps, ticks = [], [], []
    for d in DIMS:
        c = leaf_codes(d)
        codes += c
        ticks += ["%s" % x for x in c]
        seps.append(len(codes) - 0.5)
    M = np.zeros((len(obs), len(codes)))
    for i, p in enumerate(obs):
        idx = sub[sub["pid"] == p].index.to_numpy()
        for j, c in enumerate(codes):
            M[i, j] = float(STORE.mask[c][idx].sum())

    n_obs = M.shape[0]
    fig = make_subplots(rows=2, cols=1, row_heights=[0.62, 0.38],
                        shared_xaxes=True, vertical_spacing=0.08,
                        subplot_titles=["observer × code (cell = # of that "
                                        "observer's feedbacks with the code)",
                                        "observer agreement: how many of the %d "
                                        "observers used the code" % n_obs])
    fig.add_trace(go.Heatmap(
        z=M, x=ticks, y=["obs %d · %s…" % (i + 1, p[:6]) for i, p in enumerate(obs)],
        colorscale="Blues", xgap=2, ygap=2, showscale=False,
        hovertemplate="%{y}<br>%{x}<br>%{z:.0f} feedback<extra></extra>"),
        row=1, col=1)
    share = 100.0 * (M > 0).sum(axis=0) / max(n_obs, 1)
    fig.add_trace(go.Bar(
        x=ticks, y=share,
        marker=dict(color=[CODE_COLOR.get(c, GREY) for c in codes],
                    line=dict(width=1, color=SURFACE)),
        customdata=(M > 0).sum(axis=0),
        hovertemplate="%{x}<br>%{customdata:.0f} / " + str(n_obs) +
                      " observers (%{y:.0f}%)<extra></extra>",
        showlegend=False), row=2, col=1)

    lay = dict(BASE)
    lay["margin"] = dict(l=8, r=16, t=44, b=70)
    fig.update_layout(height=520, bargap=0.35, barcornerradius=3, **lay)
    fig.update_annotations(font=dict(size=11, color="#5a616b"))
    for s in seps[:-1]:
        fig.add_vline(x=s, line=dict(width=1, color="#c9ced6", dash="dot"))
    fig.update_xaxes(tickangle=-60, tickfont=dict(size=9), automargin=True)
    fig.update_yaxes(tickfont=dict(size=9.5), automargin=True, row=1, col=1)
    fig.update_yaxes(title=dict(text="% observers", font=dict(size=9.5)),
                     gridcolor="#eceef1", range=[0, 105], row=2, col=1)
    return fig


def chip(text: str, color: str) -> html.Span:
    """A hue-tinted label: the swatch carries identity, the text stays ink."""
    return html.Span([html.Span(className="dot",
                                style={"background": color}), text],
                     className="chip",
                     style={"background": tint(color, 0.16),
                            "borderColor": tint(color, 0.45)})


def observer_cards(traj: str, ids: List[int]) -> List:
    sub = DF[(DF["traj"] == traj) & (DF["id"].isin(ids))]
    if len(sub) == 0:
        return [html.Div("No feedback for this trajectory under the current "
                         "filters.", className="muted")]
    out = []
    for i, (pid, rows) in enumerate(sub.groupby("pid"), start=1):
        items = []
        for _, r in rows.iterrows():
            codechips = []
            for d in DIMS:
                for c in r["d%d_list" % d]:
                    codechips.append(chip(c, CODE_COLOR.get(c, GREY)))
                if r["d%d_conf" % d] == "partial fit":
                    codechips.append(chip("D%d partial fit" % d, CAT8[1]))
            items.append(html.Div([
                html.Div([
                    chip("score %d" % r["score"], VALENCE_COLOR[r["valence"]]),
                    html.Span(r["text"], className="obs-text"),
                ]),
                html.Div(codechips, className="chips"),
            ], className="obs-item"))
        out.append(html.Div([
            html.Div([html.B("observer %d" % i),
                      html.Span("  %s" % pid[:10], className="muted mono"),
                      html.Span("  ·  %d feedback" % len(rows), className="muted")],
                     className="obs-head"),
        ] + items, className="obs-card"))
    return out


# ---------------------------------------------------------------- layout ----

def code_checklist(d: int) -> dcc.Checklist:
    opts = []
    for c in dim_options(d):
        if is_parent(c):
            n = sum(STORE.code_count.get(k, 0)
                    for k in leaf_codes(d) if k.startswith(c + "."))
            opts.append({"label": "%s  %s  (%d)" % (c, CODE_NAME[c], n),
                         "value": c})
        else:
            pad = "  " if c.count(".") == 2 else ""
            opts.append({"label": "%s%s  %s  (%d)"
                                  % (pad, c, CODE_NAME[c],
                                     STORE.code_count.get(c, 0)),
                         "value": c})
    return dcc.Checklist(id={"type": "dimfilter", "dim": d}, options=opts,
                         value=[], className="chk", inputClassName="chk-in",
                         labelClassName="chk-lab")


RAIL = html.Div([
    html.Div([html.Span("FILTERS", className="rail-title"),
              html.Button("reset", id="btn-reset", className="btn-mini")],
             className="rail-head"),

    html.Div(id="counter", className="counter"),

    html.Details([
        html.Summary("Taxonomy codes"),
        html.Div([
            html.Div([
                html.Div("D%d · %s" % (d, DIM_LABEL[d]), className="dim-head"),
                code_checklist(d),
            ], className="dim-block") for d in DIMS
        ]),
        html.Div([
            html.Label("within-dimension logic", className="lab"),
            dcc.RadioItems(id="within-logic",
                           options=[{"label": " OR (default)", "value": "or"},
                                    {"label": " AND (advanced)", "value": "and"}],
                           value="or", className="chk radio-inline"),
        ], className="sub-block"),
    ], open=True, className="group"),

    html.Details([
        html.Summary("Condition"),
        html.Label("agent competence", className="lab"),
        dcc.Checklist(id="f-group",
                      options=[{"label": " %s" % g, "value": g}
                               for g in STORE.groups],
                      value=[], className="chk radio-inline"),
        html.Label("regime", className="lab"),
        dcc.Checklist(id="f-regime",
                      options=[{"label": " %s" % r, "value": r}
                               for r in STORE.regimes],
                      value=[], className="chk radio-inline"),
        html.Label("perf bucket (filename proxy)", className="lab"),
        dcc.Checklist(id="f-bucket",
                      options=[{"label": " %d" % b, "value": b}
                               for b in STORE.buckets],
                      value=[], className="chk radio-inline"),
    ], open=True, className="group"),

    html.Details([
        html.Summary("Perceived valence"),
        html.Label("feedback score range", className="lab"),
        dcc.RangeSlider(id="f-score", min=1, max=5, step=1, value=[1, 5],
                        marks={i: str(i) for i in range(1, 6)},
                        tooltip={"placement": "bottom"}),
        html.Label("valence", className="lab"),
        dcc.Checklist(id="f-valence",
                      options=[{"label": " %s" % v, "value": v}
                               for v in VALENCE_ORDER],
                      value=[], className="chk radio-inline"),
    ], open=True, className="group"),

    html.Details([
        html.Summary("Source & quality"),
        html.Label("trajectory", className="lab"),
        dcc.Dropdown(id="f-traj", options=[{"label": t, "value": t}
                                           for t in STORE.trajectories],
                     value=[], multi=True, placeholder="all trajectories",
                     className="dd"),
        dcc.Checklist(id="f-conf",
                      options=[{"label": " confident only (drop any partial fit)",
                                "value": "conf"}],
                      value=[], className="chk"),
        html.Label("keyword in feedback text", className="lab"),
        dcc.Input(id="f-kw", type="text", debounce=True, placeholder="e.g. waiting",
                  className="inp"),
    ], open=True, className="group"),

    html.Button("⤓ download filtered CSV", id="btn-csv", className="btn-wide"),
    dcc.Download(id="dl-csv"),
], className="rail")


TAB_A = html.Div([
    html.Div([
        html.Div([html.Label("colour by", className="lab"),
                  dcc.Dropdown(id="color-by", options=COLOR_OPTIONS, value="d5",
                               clearable=False, className="dd")],
                 style={"flex": "1 1 320px"}),
        dcc.Checklist(id="a-opts",
                      options=[{"label": " 5-dimension facet", "value": "facet"},
                               {"label": " keep filtered-out points as grey ghosts",
                                "value": "ghost"}],
                      value=["ghost"], className="chk radio-inline",
                      style={"paddingTop": "18px"}),
    ], className="toolbar"),
    dcc.Graph(id="g-embed", config={"scrollZoom": True, "displaylogo": False}),
    html.Div("Position = UMAP of text-embedding-3-large. Thicker outline = the "
             "point carries more than one code in the coloured dimension. "
             "Click a point to open the inspector.", className="hint"),
], className="panel")

TAB_B = html.Div([
    html.Div([
        html.Label("split bars by", className="lab"),
        dcc.RadioItems(id="b-split",
                       options=[{"label": " none", "value": "none"},
                                {"label": " competence", "value": "group"},
                                {"label": " valence", "value": "valence"}],
                       value="none", className="chk radio-inline"),
    ], className="toolbar"),
    dcc.Graph(id="g-dist", config={"displaylogo": False}),
    html.Div("⚠ marks codes held by under 5% of the current selection — "
             "candidate coverage weak spots.", className="hint"),
], className="panel")

TAB_C = html.Div([
    html.Div([
        html.Div([html.Label("rows (Y)", className="lab"),
                  dcc.Dropdown(id="c-dy", clearable=False, value=1,
                               options=[{"label": "D%d · %s" % (d, DIM_LABEL[d]),
                                         "value": d} for d in DIMS],
                               className="dd")], style={"flex": "1 1 220px"}),
        html.Div([html.Label("columns (X)", className="lab"),
                  dcc.Dropdown(id="c-dx", clearable=False, value=5,
                               options=[{"label": "D%d · %s" % (d, DIM_LABEL[d]),
                                         "value": d} for d in DIMS],
                               className="dd")], style={"flex": "1 1 220px"}),
        html.Div([html.Label("metric", className="lab"),
                  dcc.RadioItems(id="c-metric",
                                 options=[{"label": " count", "value": "count"},
                                          {"label": " row %", "value": "row"},
                                          {"label": " lift", "value": "lift"}],
                                 value="lift", className="chk radio-inline")]),
    ], className="toolbar"),
    dcc.Graph(id="g-cross", config={"displaylogo": False}),
    html.Div([
        html.Div([html.Label("within-dimension overlap", className="lab"),
                  dcc.Dropdown(id="c-dw", clearable=False, value=2,
                               options=[{"label": "D%d · %s" % (d, DIM_LABEL[d]),
                                         "value": d} for d in DIMS],
                               className="dd")], style={"flex": "1 1 260px"}),
        html.Div([html.Label("metric", className="lab"),
                  dcc.RadioItems(id="c-wmetric",
                                 options=[{"label": " count", "value": "count"},
                                          {"label": " Jaccard", "value": "jaccard"}],
                                 value="jaccard", className="chk radio-inline")]),
    ], className="toolbar"),
    dcc.Graph(id="g-within", config={"displaylogo": False}),
], className="panel")

TAB_D = html.Div([
    html.Div([
        html.Label("dimension", className="lab"),
        dcc.Dropdown(id="d-dim", clearable=False, value=5,
                     options=[{"label": "D%d · %s" % (d, DIM_LABEL[d]),
                               "value": d} for d in DIMS], className="dd",
                     style={"maxWidth": "340px"}),
    ], className="toolbar"),
    dcc.Graph(id="g-comp-codes", config={"displaylogo": False}),
    dcc.Graph(id="g-comp-score", config={"displaylogo": False}),
    dcc.Graph(id="g-perf", config={"displaylogo": False}),
    html.Div("perf_raw / perf_bucket are parsed from the trajectory filename and "
             "are an unvalidated proxy — swap in the real system metric to make "
             "this panel conclusive.", className="hint"),
], className="panel")

TAB_E = html.Div([
    html.Div([
        html.Div([html.Label("trajectory", className="lab"),
                  dcc.Dropdown(id="e-traj", clearable=False,
                               options=[{"label": t, "value": t}
                                        for t in STORE.trajectories],
                               value=STORE.trajectories[0], className="dd")],
                 style={"flex": "1 1 460px"}),
        html.Button("highlight in Panel A", id="btn-hl", className="btn-mini"),
    ], className="toolbar"),
    dcc.Graph(id="g-obs", config={"displaylogo": False}),
    html.Div(id="obs-cards", className="obs-wrap"),
], className="panel")


app = Dash(__name__, title="Human-Perceived Feedback · Analysis")
app.config.suppress_callback_exceptions = True

app.layout = html.Div([
    dcc.Store(id="st-ids"),
    dcc.Store(id="st-sel"),
    dcc.Store(id="st-hl"),

    html.Div([
        html.Div([
            html.Span("Human-Perceived Feedback", className="brand"),
            html.Span("Overcooked · 2-agent monitoring · 5-dimension coding",
                      className="brand-sub"),
        ]),
        html.Span("%d feedback · 216 participants · 108 trajectories" % N_TOTAL,
                  className="brand-meta"),
    ], className="topbar"),

    html.Div([
        RAIL,
        html.Div([
            dcc.Tabs(id="tabs", value="A", className="tabs", children=[
                dcc.Tab(label="A · Embedding map", value="A", children=TAB_A,
                        className="tab", selected_className="tab-sel"),
                dcc.Tab(label="B · Distributions", value="B", children=TAB_B,
                        className="tab", selected_className="tab-sel"),
                dcc.Tab(label="C · Co-occurrence", value="C", children=TAB_C,
                        className="tab", selected_className="tab-sel"),
                dcc.Tab(label="D · Competence lens", value="D", children=TAB_D,
                        className="tab", selected_className="tab-sel"),
                dcc.Tab(label="E · Trajectory & observers", value="E",
                        children=TAB_E, className="tab",
                        selected_className="tab-sel"),
            ]),
        ], className="main"),
        html.Div(id="inspector", className="inspector"),
    ], className="body"),
], className="app")


# -------------------------------------------------------------- callbacks ---

@app.callback(
    Output("st-ids", "data"), Output("counter", "children"),
    Input({"type": "dimfilter", "dim": ALL}, "value"),
    Input("f-group", "value"), Input("f-score", "value"),
    Input("f-valence", "value"), Input("f-regime", "value"),
    Input("f-traj", "value"), Input("f-bucket", "value"),
    Input("f-conf", "value"), Input("f-kw", "value"),
    Input("within-logic", "value"),
    State({"type": "dimfilter", "dim": ALL}, "id"),
)
def apply_filters(dimvals, groups, score, valences, regimes, trajs, buckets,
                  conf, kw, logic, dimids):
    sel: Dict[int, List[str]] = {}
    for v, i in zip(dimvals or [], dimids or []):
        sel[int(i["dim"])] = v or []
    m = STORE.filter_mask(sel, groups or [], score or [1, 5], valences or [],
                          regimes or [], trajs or [], buckets or [],
                          bool(conf), kw, logic == "and")
    ids = DF.loc[m, "id"].astype(int).tolist()
    pct = 100.0 * len(ids) / N_TOTAL
    active = sum(1 for v in (dimvals or []) if v) + sum(
        1 for v in [groups, valences, regimes, trajs, buckets, conf] if v)
    if (score or [1, 5]) != [1, 5]:
        active += 1
    if kw and kw.strip():
        active += 1
    return ids, [
        html.Span("%d" % len(ids), className="counter-n"),
        html.Span(" / %d feedback  ·  %.0f%%" % (N_TOTAL, pct),
                  className="counter-sub"),
        html.Span("  ·  %d filter%s active" % (active, "" if active == 1 else "s"),
                  className="counter-sub"),
    ]


@app.callback(
    Output({"type": "dimfilter", "dim": ALL}, "value"),
    Output("f-group", "value"), Output("f-score", "value"),
    Output("f-valence", "value"), Output("f-regime", "value"),
    Output("f-traj", "value"), Output("f-bucket", "value"),
    Output("f-conf", "value"), Output("f-kw", "value"),
    Input("btn-reset", "n_clicks"),
    State({"type": "dimfilter", "dim": ALL}, "value"),
    prevent_initial_call=True,
)
def reset(_n, dimvals):
    return [[] for _ in dimvals], [], [1, 5], [], [], [], [], [], ""


@app.callback(
    Output("g-embed", "figure"),
    Input("st-ids", "data"), Input("color-by", "value"),
    Input("a-opts", "value"), Input("st-sel", "data"), Input("st-hl", "data"),
)
def draw_embed(ids, color_by, opts, sel, hl):
    opts = opts or []
    ghost = "ghost" in opts
    if "facet" in opts:
        return fig_facet(ids or [], ghost)
    return fig_embedding(ids or [], color_by, ghost, sel, hl)


@app.callback(Output("st-sel", "data"),
              Input("g-embed", "clickData"),
              Input({"type": "nbr", "fid": ALL}, "n_clicks"),
              prevent_initial_call=True)
def select_point(click, _nbr):
    trig = ctx.triggered_id
    if isinstance(trig, dict) and trig.get("type") == "nbr":
        if not any(ctx.triggered[i]["value"] for i in range(len(ctx.triggered))):
            return no_update
        return int(trig["fid"])
    if not click or not click.get("points"):
        return no_update
    return int(click["points"][0]["customdata"][0])


@app.callback(Output("inspector", "children"),
              Input("st-sel", "data"), Input("f-kw", "value"))
def draw_inspector(sel, kw):
    head = html.Div([html.Span("INSPECTOR", className="rail-title"),
                     html.Span("Panel F", className="muted")],
                    className="rail-head")
    if sel is None:
        return [head, html.Div("Click a point in the embedding map to inspect "
                               "the full feedback, its five dimension codes and "
                               "the coder's reasoning.", className="muted pad")]
    r = DF[DF["id"] == int(sel)].iloc[0]

    def hl_text(t: str):
        if not kw or not kw.strip():
            return t
        k = kw.strip()
        low, kl, out, i = t.lower(), k.lower(), [], 0
        while True:
            j = low.find(kl, i)
            if j < 0:
                out.append(t[i:])
                break
            out.append(t[i:j])
            out.append(html.Mark(t[j:j + len(k)]))
            i = j + len(k)
        return out

    meta = html.Div([
        chip(r["group"], GROUP_COLOR.get(r["group"], GREY)),
        chip("score %d" % r["score"], VALENCE_COLOR[r["valence"]]),
        chip(str(r["regime"]), REGIME_COLOR.get(r["regime"], GREY)),
        chip(str(r["seed"]), GREY),
        chip("bucket %s" % r["perf_bucket"],
             BUCKET_COLOR.get(int(r["perf_bucket"]), GREY)),
    ], className="chips")

    dims = []
    for d in DIMS:
        codes = r["d%d_list" % d]
        conf = r["d%d_conf" % d]
        partial = r["d%d_partial" % d]
        dims.append(html.Div([
            html.Div([html.Span("D%d" % d, className="dnum"),
                      html.Span(DIM_LABEL[d], className="dname"),
                      chip(conf, CONF_COLOR.get(conf, GREY))],
                     className="dim-row"),
            html.Div([chip("%s %s" % (c, CODE_NAME.get(c, "?")),
                           CODE_COLOR.get(c, GREY)) for c in codes] or
                     [chip("no code", GREY)], className="chips"),
            (html.Div("partial: %s" % partial, className="muted small")
             if partial else None),
            html.Div(r["d%d_reason" % d] or "—", className="reason"),
        ], className="dim-card"))

    nbrs = []
    for fid, sim in STORE.neighbors(int(sel), 5):
        nr = DF[DF["id"] == fid].iloc[0]
        nbrs.append(html.Button([
            html.Span("%.3f" % sim, className="sim"),
            html.Span(nr["short"], className="nbr-text"),
            html.Span("%s · s%d" % (nr["group"], nr["score"]),
                      className="muted small"),
        ], id={"type": "nbr", "fid": int(fid)}, className="nbr", n_clicks=0))

    return [head,
            html.Div([
                html.Div(hl_text(r["text"]), className="ins-text"),
                meta,
                html.Div(r["traj"], className="muted mono small"),
                html.Div("participant %s" % r["pid"], className="muted mono small"),
                html.Div("Dimension coding", className="sec"),
                html.Div(dims),
                html.Div("Nearest neighbours in embedding space", className="sec"),
                html.Div(nbrs, className="nbrs"),
            ], className="ins-body")]


@app.callback(Output("g-dist", "figure"),
              Input("st-ids", "data"), Input("b-split", "value"))
def draw_dist(ids, split):
    return fig_distribution(ids or [], split)


@app.callback(Output("g-cross", "figure"),
              Input("st-ids", "data"), Input("c-dy", "value"),
              Input("c-dx", "value"), Input("c-metric", "value"))
def draw_cross(ids, dy, dx, metric):
    return fig_cross(ids or [], int(dx), int(dy), metric)


@app.callback(Output("g-within", "figure"),
              Input("st-ids", "data"), Input("c-dw", "value"),
              Input("c-wmetric", "value"))
def draw_within(ids, d, metric):
    return fig_within(ids or [], int(d), metric)


@app.callback(
    Output({"type": "dimfilter", "dim": ALL}, "value", allow_duplicate=True),
    Input("g-cross", "clickData"),
    State("c-dy", "value"), State("c-dx", "value"),
    State({"type": "dimfilter", "dim": ALL}, "value"),
    State({"type": "dimfilter", "dim": ALL}, "id"),
    prevent_initial_call=True,
)
def drill_cross(click, dy, dx, values, dimids):
    if not click or not click.get("points"):
        return no_update
    p = click["points"][0]
    row_code = str(p["y"]).split()[0]
    col_code = str(p["x"]).split()[0]
    out = []
    for v, i in zip(values, dimids):
        d = int(i["dim"])
        if d == int(dy):
            out.append([row_code])
        elif d == int(dx):
            out.append([col_code])
        else:
            out.append(v)
    return out


@app.callback(Output("g-comp-codes", "figure"),
              Input("st-ids", "data"), Input("d-dim", "value"))
def draw_comp_codes(ids, d):
    return fig_comp_codes(ids or [], int(d))


@app.callback(Output("g-comp-score", "figure"), Input("st-ids", "data"))
def draw_comp_score(ids):
    return fig_comp_score(ids or [])


@app.callback(Output("g-perf", "figure"), Input("st-ids", "data"))
def draw_perf(ids):
    return fig_perf(ids or [])


@app.callback(Output("g-obs", "figure"), Output("obs-cards", "children"),
              Input("st-ids", "data"), Input("e-traj", "value"))
def draw_observers(ids, traj):
    ids = ids or []
    return fig_observers(traj, ids), observer_cards(traj, ids)


@app.callback(Output("st-hl", "data"),
              Input("btn-hl", "n_clicks"), State("e-traj", "value"),
              prevent_initial_call=True)
def set_highlight(_n, traj):
    return traj


@app.callback(Output("dl-csv", "data"),
              Input("btn-csv", "n_clicks"), State("st-ids", "data"),
              prevent_initial_call=True)
def download(_n, ids):
    sub = DF[DF["id"].isin(ids or [])].drop(
        columns=[c for c in DF.columns
                 if c.endswith("_list") or c in ("text_wrapped", "text_lower",
                                                 "short")])
    buf = io.StringIO()
    sub.to_csv(buf, index=False)
    return dict(content=buf.getvalue(), filename="feedback_filtered_%d.csv"
                % len(sub))


app.index_string = """<!DOCTYPE html>
<html><head>{%metas%}<title>{%title%}</title>{%favicon%}{%css%}
<style>
:root{
  --bg:#f4f5f7; --panel:#ffffff; --line:#e3e6ea; --ink:#22262b;
  --muted:#7b828c; --accent:#0072B2;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:Inter,"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",
  Roboto,sans-serif;font-size:13px;-webkit-font-smoothing:antialiased}
.app{display:flex;flex-direction:column;height:100vh}
.topbar{display:flex;align-items:baseline;justify-content:space-between;
  padding:9px 16px;background:#fff;border-bottom:1px solid var(--line)}
.brand{font-weight:650;font-size:14px;letter-spacing:-0.01em}
.brand-sub{margin-left:10px;color:var(--muted);font-size:11.5px}
.brand-meta{color:var(--muted);font-size:11.5px}
.body{display:flex;flex:1;min-height:0}

.rail{width:302px;flex:0 0 302px;background:#fff;border-right:1px solid var(--line);
  overflow-y:auto;padding:10px 12px 26px}
.rail-head{display:flex;align-items:center;justify-content:space-between;
  margin-bottom:8px}
.rail-title{font-size:10.5px;font-weight:700;letter-spacing:.09em;
  color:var(--muted)}
.counter{background:#f7f8fa;border:1px solid var(--line);border-radius:6px;
  padding:8px 10px;margin-bottom:10px}
.counter-n{font-size:19px;font-weight:680;letter-spacing:-0.02em}
.counter-sub{color:var(--muted);font-size:11px}
.group{border-top:1px solid var(--line);padding:8px 0}
.group>summary{cursor:pointer;font-size:11.5px;font-weight:620;color:#3c424a;
  padding:3px 0;list-style:none;user-select:none}
.group>summary::before{content:"▾ ";color:var(--muted)}
.group:not([open])>summary::before{content:"▸ "}
.dim-block{margin:8px 0 4px}
.dim-head{font-size:10.5px;font-weight:650;color:#4a515a;margin:6px 0 3px;
  text-transform:none}
.sub-block{margin-top:8px;border-top:1px dashed var(--line);padding-top:6px}
.lab{display:block;font-size:10.5px;color:var(--muted);margin:9px 0 3px}
.chk label{display:block;font-size:11.5px;line-height:1.65;cursor:pointer;
  color:#333a42;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chk input{margin-right:5px;vertical-align:-1px;accent-color:var(--accent)}
.radio-inline label{display:inline-block;margin-right:11px}
.inp{width:100%;padding:5px 7px;border:1px solid var(--line);border-radius:5px;
  font-size:12px;font-family:inherit}
.dd .Select-control,.dd .Select-menu-outer{font-size:12px}
.btn-mini{font:inherit;font-size:11px;padding:2px 8px;border:1px solid var(--line);
  background:#fff;border-radius:5px;cursor:pointer;color:#3c424a}
.btn-mini:hover{background:#f2f4f7}
.btn-wide{display:block;width:100%;margin-top:14px;font:inherit;font-size:11.5px;
  padding:6px;border:1px solid var(--line);background:#fff;border-radius:5px;
  cursor:pointer;color:#3c424a}
.btn-wide:hover{background:#f2f4f7}

.main{flex:1;min-width:0;overflow-y:auto;padding:0 12px 24px}
.tabs{border-bottom:1px solid var(--line);margin-bottom:10px}
.tab{padding:8px 14px!important;font-size:12px!important;border:none!important;
  background:transparent!important;color:var(--muted)!important}
.tab-sel{color:var(--ink)!important;font-weight:620!important;
  border-bottom:2px solid var(--accent)!important;background:transparent!important}
.panel{background:#fff;border:1px solid var(--line);border-radius:8px;
  padding:10px 12px;margin-bottom:12px}
.toolbar{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap;
  padding:2px 2px 8px}
.hint{color:var(--muted);font-size:11px;padding:4px 2px 2px;line-height:1.5}

.inspector{width:352px;flex:0 0 352px;background:#fff;border-left:1px solid var(--line);
  overflow-y:auto;padding:10px 12px 30px}
.ins-body{}
.ins-text{font-size:13px;line-height:1.52;margin-bottom:9px}
.ins-text mark{background:#ffe9a8;padding:0 1px}
.sec{font-size:10.5px;font-weight:700;letter-spacing:.07em;color:var(--muted);
  margin:16px 0 7px;padding-top:10px;border-top:1px solid var(--line)}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:10px;
  line-height:1.5;padding:1px 6px 1px 5px;border-radius:9px;font-weight:560;
  white-space:nowrap;color:#2a2f36;border:1px solid transparent}
.dot{width:6px;height:6px;border-radius:50%;flex:0 0 6px}
.dim-card{border:1px solid var(--line);border-radius:6px;padding:7px 8px;
  margin-bottom:7px;background:#fcfcfd}
.dim-row{display:flex;align-items:center;gap:6px}
.dnum{font-size:10px;font-weight:700;color:#fff;background:#3c424a;
  border-radius:4px;padding:1px 5px}
.dname{font-size:11.5px;font-weight:600}
.reason{font-size:11px;line-height:1.5;color:#4c535c;margin-top:5px}
.muted{color:var(--muted)}
.small{font-size:10.5px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px}
.pad{padding:8px 2px;line-height:1.55}
.nbrs{display:flex;flex-direction:column;gap:5px}
.nbr{text-align:left;font:inherit;background:#fff;border:1px solid var(--line);
  border-radius:6px;padding:6px 8px;cursor:pointer;display:flex;
  flex-direction:column;gap:2px}
.nbr:hover{background:#f5f7fa;border-color:#c9ced6}
.sim{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--accent);
  font-weight:600}
.nbr-text{font-size:11.5px;line-height:1.42}

.obs-wrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));
  gap:9px;margin-top:8px}
.obs-card{border:1px solid var(--line);border-radius:7px;padding:8px 9px;
  background:#fcfcfd}
.obs-head{font-size:11.5px;margin-bottom:5px}
.obs-item{border-top:1px dashed var(--line);padding:6px 0 3px}
.obs-item:first-of-type{border-top:none}
.obs-text{font-size:11.5px;line-height:1.45;margin-left:5px}

::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:#d3d7dd;border-radius:5px}
::-webkit-scrollbar-track{background:transparent}
</style></head>
<body>{%app_entry%}<footer>{%config%}{%scripts%}{%renderer%}</footer></body></html>
"""


if __name__ == "__main__":
    app.run(debug=False, host="127.0.0.1", port=8050)
