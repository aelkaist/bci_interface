"""Shared taxonomy codebook, hierarchy helpers, and colour palettes.

Imported by the preprocessing scripts and by the Dash app so that code names
and colours stay identical everywhere.
"""

from __future__ import annotations

from typing import Dict, List

# ---------------------------------------------------------------- codebook ---

CODEBOOK: Dict[int, dict] = {
    1: {"label": "Focus of Observation", "codes": {
        "1.1":   "Agent (parent)",
        "1.1.1": "Individual Agent",
        "1.1.2": "Multiple Agents",
        "1.1.3": "Team as a Whole",
        "1.2":   "Task Resources / Environment",
        "1.3":   "Other"}},
    2: {"label": "Observed Behavior", "codes": {
        "2.1":   "Movement (parent)",
        "2.1.1": "Agent Movement and Navigation",
        "2.2":   "Agent Coordination (parent)",
        "2.2.1": "Physical Coordination",
        "2.2.2": "Role and Work Distribution",
        "2.3":   "Environment Interaction (parent)",
        "2.3.1": "Agent Interaction w/ Environment",
        "2.4":   "Performance (parent)",
        "2.4.1": "Task Progress and Performance",
        "2.4.2": "Time Use and Delay",
        "2.5":   "Other"}},
    3: {"label": "Monitoring Strategy", "codes": {
        "3.1": "Fixed-Agent Tracking",
        "3.2": "Overall Process Monitoring",
        "3.3": "Event-Triggered Monitoring",
        "3.4": "Behavior Change Monitoring",
        "3.5": "Other"}},
    4: {"label": "Interpreting Behavior", "codes": {
        "4.1": "Evaluative Judgment",
        "4.2": "Underlying State Inference",
        "4.3": "Causal Explanation",
        "4.4": "Other"}},
    5: {"label": "Feedback Type", "codes": {
        "5.1": "Descriptive",
        "5.2": "Praise",
        "5.3": "Criticism",
        "5.4": "Suggestion",
        "5.5": "Counterfactual",
        "5.6": "Other"}},
}

DIMS: List[int] = [1, 2, 3, 4, 5]

DIM_LABEL: Dict[int, str] = {d: CODEBOOK[d]["label"] for d in DIMS}

CODE_NAME: Dict[str, str] = {}
for _d in DIMS:
    CODE_NAME.update(CODEBOOK[_d]["codes"])


def code_dim(code: str) -> int:
    """'2.3.1' -> 2"""
    return int(code.split(".")[0])


def is_parent(code: str) -> bool:
    """A 2-level code that has at least one 3-level child in the codebook."""
    if code.count(".") != 1:
        return False
    return any(c.startswith(code + ".") for c in CODE_NAME)


def children_of(code: str) -> List[str]:
    return sorted(c for c in CODE_NAME if c.startswith(code + ".") and c != code)


def expand(code: str) -> List[str]:
    """Selected code -> every code that should match it in the data.

    Parent roll-up rule: leaf 'a.b.c' also belongs to parent 'a.b'.
    """
    return [code] + children_of(code)


def dim_options(dim: int) -> List[str]:
    """Codes of a dimension in display order (parent immediately before children)."""
    return list(CODEBOOK[dim]["codes"].keys())


def leaf_codes(dim: int) -> List[str]:
    """Codes that actually occur as labels in the data (parents excluded)."""
    return [c for c in dim_options(dim) if not is_parent(c)]


# ---------------------------------------------------------------- palettes ---
#
# Every palette below was checked with the data-viz validator against the chart
# surface #fbfbfc; the results are quoted so a later edit can be re-checked.
#
#   CAT8      adjacent pairlist -> PASS  (CVD dE 11.4, normal-vision dE 16.4)
#   SEQ_3/4   ordinal           -> PASS  (monotone L, dL >= .06, one hue)
#   DIVERGING all pairs         -> PASS  (CVD dE 15.0, normal-vision dE 18.7)
#
# The contrast WARN on the lighter slots is discharged the way the rule
# requires: every panel carries a visible legend with the code name, hover
# labels, and a CSV export of the underlying table.

SURFACE = "#fbfbfc"

# Categorical identity. Fixed order, never cycled. No taxonomy dimension needs
# more than 7 slots (D2 is the widest), so the 8 are never exhausted by a code
# encoding; cluster encodings past 8 fold into "other" instead of inventing hues.
CAT8 = [
    "#0072B2",  # 1 blue
    "#E69F00",  # 2 orange
    "#009E73",  # 3 bluish green
    "#7B68B6",  # 4 purple
    "#56B4E9",  # 5 sky blue
    "#D55E00",  # 6 vermillion
    "#CC79A7",  # 7 reddish purple
    "#4C7A2E",  # 8 olive
]

# Secondary (non-colour) encoding for scatter marks. No 7-colour palette can
# clear the all-pairs CVD floor, and a scatter shows every category at once, so
# identity is carried by shape as well as hue.
SYMBOLS = ["circle", "square", "diamond", "triangle-up", "cross",
           "triangle-down", "x", "star"]

GREY = "#9AA0A6"          # "none" / no code (neutral, also the diverging middle)
NOISE_GREY = "#C3C7CE"    # HDBSCAN noise
OTHER_GREY = "#8A9099"    # folded "other clusters"
GHOST = "#dcdfe4"         # de-emphasised background points

# Stable colour + symbol per taxonomy code: index within its dimension's order.
CODE_COLOR: Dict[str, str] = {}
CODE_SYMBOL: Dict[str, str] = {}
for _d in DIMS:
    for _i, _c in enumerate(c for c in dim_options(_d) if not is_parent(c)):
        CODE_COLOR[_c] = CAT8[_i % len(CAT8)]
        CODE_SYMBOL[_c] = SYMBOLS[_i % len(SYMBOLS)]
for _d in DIMS:                      # parents inherit their first child's hue
    for _c in dim_options(_d):
        if is_parent(_c):
            kids = children_of(_c)
            CODE_COLOR[_c] = CODE_COLOR.get(kids[0], GREY) if kids else GREY
            CODE_SYMBOL[_c] = CODE_SYMBOL.get(kids[0], "circle") if kids else "circle"

# Agent competence is ordered (low < mid < high) -> sequential single hue.
GROUP_ORDER = ["low", "mid", "high"]
GROUP_COLOR = {"low": "#7FB2D6", "mid": "#2E7FB4", "high": "#0C4A75"}
GROUP_SYMBOL = {"low": "circle", "mid": "square", "high": "diamond"}

# perf bucket is also ordered -> sequential single hue, 4 steps.
BUCKET_ORDER = [40, 60, 80, 100]
BUCKET_COLOR = {40: "#7FB2D6", 60: "#4A8FBF", 80: "#2470A5", 100: "#0C4A75"}

# Divergence band is ordered (low < mid < high) -> sequential single hue, built
# by the same rule as the two ramps above: one hue, monotone lightness, dL well
# clear of the .06 floor (measured L* 87.0 / 66.1 / 38.4 -> dL .21, .28). The
# hue is warm rather than blue so a divergence band can never be misread as the
# blue agent-competence or perf-bucket encoding sitting next to it.
BAND_ORDER = ["low", "mid", "high"]
BAND_COLOR = {"low": "#F6D5A8", "mid": "#DE8F3C", "high": "#8A4A0C"}
BAND_SYMBOL = {"low": "circle", "mid": "square", "high": "diamond"}

# Perceived valence is polarity -> diverging: two poles, neutral grey midpoint.
NEG_POLE, POS_POLE = "#B2182B", "#14568A"
VALENCE_ORDER = ["negative", "neutral", "positive"]
VALENCE_COLOR = {"negative": NEG_POLE, "neutral": GREY, "positive": POS_POLE}
VALENCE_SYMBOL = {"negative": "triangle-down", "neutral": "circle",
                  "positive": "triangle-up"}

# feedback_score 1-5 is the same polarity on a finer scale -> same diverging ramp.
SCORE_STEPS = {1: NEG_POLE, 2: "#D9736B", 3: GREY, 4: "#5B9BD1", 5: POS_POLE}
SCORE_SCALE = [[0.0, NEG_POLE], [0.25, "#D9736B"], [0.5, GREY],
               [0.75, "#5B9BD1"], [1.0, POS_POLE]]

REGIME_ORDER = ["forced", "incentivized"]
REGIME_COLOR = {"forced": CAT8[0], "incentivized": CAT8[1]}
REGIME_SYMBOL = {"forced": "circle", "incentivized": "square"}

CONF_ORDER = ["confident", "partial fit"]
CONF_COLOR = {"confident": CAT8[0], "partial fit": CAT8[1]}
CONF_SYMBOL = {"confident": "circle", "partial fit": "square"}


def tint(hex_color: str, alpha: float = 0.16) -> str:
    """Series hue as a soft background wash, so labels keep their ink colour."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return "rgba(%d,%d,%d,%.2f)" % (r, g, b, alpha)


def color_for(kind: str, value) -> str:
    """Categorical colour lookup used across every panel."""
    if value in (None, "", "none"):
        return GREY
    if kind == "group":
        return GROUP_COLOR.get(value, GREY)
    if kind == "valence":
        return VALENCE_COLOR.get(value, GREY)
    if kind == "regime":
        return REGIME_COLOR.get(value, GREY)
    if kind == "confidence":
        return CONF_COLOR.get(value, GREY)
    if kind == "code":
        return CODE_COLOR.get(value, GREY)
    if kind == "band":
        return BAND_COLOR.get(value, GREY)
    return GREY
