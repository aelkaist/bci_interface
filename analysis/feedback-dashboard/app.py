"""Overcooked human-perceived feedback - analysis dashboard.

Run:  python app.py   ->  http://127.0.0.1:8050

Left rail = global filters shared by every panel.
Tabs A-F  = embedding map / distributions / co-occurrence / competence lens /
            trajectory & observers / observer divergence.
Right     = feedback inspector, driven by clicks in Panel A.
"""

from __future__ import annotations

import io
import os
import secrets
import textwrap
from typing import Dict, List

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from dash import ALL, Dash, Input, Output, State, ctx, dcc, html, no_update
from plotly.subplots import make_subplots

import divergence as dv
from codebook import (BAND_COLOR, BAND_ORDER, BAND_SYMBOL, BUCKET_COLOR, CAT8,
                      CODE_COLOR, CODE_NAME, CODE_SYMBOL, CONF_COLOR,
                      CONF_ORDER, CONF_SYMBOL, DIM_LABEL, DIMS, GHOST, GREY,
                      GROUP_COLOR, GROUP_ORDER, GROUP_SYMBOL, NOISE_GREY,
                      OTHER_GREY, REGIME_COLOR, REGIME_ORDER, REGIME_SYMBOL,
                      SCORE_SCALE, SCORE_STEPS, SURFACE, SYMBOLS, VALENCE_COLOR,
                      VALENCE_ORDER, VALENCE_SYMBOL, dim_options, is_parent,
                      leaf_codes, tint)
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


def code_label_sep(code: str, label_set: str = "as-coded") -> str:
    """Code label with its probe AUROC appended, when the analysis has run."""
    a = STORE.sep_code_auroc(code, label_set)
    if a is None:
        return code_label(code)
    return "%s   ·  AUROC %.2f" % (code_label(code), a)


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
        labels = {c: code_label_sep(c) for c in cats if c != "none"}
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


def facet_title(d: int, label_set: str = "as-coded") -> str:
    """Facet header carrying the number behind the visual impression.

    The facet view is what makes someone say "D1 splits, D4 is mixed"; putting
    macro-AUROC in the title means that claim is never made on eyeballs alone.
    """
    row = STORE.sep_dim_row(d, label_set)
    if row is None:
        return "D%d · %s" % (d, DIM_LABEL[d])
    return ("D%d · %s<br><span style='font-size:10px;color:#7b828c'>"
            "AUROC %.3f · vs TF-IDF %+.3f</span>"
            % (d, DIM_LABEL[d], row["macro_AUROC"], row["auroc_gain_over_tfidf"]))


def fig_facet(ids: List[int], show_ghost: bool) -> go.Figure:
    keep = DF["id"].isin(ids).to_numpy()
    sub = DF[keep]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 430)
    bg = DF[~keep]

    fig = make_subplots(rows=1, cols=5, horizontal_spacing=0.008,
                        subplot_titles=[facet_title(d) for d in DIMS])
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

# ------------------------------------------- Panel A · separability views ---

SEP_MISSING = ("Run  python 04_separability.py  to compute these metrics. "
               "They are read from results/ and are optional — the rest of the "
               "dashboard works without them.")


def fig_separability(label_set: str) -> go.Figure:
    """Macro-AUROC per dimension against the TF-IDF lexical baseline.

    Everything here is computed on the original 3072-d embeddings under
    participant-grouped CV, never on the 2D coordinates shown above.
    """
    if not STORE.has_sep:
        return empty_fig(SEP_MISSING, 400)
    sub = (STORE.sep_dim[STORE.sep_dim["label_set"] == label_set]
           .sort_values("dimension"))
    if len(sub) == 0:
        return empty_fig(SEP_MISSING, 400)

    x = ["D%d · %s" % (r.dimension, DIM_LABEL[r.dimension]) for r in sub.itertuples()]
    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=x, y=sub["macro_AUROC"], name="Transformer embedding",
        marker=dict(color=CAT8[0], line=dict(width=1, color=SURFACE)),
        error_y=dict(type="data", array=sub["macro_AUROC_fold_std"],
                     color="#3c424a", thickness=1.2, width=5),
        customdata=np.column_stack([sub["n_codes_used"], sub["perm_p"],
                                    sub["perm_z"], sub["macro_AP_lift"]]),
        hovertemplate="%{x}<br>macro-AUROC %{y:.3f}<br>"
                      "%{customdata[0]} codes probed · AP-lift %{customdata[3]:.1f}"
                      "<br>permutation p=%{customdata[1]} z=%{customdata[2]:.1f}"
                      "<extra></extra>"))
    fig.add_trace(go.Bar(
        x=x, y=sub["tfidf_macro_AUROC"], name="TF-IDF lexical baseline",
        marker=dict(color=CAT8[1], line=dict(width=1, color=SURFACE)),
        customdata=sub["auroc_gain_over_tfidf"],
        hovertemplate="%{x}<br>TF-IDF macro-AUROC %{y:.3f}<br>"
                      "embedding adds %{customdata:+.3f}<extra></extra>"))
    fig.add_hline(y=0.5, line=dict(dash="dash", width=1.2, color=GREY),
                  annotation_text="chance 0.5", annotation_position="top left",
                  annotation_font=dict(size=9.5, color="#7b828c"))

    # Labels are placed by hand rather than with textposition="outside", which
    # ignores the error bars and lets the two collide.
    for k, r in enumerate(sub.itertuples()):
        fig.add_annotation(x=k, xshift=-34, y=r.macro_AUROC + r.macro_AUROC_fold_std,
                           yshift=11, text="%.3f" % r.macro_AUROC, showarrow=False,
                           font=dict(size=10.5, color="#2a2f36"))
        fig.add_annotation(x=k, xshift=34, y=r.tfidf_macro_AUROC, yshift=11,
                           text="%.3f" % r.tfidf_macro_AUROC, showarrow=False,
                           font=dict(size=10.5, color="#2a2f36"))
    lay = dict(BASE)
    lay["margin"] = dict(l=52, r=18, t=64, b=64)
    fig.update_layout(
        height=400, barmode="group", bargap=0.34, bargroupgap=0.08,
        barcornerradius=3,
        title=dict(text="Per-code decodability by dimension · "
                        "participant-grouped 5-fold CV · error bars = fold sd",
                   font=dict(size=12.5, color="#5a616b"), x=0.005),
        legend=dict(orientation="h", y=1.13, x=0.34, borderwidth=0,
                    bgcolor="rgba(0,0,0,0)", font=dict(size=10.5)),
        **{k: v for k, v in lay.items() if k != "legend"})
    fig.update_yaxes(title=dict(text="macro-AUROC", font=dict(size=10)),
                     range=[0.4, 1.04], gridcolor="#eceef1", zeroline=False)
    fig.update_xaxes(tickfont=dict(size=10))
    return fig


def fig_code_auroc(label_set: str) -> go.Figure:
    """Per-code AUROC, so a dimension mean never hides a weak code."""
    if STORE.sep_code is None:
        return empty_fig(SEP_MISSING, 360)
    sub = STORE.sep_code[STORE.sep_code["label_set"] == label_set]
    if len(sub) == 0:
        return empty_fig(SEP_MISSING, 360)
    fig = go.Figure()
    for d in DIMS:
        s = sub[sub["dimension"] == d]
        if not len(s):
            continue
        fig.add_trace(go.Scatter(
            x=s["AUROC"], y=["D%d" % d] * len(s), mode="markers",
            name="D%d" % d, showlegend=False,
            marker=dict(size=11, color=[CODE_COLOR.get(c, GREY) for c in s["code"]],
                        symbol=[CODE_SYMBOL.get(c, "circle") for c in s["code"]],
                        opacity=0.9, line=dict(width=1, color=SURFACE)),
            customdata=np.column_stack([s["code"], s["code_name"], s["n_pos"],
                                        s["tfidf_AUROC"]]),
            hovertemplate="%{customdata[0]} %{customdata[1]}<br>"
                          "AUROC %{x:.3f} (TF-IDF %{customdata[3]:.3f})<br>"
                          "n = %{customdata[2]}<extra></extra>"))
    fig.add_vline(x=0.5, line=dict(dash="dash", width=1.2, color=GREY),
                  annotation_text="chance", annotation_position="top",
                  annotation_font=dict(size=9.5, color="#7b828c"))
    lay = dict(BASE)
    lay["margin"] = dict(l=52, r=18, t=44, b=48)
    fig.update_layout(
        height=340,
        title=dict(text="Per-code AUROC within each dimension · hover for the "
                        "code and its n",
                   font=dict(size=12.5, color="#5a616b"), x=0.005), **lay)
    fig.update_xaxes(title=dict(text="AUROC", font=dict(size=10)),
                     range=[0.42, 1.03], gridcolor="#eceef1")
    fig.update_yaxes(autorange="reversed", gridcolor="#eceef1")
    return fig


def sep_table(label_set: str):
    """Compact metric table: the numbers that do not fit on the bar chart."""
    if not STORE.has_sep:
        return html.Div(SEP_MISSING, className="muted pad")
    sub = (STORE.sep_dim[STORE.sep_dim["label_set"] == label_set]
           .sort_values("dimension"))
    head = ["dimension", "codes", "macro-AUROC", "AP-lift", "silhouette¹",
            "kNN purity", "(null)", "TF-IDF", "gain", "perm p", "perm z"]
    rows = [html.Tr([html.Th(h) for h in head])]
    for r in sub.itertuples():
        rows.append(html.Tr([
            html.Td("D%d %s" % (r.dimension, DIM_LABEL[r.dimension]),
                    className="tl"),
            html.Td("%d" % r.n_codes_used),
            html.Td(html.B("%.3f" % r.macro_AUROC)),
            html.Td("%.1f" % r.macro_AP_lift),
            html.Td("%.3f" % r.silhouette),
            html.Td("%.3f" % r.knn_purity),
            html.Td("%.3f" % r.knn_purity_null, className="muted"),
            html.Td("%.3f" % r.tfidf_macro_AUROC),
            html.Td("%+.3f" % r.auroc_gain_over_tfidf),
            html.Td("%.4g" % r.perm_p),
            html.Td("%.1f" % r.perm_z),
        ]))
    return html.Div([
        html.Table(rows, className="sep-table"),
        html.Div("¹ silhouette uses only the points carrying exactly one code "
                 "of that dimension (it is undefined for multi-label points); "
                 "every other metric uses all points with one-vs-rest presence "
                 "labels. All metrics are computed on the original 3072-d "
                 "embeddings, never on the 2D coordinates above.",
                 className="hint"),
    ])


def fig_stability(ids: List[int], color_by: str) -> go.Figure:
    """The same points re-projected under 3 seeds x 3 n_neighbors.

    Answers the obvious reviewer question about the map above: is the pattern a
    property of the data or an accident of UMAP hyper-parameters?
    """
    if STORE.umap_stab is None:
        return empty_fig("Run  python 04_separability.py  (without --skip-umap) "
                         "to generate the stability re-projections.", 620)
    runs = STORE.stability_runs()
    seeds = sorted({s for s, _ in runs})
    neigh = sorted({n for _, n in runs})
    sub = DF[DF["id"].isin(ids)]
    if len(sub) == 0:
        return empty_fig("No feedback matches the current filters.", 620)

    enc = encode(color_by, sub)
    if enc["mode"] == "cont":
        enc = {"mode": "cat", "values": sub["valence"].to_numpy(),
               "cats": [v for v in VALENCE_ORDER if v in set(sub["valence"])],
               "colors": VALENCE_COLOR, "symbols": VALENCE_SYMBOL,
               "labels": {v: v for v in VALENCE_ORDER}, "title": "valence"}

    coords = STORE.umap_stab
    fig = make_subplots(
        rows=len(seeds), cols=len(neigh),
        horizontal_spacing=0.012, vertical_spacing=0.06,
        subplot_titles=["n_neighbors = %d" % n for n in neigh]
                       + [""] * (len(seeds) - 1) * len(neigh))
    shown = set()
    for i, sd in enumerate(seeds, start=1):
        for j, nn in enumerate(neigh, start=1):
            c = coords[(coords["seed"] == sd) & (coords["n_neighbors"] == nn)]
            c = c.set_index("id").reindex(sub["id"].to_numpy())
            for cat in enc["cats"]:
                m = enc["values"] == cat
                if not m.any():
                    continue
                fig.add_trace(go.Scattergl(
                    x=c["x"].to_numpy()[m], y=c["y"].to_numpy()[m],
                    mode="markers", name=enc["labels"].get(cat, cat),
                    legendgroup=str(cat), showlegend=cat not in shown,
                    marker=dict(size=3.4, opacity=0.82,
                                color=enc["colors"].get(cat, GREY),
                                symbol=enc["symbols"].get(cat, "circle"),
                                line=dict(width=0)),
                    hoverinfo="skip"), row=i, col=j)
                shown.add(cat)
        fig.add_annotation(text="seed %d" % sd, x=-0.008, y=0.5, xref="paper",
                           yref="y domain", showarrow=False, textangle=-90,
                           font=dict(size=10, color="#7b828c"), row=i, col=1)
    lay = dict(BASE)
    lay["margin"] = dict(l=34, r=14, t=46, b=70)
    fig.update_layout(
        height=250 * len(seeds) + 90,
        title=dict(text="UMAP stability · same points, %d seeds × %d "
                        "n_neighbors · colour = %s"
                        % (len(seeds), len(neigh), enc["title"]),
                   font=dict(size=12.5, color="#5a616b"), x=0.005),
        legend=dict(orientation="h", y=-0.04, x=0, font=dict(size=9.5),
                    itemsizing="constant", borderwidth=0,
                    bgcolor="rgba(0,0,0,0)"),
        **{k: v for k, v in lay.items() if k != "legend"})
    fig.update_annotations(font=dict(size=10.5, color="#5a616b"))
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    return fig


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


# --------------------------------------------------------------- Panel F ----
#
# Observer divergence. The unit of analysis is the trajectory: one point in the
# distribution is one map, never a feedback item and never an observer pair.
# Nothing here computes a metric - divergence.py and 05_divergence.py do that,
# and this panel only selects, colours and explains precomputed values. That is
# also why a filter change can never move a score, an axis or a band.

DIV_MISSING = ("Run  python 05_divergence.py  to build the observer-divergence "
               "artefacts. The panel needs data/divergence_maps.parquet, "
               "data/divergence_detail.json.gz and data/divergence_report.json.")

DIV_METRIC_OPTIONS = [{"label": dv.METRIC_SHORT[m], "value": m}
                      for m in dv.METRICS]
DIV_MODE_OPTIONS = [{"label": " " + dv.MODE_LABEL[m], "value": m}
                    for m in dv.MODES]
DIV_JSD_DIM_OPTIONS = ([{"label": " macro", "value": "macro"}]
                       + [{"label": " D%d" % d, "value": str(d)} for d in DIMS])


def _sec(frame) -> str:
    return "%.1fs" % dv.seconds_of_frame(frame)


def _num(value, fmt="%.3f", dash="—") -> str:
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return dash
    return fmt % value


def _wrap_hover(text: str, width: int = 58, max_lines: int = 4) -> str:
    lines = textwrap.wrap(" ".join(str(text).split()), width=width) or ["(empty)"]
    if len(lines) > max_lines:
        lines = lines[:max_lines] + ["…"]
    return "<br>".join(lines)


def div_axis_range(metric: str, mode: str):
    """Y range frozen to the whole-corpus spread of this (metric, mode).

    Rescaling the axis to whatever survived the filter would make two selections
    look equally spread when they are not - the same reason the bands are frozen.
    """
    if not STORE.has_divergence:
        return None
    col = STORE.div_maps.loc[STORE.div_maps["mode"] == mode, metric].dropna()
    if col.empty:
        return None
    lo, hi = float(col.min()), float(col.max())
    pad = max((hi - lo) * 0.08, 0.01)
    return [max(lo - pad, 0.0), min(hi + pad, 1.0)]


def div_hover(row: pd.Series, metric: str, mode: str) -> str:
    """The whole hover card, pre-rendered.

    Conditional lines (a raw convergence score only for the temporal metrics, a
    coverage warning only when observers are missing) make a positional
    hovertemplate unreadable, so the block is assembled here instead.
    """
    detail = STORE.divergence_detail(row["traj_id"], mode) or {}
    band = row.get("%s_band" % metric)
    out = ["<b>%s</b>" % row["traj_id"],
           "<span style='color:#6b7280'>%s competence · %s · %d agents</span>"
           % (row["performance_group"], row["policy"], int(row["agent_count"])),
           "<b>%s %s</b>  ·  %s"
           % (dv.METRIC_SHORT[metric], _num(row[metric]),
              dv.BAND_LABEL.get(band, "—"))]

    if dv.METRIC_IS_FLIPPED[metric]:
        out.append("<span style='color:#6b7280'>raw convergence %s</span>"
                   % _num(row["%s_raw" % metric]))

    active = int(row["n_active_observers"])
    coverage = ("%d / %d observers active in this mode"
                % (active, int(row["n_assigned_observers"])))
    if active < int(row["n_assigned_observers"]):
        coverage += "  ⚠"
    out.append("<span style='color:#6b7280'>%s</span>" % coverage)
    out.append("<span style='color:#6b7280'>%d ranged · %d point-only feedback"
               "</span>" % (int(row["n_ranged_items"]),
                            int(row["n_range_free_items"])))

    if metric == "tjac":
        out.append("<span style='color:#6b7280'>valid pairs %d / %d</span>"
                   % (int(row["tjac_valid_pairs"]), int(row["tjac_pairs"])))
    elif metric == "smid":
        out.append("<span style='color:#6b7280'>matched directed pairs %d / %d "
                   "· %d item matches</span>"
                   % (int(row["smid_matched_directed_pairs"]),
                      int(row["smid_directed_pairs"]),
                      int(row["smid_matched_items"])))
    elif metric == "jsd":
        out.append("<span style='color:#6b7280'>valid pairs %d / %d</span>"
                   % (int(row["jsd_valid_pairs"]), int(row["jsd_pairs"])))
    else:
        out.append("<span style='color:#6b7280'>%d anchors from %d focal "
                   "observers</span>" % (int(row["cotc_focal_items"]),
                                         int(row["cotc_focal_observers"])))

    for h in (detail.get("highlights") or [])[:2]:
        out.append("<span style='color:#9aa0a6'>%s · shared by %d/%d · score %d"
                   "</span>" % (h["observer"], h["covered"], h["denominator"],
                                h["sentiment"]))
        out.append(_wrap_hover(h["feedback"]))
    summary = detail.get("code_summary") or []
    if summary:
        out.append("<span style='color:#6b7280'>%s</span>"
                   % "  ·  ".join("%s ×%d" % (c, n) for c, n in summary))
    out.append("<span style='color:#9aa0a6'>click to pin the detail</span>")
    return "<br>".join(out)


def fig_div_dist(view: pd.DataFrame, metric: str, mode: str) -> go.Figure:
    """Distribution of the filtered maps: one violin, one point per map."""
    if not STORE.has_divergence:
        return empty_fig(DIV_MISSING, 480)
    if view is None or len(view) == 0:
        return empty_fig("No map passes the current filters.", 480)

    scores = view[metric].to_numpy(dtype=float)
    fig = go.Figure()
    fig.add_trace(go.Violin(
        y=scores, x=np.zeros(len(scores)), width=0.85, points=False,
        line=dict(color="#b8bec7", width=1), fillcolor="#f1f3f6",
        box=dict(visible=True, width=0.16, line=dict(color="#5a616b", width=1)),
        meanline=dict(visible=False), hoverinfo="skip", showlegend=False,
        spanmode="hard"))

    # Deterministic jitter: the same map keeps the same x on every redraw, so a
    # point the user is tracking does not jump when a filter moves.
    jitter = np.random.default_rng(7).uniform(-0.2, 0.2, len(view))
    for band in BAND_ORDER:
        m = (view["%s_band" % metric] == band).to_numpy()
        if not m.any():
            continue
        sub = view[m]
        fig.add_trace(go.Scatter(
            x=jitter[m] + 0.55, y=scores[m], mode="markers",
            name="%s (%d)" % (dv.BAND_LABEL[band], int(m.sum())),
            marker=dict(size=8, color=BAND_COLOR[band], symbol=BAND_SYMBOL[band],
                        line=dict(width=1, color="#ffffff")),
            customdata=np.column_stack([
                np.array([div_hover(r, metric, mode)
                          for _, r in sub.iterrows()], dtype=object),
                sub["traj_id"].to_numpy()]),
            hovertemplate="%{customdata[0]}<extra></extra>"))

    thr = STORE.divergence_thresholds(metric, mode)
    if thr:
        for value, name in zip(thr, ("q33", "q67")):
            fig.add_hline(y=value, line=dict(width=1, color="#8a9099",
                                             dash="dash"),
                          annotation_text="%s %.3f" % (name, value),
                          annotation_position="right",
                          annotation_font=dict(size=9.5, color="#6b7280"))

    lay = dict(BASE)
    lay["margin"] = dict(l=58, r=92, t=44, b=28)
    fig.update_layout(
        height=480, violingap=0, violinmode="overlay", **lay)
    fig.update_xaxes(range=[-0.75, 1.05], showticklabels=False, zeroline=False,
                     showgrid=False)
    fig.update_yaxes(title=dict(text="%s  →  more divergence"
                                     % dv.METRIC_LABEL[metric],
                                font=dict(size=10.5)),
                     gridcolor="#eceef1", range=div_axis_range(metric, mode))
    return fig


def div_stats_bar(view: pd.DataFrame, metric: str, mode: str) -> List:
    """n maps, median, IQR and min/max of the current selection."""
    if not STORE.has_divergence:
        return [html.Div(DIV_MISSING, className="muted")]
    if view is None or len(view) == 0:
        return [html.Div("No map passes the current filters.", className="muted")]
    s = view[metric].dropna()
    q25, q50, q75 = (float(s.quantile(q)) for q in (0.25, 0.5, 0.75))
    cells = [("n maps", "%d / %d" % (len(s), STORE.div_maps["traj_id"].nunique())),
             ("median", "%.3f" % q50),
             ("IQR", "%.3f – %.3f  (%.3f)" % (q25, q75, q75 - q25)),
             ("min / max", "%.3f / %.3f" % (s.min(), s.max()))]
    if dv.METRIC_IS_FLIPPED[metric]:
        raw = view["%s_raw" % metric].dropna()
        cells.append(("median raw convergence", "%.3f" % raw.median()))
    return [html.Div([html.Span(k, className="stat-k"),
                      html.Span(v, className="stat-v")], className="stat")
            for k, v in cells]


def div_legend(metric: str, mode: str) -> List:
    """Band legend: the rule, the frozen thresholds, and how they were made."""
    thr = STORE.divergence_thresholds(metric, mode)
    n = STORE.div_maps["traj_id"].nunique() if STORE.has_divergence else 0
    chips = []
    for band in BAND_ORDER:
        if thr is None:
            rng = "—"
        elif band == "low":
            rng = "< %.3f" % thr[0]
        elif band == "mid":
            rng = "%.3f – %.3f" % (thr[0], thr[1])
        else:
            rng = "≥ %.3f" % thr[1]
        chips.append(chip("%s  %s" % (dv.BAND_LABEL[band], rng),
                          BAND_COLOR[band]))
    note = ("Bands are the global q33 / q67 of all %d maps for this metric and "
            "mode (%s), computed once and never refit to the current filter. "
            "Higher is always more divergence; the two temporal metrics are "
            "shown as 1 − convergence and the hover carries the raw score."
            % (n, dv.MODE_LABEL[mode]))
    return [html.Div(chips, className="chips"),
            html.Div(note, className="hint")]


def div_diagnostics(view: pd.DataFrame, metric: str, mode: str):
    """Coverage and data-quality counts over the maps currently on screen."""
    if not STORE.has_divergence or view is None or len(view) == 0:
        return html.Div("—", className="muted")
    rows = [
        ("range-free items", "n_range_free_items", "sum"),
        ("items used in this mode", "n_items_used", "sum"),
        ("baseFrame outside its own range", "n_base_outside_range", "sum"),
        ("long intervals (> %d%% of the trajectory)"
         % int(dv.LONG_INTERVAL_FRACTION * 100), "n_long_intervals", "sum"),
        ("active observers (of 8)", "n_active_observers", "range"),
        ("valid temporal pairs (of 28)", "tjac_valid_pairs", "range"),
        ("SMID matched directed pairs (of 56)",
         "smid_matched_directed_pairs", "range"),
        ("valid JSD pairs (of 28)", "jsd_valid_pairs", "range"),
    ] + [("D%d coverage: items carrying a D%d code" % (d, d),
          "dim_coverage_d%d" % d, "sum") for d in DIMS]

    body = []
    for label, col, kind in rows:
        s = view[col].dropna()
        if kind == "sum":
            value = "%d" % int(s.sum())
            spread = "median %.0f per map" % s.median()
        else:
            value = "%d – %d" % (int(s.min()), int(s.max()))
            spread = "median %.0f" % s.median()
        body.append(html.Tr([html.Td(label, className="tl"),
                             html.Td(value), html.Td(spread, className="muted")]))
    return html.Table([
        html.Thead(html.Tr([html.Th("diagnostic", className="tl"),
                            html.Th("total / range"), html.Th("per map")])),
        html.Tbody(body)], className="sep-table")


# ------------------------------------------------- Panel F · detail drawer ---

def div_code_chips(codes: Dict[str, List[str]]) -> List:
    out = []
    for d in DIMS:
        for c in codes.get(str(d)) or []:
            out.append(chip("%s %s" % (c, CODE_NAME.get(c, "?")),
                            CODE_COLOR.get(c, GREY)))
    return out or [chip("no code", GREY)]


def div_item_card(item: dict) -> html.Div:
    """One feedback: text, reason, anchor, interval and all five dimensions."""
    marks = [chip("score %d" % item["sentiment"],
                  SCORE_STEPS.get(int(item["sentiment"]), GREY))]
    if item.get("derived_range"):
        marks.append(chip("range-free · baseFrame ±%gs"
                          % dv.SENSITIVITY_HALF_WIDTH_SEC, CAT8[1]))
    if item.get("base_outside_range"):
        marks.append(chip("baseFrame outside its range", CAT8[5]))
    if item.get("long_interval"):
        marks.append(chip("long interval", CAT8[3]))

    dims = []
    for d in DIMS:
        conf = item["conf"].get(str(d)) or item["conf"].get(d) or ""
        partial = item["partial"].get(str(d)) or item["partial"].get(d) or ""
        reason = (item["coding_reason"].get(str(d))
                  or item["coding_reason"].get(d) or "")
        codes = item["codes"].get(str(d)) or []
        dims.append(html.Div([
            html.Div([html.Span("D%d" % d, className="dnum"),
                      html.Span(DIM_LABEL[d], className="dname"),
                      chip(conf or "—", CONF_COLOR.get(conf, GREY))],
                     className="dim-row"),
            html.Div([chip("%s %s" % (c, CODE_NAME.get(c, "?")),
                           CODE_COLOR.get(c, GREY)) for c in codes]
                     or [chip("no code", GREY)], className="chips"),
            (html.Div("partial: %s" % partial, className="muted small")
             if partial else None),
            html.Div(reason or "—", className="reason"),
        ], className="dim-card"))

    return html.Div([
        html.Div(marks, className="chips"),
        html.Div(item["feedback"] or "—", className="obs-text"),
        (html.Div(item["reason"], className="reason") if item.get("reason")
         else None),
        html.Div("baseFrame %d (%s)  ·  selected %d–%d frames (%s–%s)"
                 % (item["base_frame"], _sec(item["base_frame"]),
                    item["start"], item["end"],
                    _sec(item["start"]), _sec(item["end"])),
                 className="muted mono small"),
        html.Details([html.Summary("D1–D5 coding"), html.Div(dims)],
                     className="lane-dims"),
    ], className="obs-item")


def div_observer_lanes(detail: dict) -> List:
    """All eight assigned observers, active or not.

    An observer with nothing usable in this mode keeps their lane and says so:
    the missing coverage is the finding, not something to hide by dropping the
    row.
    """
    by_obs: Dict[str, List[dict]] = {}
    for it in detail["items"]:
        by_obs.setdefault(it["observer"], []).append(it)

    out = []
    for lane in detail["observers"]:
        obs = lane["observer"]
        items = by_obs.get(obs, [])
        head = [html.B(obs),
                html.Span("  ·  %d feedback" % len(items), className="muted")]
        if lane["timeline"]:
            head.append(html.Span("  ·  %d frames marked  ·  %s"
                                  % (lane["frames_covered"],
                                     " ".join("%d–%d" % (s, e)
                                              for s, e in lane["timeline"])),
                                  className="muted mono small"))
        body = ([div_item_card(it) for it in items] if items else
                [html.Div("no valid feedback in this mode — the lane is kept so "
                          "the coverage gap stays visible",
                          className="muted small pad")])
        out.append(html.Div([html.Div(head, className="obs-head")] + body,
                            className="obs-card" if items
                            else "obs-card obs-card-empty"))
    return out


def div_matrix_fig(detail: dict, metric: str, jsd_dim: str) -> go.Figure:
    """Observer x observer matrix for the two pairwise metrics."""
    obs = [o["observer"] for o in detail["observers"]]
    idx = {o: i for i, o in enumerate(obs)}
    n = len(obs)
    Z = np.full((n, n), np.nan)
    text = [["" for _ in range(n)] for _ in range(n)]

    if metric == "tjac":
        title = "1 − temporal Jaccard per observer pair"
        for p in detail["tjac"]["pairs"]:
            i, j = idx[p["a"]], idx[p["b"]]
            val = None if p["score"] is None else 1.0 - p["score"]
            label = ("undefined — both timelines empty" if p["score"] is None
                     else "1 − J %.3f  (raw J %.3f)<br>∩ %d frames / ∪ %d frames"
                     % (val, p["score"], p["intersection"], p["union"]))
            for a, b in ((i, j), (j, i)):
                Z[a][b] = np.nan if val is None else val
                text[a][b] = label
    else:
        key = "score" if jsd_dim == "macro" else None
        title = ("macro-averaged base-2 JSD per observer pair" if jsd_dim == "macro"
                 else "D%s base-2 JSD per observer pair" % jsd_dim)
        for p in detail["jsd"]["pairs"]:
            i, j = idx[p["a"]], idx[p["b"]]
            val = p["score"] if key else p["per_dim"].get(str(jsd_dim))
            label = ("undefined — no dimension populated by both observers"
                     if val is None else "JSD %.3f" % val)
            for a, b in ((i, j), (j, i)):
                Z[a][b] = np.nan if val is None else val
                text[a][b] = label

    fig = go.Figure(go.Heatmap(
        z=Z, x=obs, y=obs, customdata=text, colorscale="Oranges",
        zmin=0, zmax=1, xgap=2, ygap=2, hoverongaps=False,
        colorbar=dict(thickness=10, len=0.8, title=dict(text="divergence",
                                                       font=dict(size=9.5))),
        hovertemplate="%{y} ↔ %{x}<br>%{customdata}<extra></extra>"))
    lay = dict(BASE)
    lay["margin"] = dict(l=52, r=16, t=40, b=40)
    fig.update_layout(height=330, title=dict(text=title,
                                             font=dict(size=11,
                                                       color="#5a616b")), **lay)
    fig.update_yaxes(autorange="reversed", tickfont=dict(size=9.5))
    fig.update_xaxes(tickfont=dict(size=9.5))
    return fig


def div_profile_fig(detail: dict) -> go.Figure:
    """Observer x code normalised profile, all five dimensions side by side."""
    obs = [o["observer"] for o in detail["observers"]]
    codes, seps, ticks = [], [], []
    for d in DIMS:
        cs = leaf_codes(d)
        codes += cs
        ticks += cs
        seps.append(len(codes) - 0.5)
    Z = np.zeros((len(obs), len(codes)))
    for i, o in enumerate(obs):
        prof = detail["jsd"]["profiles"].get(o) or {}
        for j, c in enumerate(codes):
            Z[i, j] = float((prof.get(str(int(c.split(".")[0]))) or {}).get(c, 0.0))
    fig = go.Figure(go.Heatmap(
        z=Z, x=ticks, y=obs, colorscale="Oranges", zmin=0, zmax=1,
        xgap=2, ygap=2, colorbar=dict(thickness=10, len=0.8,
                                      title=dict(text="p", font=dict(size=9.5))),
        hovertemplate="%{y}<br>%{x}<br>p = %{z:.3f}<extra></extra>"))
    lay = dict(BASE)
    lay["margin"] = dict(l=52, r=16, t=40, b=76)
    fig.update_layout(height=300, title=dict(
        text="observer code profile · normalised to sum 1 inside each dimension",
        font=dict(size=11, color="#5a616b")), **lay)
    for s in seps[:-1]:
        fig.add_vline(x=s, line=dict(width=1, color="#c9ced6", dash="dot"))
    fig.update_xaxes(tickangle=-60, tickfont=dict(size=9), automargin=True)
    fig.update_yaxes(autorange="reversed", tickfont=dict(size=9.5))
    return fig


def div_inspector_cotc(detail: dict, items: Dict[str, dict]) -> List:
    rows = []
    for rec in sorted(detail["cotc"]["per_item"],
                      key=lambda r: (-r["covered"], r["observer"])):
        it = items.get(rec["key"]) or {}
        peers = ", ".join(
            "%s %s" % (peer, "/".join("%d–%d" % (s, e) for s, e in ivs))
            for peer, ivs in sorted((rec.get("peer_intervals") or {}).items())
        ) or "none"
        rows.append(html.Tr([
            html.Td(rec["observer"], className="tl"),
            html.Td("%d (%s)" % (rec["base_frame"], _sec(rec["base_frame"]))),
            html.Td("%d / %d" % (rec["covered"], rec["denominator"])),
            html.Td("%.3f" % rec["score"]),
            html.Td(peers, className="tl muted small"),
            html.Td(STORE._short(it.get("feedback", ""), 70),
                    className="tl muted small"),
        ]))
    return [
        html.Div("Each anchor is one focal feedback's stored baseFrame, tested "
                 "against the merged timeline of each of the other 7 assigned "
                 "observers.", className="hint"),
        html.Table([html.Thead(html.Tr([
            html.Th("observer", className="tl"), html.Th("baseFrame"),
            html.Th("covered"), html.Th("score"),
            html.Th("covering peer intervals", className="tl"),
            html.Th("feedback", className="tl")])),
            html.Tbody(rows)], className="sep-table"),
    ]


def div_inspector_tjac(detail: dict, metric: str) -> List:
    undefined = [p for p in detail["tjac"]["pairs"] if p["score"] is None]
    rows = []
    for p in sorted(detail["tjac"]["pairs"],
                    key=lambda r: (r["score"] is None, r["score"] or 0.0)):
        rows.append(html.Tr([
            html.Td("%s ↔ %s" % (p["a"], p["b"]), className="tl"),
            html.Td("%d" % p["intersection"]), html.Td("%d" % p["union"]),
            html.Td("%d / %d" % (p["a_frames"], p["b_frames"])),
            html.Td(_num(p["score"])),
            html.Td(_num(None if p["score"] is None else 1 - p["score"])),
        ]))
    return [
        dcc.Graph(figure=div_matrix_fig(detail, "tjac", "macro"),
                  config={"displaylogo": False}),
        html.Div("Blank cells are undefined pairs: both observers left the "
                 "timeline empty in this mode, so the pair is dropped from the "
                 "mean instead of being scored as agreement. %d of %d pairs "
                 "here." % (len(undefined), len(detail["tjac"]["pairs"])),
                 className="hint"),
        html.Div(html.Table([html.Thead(html.Tr([
            html.Th("pair", className="tl"), html.Th("∩ frames"),
            html.Th("∪ frames"), html.Th("a / b frames"),
            html.Th("raw J"), html.Th("1 − J")])),
            html.Tbody(rows)], className="sep-table"), className="scroll-y"),
    ]


def div_inspector_smid(detail: dict, items: Dict[str, dict]) -> List:
    def codeset(key, d):
        it = items.get(key) or {}
        return " ".join((it.get("codes") or {}).get(str(d)) or []) or "—"

    rows = []
    for m in sorted(detail["smid"]["matches"], key=lambda r: -r["distance"]):
        per_dim = " · ".join(
            "D%d %s" % (d, _num(m["per_dim"].get(str(d)), "%.2f"))
            for d in DIMS)
        diff = html.Div([
            html.Div("D%d  %s   ↔   %s" % (d, codeset(m["focal_key"], d),
                                           codeset(m["peer_key"], d)),
                     className="mono small")
            for d in DIMS])
        rows.append(html.Tr([
            html.Td("%s → %s" % (m["focal"], m["peer"]), className="tl"),
            html.Td("%d (%s)" % (m["base_frame"], _sec(m["base_frame"]))),
            html.Td("%d in %d–%d" % (m["peer_base_frame"], m["peer_start"],
                                     m["peer_end"])),
            html.Td("%.3f" % m["distance"]),
            html.Td(per_dim, className="tl muted small"),
            html.Td(diff, className="tl"),
        ]))
    per_dim_head = " · ".join(
        "D%d %s" % (d, _num((detail["smid"]["per_dim"] or {}).get(str(d))))
        for d in DIMS)
    return [
        html.Div("Map score %s   ·   %s" % (_num(detail["smid"]["score"]),
                                            per_dim_head), className="hint"),
        html.Div("A match holds the moment fixed: the focal item's baseFrame "
                 "falls inside a peer interval, and the nearest peer anchor "
                 "wins (ties broken on interval length, then feedback index, "
                 "then docId). Dimensions where neither item carries a code are "
                 "dropped from the macro-average, not scored as agreement.",
                 className="hint"),
        html.Div(html.Table([html.Thead(html.Tr([
            html.Th("directed pair", className="tl"), html.Th("focal anchor"),
            html.Th("peer anchor / interval"), html.Th("distance"),
            html.Th("per dimension", className="tl"),
            html.Th("code sets  focal ↔ peer", className="tl")])),
            html.Tbody(rows)], className="sep-table"), className="scroll-y"),
    ]


def div_inspector_jsd(detail: dict, jsd_dim: str) -> List:
    undefined = [p for p in detail["jsd"]["pairs"] if p["score"] is None]
    per_dim_head = " · ".join(
        "D%d %s" % (d, _num((detail["jsd"]["per_dim"] or {}).get(str(d))))
        for d in DIMS)
    return [
        html.Div("Map score %s   ·   %s" % (_num(detail["jsd"]["score"]),
                                            per_dim_head), className="hint"),
        dcc.Graph(figure=div_matrix_fig(detail, "jsd", jsd_dim),
                  config={"displaylogo": False}),
        dcc.Graph(figure=div_profile_fig(detail), config={"displaylogo": False}),
        html.Div("Blank matrix cells are pairs with no dimension populated by "
                 "both observers (%d of %d), so they are excluded from the "
                 "mean rather than scored."
                 % (len(undefined), len(detail["jsd"]["pairs"])),
                 className="hint"),
    ]


def div_drawer(traj_id, mode: str, metric: str, jsd_dim: str) -> List:
    if not STORE.has_divergence:
        return [html.Div(DIV_MISSING, className="muted pad")]
    if not traj_id:
        return [html.Div("Click a map in the distribution above to pin it here: "
                         "all eight observer lanes, every feedback with its "
                         "anchor, interval and D1–D5 coding, and the inspector "
                         "for the selected metric.", className="muted pad")]
    detail = STORE.divergence_detail(traj_id, mode)
    row = STORE.div_maps[(STORE.div_maps["traj_id"] == traj_id)
                         & (STORE.div_maps["mode"] == mode)]
    if detail is None or row.empty:
        return [html.Div("No divergence detail for %s." % traj_id,
                         className="muted pad")]
    r = row.iloc[0]
    band = r.get("%s_band" % metric)
    items = {it["key"]: it for it in detail["items"]}

    score_cells = [("%s" % dv.METRIC_SHORT[metric], _num(r[metric])),
                   ("divergence band", dv.BAND_LABEL.get(band, "—"))]
    if dv.METRIC_IS_FLIPPED[metric]:
        score_cells.append(("raw convergence", _num(r["%s_raw" % metric])))
    score_cells += [
        ("active observers", "%d / %d" % (int(r["n_active_observers"]),
                                          int(r["n_assigned_observers"]))),
        ("valid temporal pairs", "%d / %d" % (int(r["tjac_valid_pairs"]),
                                             int(r["tjac_pairs"]))),
        ("SMID matched pairs", "%d / %d"
         % (int(r["smid_matched_directed_pairs"]),
            int(r["smid_directed_pairs"]))),
        ("valid JSD pairs", "%d / %d" % (int(r["jsd_valid_pairs"]),
                                         int(r["jsd_pairs"]))),
        ("items used / range-free", "%d / %d" % (int(r["n_items_used"]),
                                                 int(r["n_range_free_items"]))),
    ]

    if metric == "cotc":
        inspector = div_inspector_cotc(detail, items)
    elif metric == "tjac":
        inspector = div_inspector_tjac(detail, metric)
    elif metric == "smid":
        inspector = div_inspector_smid(detail, items)
    else:
        inspector = div_inspector_jsd(detail, jsd_dim)

    return [
        html.Div([
            html.Div([html.Span("PINNED MAP", className="rail-title"),
                      html.Span(traj_id, className="mono small")]),
            html.Button("unpin", id="btn-div-unpin", className="btn-mini"),
        ], className="toolbar toolbar-split"),
        html.Div([chip(str(r["performance_group"]),
                       GROUP_COLOR.get(r["performance_group"], GREY)),
                  chip(str(r["policy"]),
                       REGIME_COLOR.get(r["policy"], GREY)),
                  chip("%d agents" % int(r["agent_count"]), GREY),
                  chip(dv.BAND_LABEL.get(band, "—"),
                       BAND_COLOR.get(band, GREY)),
                  chip("%d frames · %s" % (int(r["total_frames"]),
                                           dv.MODE_LABEL[mode]), GREY)],
                 className="chips"),
        html.Div([html.Div([html.Span(k, className="stat-k"),
                            html.Span(v, className="stat-v")], className="stat")
                  for k, v in score_cells], className="stats"),
        html.Div("Observers", className="sec"),
        html.Div(div_observer_lanes(detail), className="obs-wrap"),
        html.Div("%s inspector" % dv.METRIC_SHORT[metric], className="sec"),
        html.Div(inspector),
    ]

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
        html.Label("agent count", className="lab"),
        dcc.Checklist(id="f-agents",
                      options=[{"label": " %d agents" % a, "value": a}
                               for a in STORE.agent_counts],
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
        html.Div([
            html.Div([html.Label("view", className="lab"),
                      dcc.RadioItems(id="a-view",
                                     options=[{"label": " map", "value": "map"},
                                              {"label": " 5-dimension facet",
                                               "value": "facet"},
                                              {"label": " UMAP stability",
                                               "value": "stability"}],
                                     value="map", className="chk radio-inline")]),
            html.Div([html.Label("colour by", className="lab"),
                      dcc.Dropdown(id="color-by", options=COLOR_OPTIONS,
                                   value="d5", clearable=False, className="dd")],
                     style={"flex": "1 1 300px"}),
            dcc.Checklist(id="a-opts",
                          options=[{"label": " grey ghosts for filtered-out points",
                                    "value": "ghost"}],
                          value=["ghost"], className="chk radio-inline",
                          style={"paddingTop": "18px"}),
        ], className="toolbar"),
        dcc.Graph(id="g-embed", config={"scrollZoom": True, "displaylogo": False}),
        html.Div(id="a-hint", className="hint"),
    ], className="panel"),

    html.Div([
        html.Div([
            html.Div([
                html.Span("Dimension separability", className="sec-title"),
                html.Span("measured on the original 3072-d embeddings, not on "
                          "the 2D map above", className="muted small"),
            ]),
            html.Div([
                html.Label("label set", className="lab"),
                dcc.RadioItems(
                    id="sep-labelset",
                    options=[{"label": " as-coded", "value": "as-coded"},
                             {"label": " parent roll-up", "value": "parent"}],
                    value="as-coded", className="chk radio-inline"),
            ]),
        ], className="toolbar toolbar-split"),
        dcc.Graph(id="g-sep", config={"displaylogo": False}),
        dcc.Graph(id="g-sep-code", config={"displaylogo": False}),
        html.Div(id="sep-table"),
    ], className="panel"),
], className="panel-stack")

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

TAB_F = html.Div([
    html.Div([
        html.Div([
            html.Div([html.Label("metric", className="lab"),
                      dcc.Dropdown(id="f-metric", options=DIV_METRIC_OPTIONS,
                                   value="cotc", clearable=False,
                                   className="dd")],
                     style={"flex": "1 1 320px"}),
            html.Div([html.Label("analysis mode", className="lab"),
                      dcc.RadioItems(id="f-mode", options=DIV_MODE_OPTIONS,
                                     value="primary", className="chk")]),
            html.Div([html.Label("JSD dimension tab", className="lab"),
                      dcc.RadioItems(id="f-jsd-dim",
                                     options=DIV_JSD_DIM_OPTIONS,
                                     value="macro",
                                     className="chk radio-inline")]),
        ], className="toolbar"),
        dcc.Graph(id="g-div-dist", config={"displaylogo": False}),
        html.Div(id="div-stats", className="stats"),
        html.Div(id="div-legend"),
        html.Div("One point is one trajectory. Map scores come from all eight "
                 "assigned observers and are read from the build, so the rail "
                 "filters choose which maps are shown and never re-derive a "
                 "score, a band or the y-axis range.", className="hint"),
    ], className="panel"),

    html.Div(id="div-drawer", className="panel"),

    html.Div([
        html.Div("Data coverage & quality diagnostics", className="sec-title"),
        html.Div("Counted over the maps currently on screen. Every map always "
                 "has 8 assigned observers; in Primary mode some of them "
                 "submitted no ranged feedback, which is why the active count "
                 "can be lower. Coder confidence, partial codes and coding "
                 "reasons appear in the detail inspector and never weight a "
                 "metric.", className="hint"),
        html.Div(id="div-diagnostics"),
    ], className="panel"),
], className="panel-stack")


app = Dash(__name__, title="Human-Perceived Feedback · Analysis")
app.config.suppress_callback_exceptions = True

# ---------------------------------------------------------------- auth ------
# Every panel shows verbatim participant feedback and participant ids, so the
# dashboard must never be reachable without credentials once it is exposed past
# localhost. Set DASH_USER and DASH_PASS in the environment to require a login;
# leaving them unset keeps the app open, which is only safe on 127.0.0.1.
AUTH_USER = os.environ.get("DASH_USER")
AUTH_PASS = os.environ.get("DASH_PASS")

if AUTH_USER and AUTH_PASS:
    from flask import Response
    from flask import request as flask_request

    @app.server.before_request
    def _require_login():
        a = flask_request.authorization
        ok = bool(a) and (
            secrets.compare_digest((a.username or ""), AUTH_USER)
            and secrets.compare_digest((a.password or ""), AUTH_PASS))
        if ok:
            return None
        return Response(
            "Authentication required.", 401,
            {"WWW-Authenticate": 'Basic realm="feedback dashboard"'})

    print("HTTP Basic Auth enabled for user %r" % AUTH_USER)
else:
    print("WARNING: no DASH_USER/DASH_PASS set - the app is unauthenticated. "
          "Do not expose it beyond 127.0.0.1.")

app.layout = html.Div([
    dcc.Store(id="st-ids"),
    dcc.Store(id="st-sel"),
    dcc.Store(id="st-hl"),
    dcc.Store(id="st-div-sel"),

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
                dcc.Tab(label="F · Observer divergence", value="F",
                        children=TAB_F, className="tab",
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
    Input("f-agents", "value"),
    Input("f-conf", "value"), Input("f-kw", "value"),
    Input("within-logic", "value"),
    State({"type": "dimfilter", "dim": ALL}, "id"),
)
def apply_filters(dimvals, groups, score, valences, regimes, trajs, buckets,
                  agents, conf, kw, logic, dimids):
    sel: Dict[int, List[str]] = {}
    for v, i in zip(dimvals or [], dimids or []):
        sel[int(i["dim"])] = v or []
    m = STORE.filter_mask(sel, groups or [], score or [1, 5], valences or [],
                          regimes or [], trajs or [], buckets or [],
                          bool(conf), kw, logic == "and", agents or [])
    ids = DF.loc[m, "id"].astype(int).tolist()
    pct = 100.0 * len(ids) / N_TOTAL
    active = sum(1 for v in (dimvals or []) if v) + sum(
        1 for v in [groups, valences, regimes, trajs, buckets, agents, conf]
        if v)
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
    Output("f-agents", "value"),
    Output("f-conf", "value"), Output("f-kw", "value"),
    Input("btn-reset", "n_clicks"),
    State({"type": "dimfilter", "dim": ALL}, "value"),
    prevent_initial_call=True,
)
def reset(_n, dimvals):
    return [[] for _ in dimvals], [], [1, 5], [], [], [], [], [], [], ""


@app.callback(
    Output("g-embed", "figure"),
    Input("st-ids", "data"), Input("color-by", "value"),
    Input("a-view", "value"), Input("a-opts", "value"),
    Input("st-sel", "data"), Input("st-hl", "data"),
)
def draw_embed(ids, color_by, view, opts, sel, hl):
    ghost = "ghost" in (opts or [])
    if view == "facet":
        return fig_facet(ids or [], ghost)
    if view == "stability":
        return fig_stability(ids or [], color_by)
    return fig_embedding(ids or [], color_by, ghost, sel, hl)


HINTS = {
    "map": ("Position = UMAP of text-embedding-3-large. Thicker outline = the "
            "point carries more than one code in the coloured dimension. "
            "Click a point to open the inspector."),
    "facet": ("The same coordinates, coloured by each dimension in turn — the "
              "view that shows which dimensions are semantically coherent. "
              "Each header carries that dimension's probe AUROC so the "
              "impression can be checked against the number."),
    "stability": ("The same points re-projected under several UMAP seeds and "
                  "n_neighbors values. If a pattern survives the grid it is a "
                  "property of the data, not of the hyper-parameters."),
}


@app.callback(Output("a-hint", "children"), Input("a-view", "value"))
def draw_hint(view):
    return HINTS.get(view, HINTS["map"])


@app.callback(Output("g-sep", "figure"), Output("g-sep-code", "figure"),
              Output("sep-table", "children"),
              Input("sep-labelset", "value"))
def draw_separability(label_set):
    return (fig_separability(label_set), fig_code_auroc(label_set),
            sep_table(label_set))


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
                     html.Span("inspector rail", className="muted")],
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


# --------------------------------------------- Panel F · observer divergence --
#
# One selector feeds the distribution, the stats, the diagnostics and the
# drawer, so the four can never disagree about which trajectories are in scope.

@app.callback(Output("g-div-dist", "figure"), Output("div-stats", "children"),
              Output("div-legend", "children"),
              Output("div-diagnostics", "children"),
              Input("st-ids", "data"), Input("f-metric", "value"),
              Input("f-mode", "value"))
def draw_divergence(ids, metric, mode):
    view = STORE.divergence_view(ids or [], mode)
    return (fig_div_dist(view, metric, mode),
            div_stats_bar(view, metric, mode),
            div_legend(metric, mode),
            div_diagnostics(view, metric, mode))


@app.callback(Output("st-div-sel", "data"),
              Input("g-div-dist", "clickData"),
              Input("btn-div-unpin", "n_clicks"),
              Input("f-mode", "value"),
              prevent_initial_call=True)
def pin_divergence_map(click, _unpin, _mode):
    trig = ctx.triggered_id
    if trig == "btn-div-unpin":
        return None
    if trig == "f-mode":
        return no_update          # a mode switch re-renders, it does not unpin
    if not click or not click.get("points"):
        return no_update
    return str(click["points"][0]["customdata"][1])


@app.callback(Output("div-drawer", "children"),
              Input("st-div-sel", "data"), Input("f-mode", "value"),
              Input("f-metric", "value"), Input("f-jsd-dim", "value"),
              State("st-ids", "data"))
def draw_divergence_drawer(traj_id, mode, metric, jsd_dim, ids):
    # A pinned map that the current filters exclude must not keep showing: the
    # drawer and the distribution share one trajectory set.
    if traj_id:
        view = STORE.divergence_view(ids or [], mode)
        if len(view) and traj_id not in set(view["traj_id"]):
            return [html.Div("The pinned map (%s) is outside the current "
                             "filter selection. Clear the filter or click "
                             "another point." % traj_id,
                             className="muted pad")]
    return div_drawer(traj_id, mode, metric, jsd_dim or "macro")


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
.toolbar-split{justify-content:space-between;align-items:flex-start}
.panel-stack{display:flex;flex-direction:column}
.sec-title{font-size:12.5px;font-weight:640;letter-spacing:-0.01em;
  margin-right:8px}
.sep-table{border-collapse:collapse;width:100%;font-size:11px;margin:2px 0 4px}
.sep-table th{text-align:right;font-weight:600;color:var(--muted);
  padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap;
  font-size:10px;letter-spacing:.02em}
.sep-table td{text-align:right;padding:5px 8px;
  border-bottom:1px solid #f1f2f4;font-variant-numeric:tabular-nums}
.sep-table th:first-child,.sep-table td.tl{text-align:left}
.sep-table tr:hover td{background:#f7f8fa}
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
.obs-card-empty{background:#fafbfc;border-style:dashed}
.lane-dims>summary{cursor:pointer;font-size:10.5px;color:var(--muted);
  margin-top:4px}
.lane-dims>summary::before{content:"▸ "}
.lane-dims[open]>summary::before{content:"▾ "}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px}
.stat{border:1px solid var(--line);border-radius:6px;padding:4px 9px;
  background:#f9fafb;display:flex;flex-direction:column;min-width:96px}
.stat-k{font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--muted)}
.stat-v{font-size:12.5px;font-weight:620;letter-spacing:-0.01em}
.scroll-y{max-height:420px;overflow-y:auto;border:1px solid var(--line);
  border-radius:6px}

::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:#d3d7dd;border-radius:5px}
::-webkit-scrollbar-track{background:transparent}
</style></head>
<body>{%app_entry%}<footer>{%config%}{%scripts%}{%renderer%}</footer></body></html>
"""


if __name__ == "__main__":
    app.run(debug=False,
            host=os.environ.get("DASH_HOST", "127.0.0.1"),
            port=int(os.environ.get("DASH_PORT", "8050")))
