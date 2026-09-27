"""Unit tests for the observer-divergence metric layer.

Run:  cd analysis/feedback-dashboard && python -m pytest tests -q

The first three classes need nothing but ``divergence.py``. The classes at the
bottom read the artefacts written by ``05_divergence.py`` and skip cleanly when
the build has not been run.
"""

from __future__ import annotations

import importlib.util
import math
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import divergence as dv  # noqa: E402


def _load_build_module():
    """Import 05_divergence.py, whose name is not a valid identifier."""
    path = os.path.join(ROOT, "05_divergence.py")
    spec = importlib.util.spec_from_file_location("divergence_build", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ------------------------------------------------------------- intervals -----

class TestIntervals:

    def test_merge_overlapping(self):
        assert dv.merge_intervals([(0, 10), (5, 15)]) == [(0, 15)]

    def test_merge_adjacent_is_fused(self):
        # end + 1 == next start: one uninterrupted stretch on a frame grid.
        assert dv.merge_intervals([(0, 4), (5, 9)]) == [(0, 9)]

    def test_merge_leaves_a_one_frame_gap_alone(self):
        assert dv.merge_intervals([(0, 4), (6, 9)]) == [(0, 4), (6, 9)]

    def test_merge_is_order_independent_and_sorted(self):
        a = dv.merge_intervals([(20, 25), (0, 4), (24, 30), (5, 9)])
        assert a == [(0, 9), (20, 30)]

    def test_merge_handles_reversed_and_point_intervals(self):
        assert dv.merge_intervals([(9, 5), (12, 12)]) == [(5, 9), (12, 12)]

    def test_merge_empty(self):
        assert dv.merge_intervals([]) == []

    def test_inclusive_length(self):
        assert dv.interval_frames(3, 3) == 1
        assert dv.interval_frames(0, 9) == 10

    def test_intersection_and_union(self):
        a, b = [(0, 9)], [(5, 14)]
        assert dv.intersection_frames(a, b) == 5      # frames 5..9
        assert dv.union_frames(a, b) == 15            # frames 0..14
        assert dv.temporal_jaccard(a, b) == pytest.approx(5 / 15)

    def test_intersection_multi_interval(self):
        a = [(0, 4), (10, 14), (20, 24)]
        b = [(3, 11), (23, 30)]
        # 3..4 (2) + 10..11 (2) + 23..24 (2)
        assert dv.intersection_frames(a, b) == 6
        assert dv.union_frames(a, b) == (5 + 5 + 5) + (9 + 8) - 6

    def test_disjoint_timelines_score_zero(self):
        assert dv.temporal_jaccard([(0, 4)], [(10, 14)]) == 0.0

    def test_identical_timelines_score_one(self):
        assert dv.temporal_jaccard([(0, 9)], [(0, 9)]) == 1.0

    def test_clamp_to_trajectory_boundary(self):
        assert dv.clamp_interval(-3, 5, 201) == (0, 5)
        assert dv.clamp_interval(195, 260, 201) == (195, 200)
        assert dv.clamp_interval(300, 400, 201) is None

    def test_sensitivity_window_is_derived_from_the_real_frame_duration(self):
        # 0.42 s/frame -> +/-2 s is +/-5 frames, not +/-4 (that needs 2 fps).
        assert dv.frames_for_seconds(2.0, 0.42) == 5
        assert dv.frames_for_seconds(2.0, 0.5) == 4
        assert dv.SENSITIVITY_HALF_WIDTH_FRAMES == 5
        assert dv.base_frame_window(1, 5, 201) == (0, 6)
        assert dv.base_frame_window(199, 5, 201) == (194, 200)


class TestEmptyTimelinePolicy:

    def test_both_empty_is_undefined(self):
        assert dv.temporal_jaccard([], []) is None

    def test_one_empty_is_zero_not_undefined(self):
        assert dv.temporal_jaccard([(0, 9)], []) == 0.0
        assert dv.temporal_jaccard([], [(0, 9)]) == 0.0

    def test_undefined_pairs_are_excluded_from_the_map_mean(self):
        tl = {"O1": [(0, 9)], "O2": [(5, 14)], "O3": [], "O4": []}
        out = dv.temporal_jaccard_map(tl)
        assert out["n_pairs"] == 6                # 4 choose 2
        assert out["n_valid_pairs"] == 5          # O3-O4 undefined
        scores = [p["score"] for p in out["pairs"] if p["score"] is not None]
        assert out["raw"] == pytest.approx(sum(scores) / len(scores))
        assert out["divergence"] == pytest.approx(1.0 - out["raw"])

    def test_all_empty_leaves_the_map_score_undefined(self):
        out = dv.temporal_jaccard_map({"O1": [], "O2": []})
        assert out["raw"] is None and out["divergence"] is None


# ------------------------------------------------------------------ COTC -----

class TestCOTC:

    @staticmethod
    def _peers(n_covering):
        peers = {}
        for i in range(7):
            peers["P%d" % i] = [(0, 10)] if i < n_covering else [(50, 60)]
        return peers

    @pytest.mark.parametrize("k", list(range(8)))
    def test_item_score_is_k_over_7(self, k):
        score, matched = dv.cotc_item(5, self._peers(k))
        assert score == pytest.approx(k / 7.0)
        assert len(matched) == k
        assert 0.0 <= score <= 1.0

    def test_denominator_is_assigned_peers_not_active_peers(self):
        # Two of the seven peers submitted nothing usable: they count as
        # non-covering, they do not shrink the denominator.
        peers = {"P%d" % i: ([(0, 10)] if i < 3 else []) for i in range(7)}
        score, matched = dv.cotc_item(5, peers)
        assert matched == ["P0", "P1", "P2"]
        assert score == pytest.approx(3 / 7.0)

    def test_matched_peers_are_reported_and_sorted(self):
        peers = {"O3": [(0, 10)], "O2": [(0, 10)], "O9": [(90, 99)]}
        _, matched = dv.cotc_item(5, peers)
        assert matched == ["O2", "O3"]

    def test_base_frame_outside_its_own_range_is_not_repaired(self):
        # Focal item's stored baseFrame is 15 while its own window is 60-68.
        # The anchor stays 15, so only peers covering 15 count.
        anchors = {"O1": [{"key": "a", "base_frame": 15}]}
        timelines = {"O1": [(60, 68)], "O2": [(10, 20)], "O3": [(60, 68)]}
        anchors.update({"O2": [], "O3": []})
        out = dv.cotc_map(anchors, timelines)
        item = out["per_item"][0]
        assert item["base_frame"] == 15
        assert item["matched_peers"] == ["O2"]
        assert item["score"] == pytest.approx(1 / 7.0)

    def test_aggregation_is_item_then_observer_then_map(self):
        # O1 writes two items (1.0 and 0.0), O2 writes one (0.0).
        # Observer means are 0.5 and 0.0 -> map 0.25, not the item mean 1/3.
        timelines = {"O1": [(0, 10)], "O2": [(0, 10)]}
        for i in range(3, 9):
            timelines["O%d" % i] = []
        anchors = {o: [] for o in timelines}
        anchors["O1"] = [{"key": "a", "base_frame": 5},
                         {"key": "b", "base_frame": 100}]
        anchors["O2"] = [{"key": "c", "base_frame": 100}]
        out = dv.cotc_map(anchors, timelines)
        assert out["per_observer"]["O1"] == pytest.approx(0.5 / 7 + 0.0)
        assert out["n_focal_observers"] == 2
        assert out["raw"] == pytest.approx(((1 / 7.0 + 0.0) / 2 + 0.0) / 2)

    def test_observers_without_focal_items_are_dropped_from_the_mean(self):
        timelines = {"O1": [(0, 10)], "O2": [(0, 10)]}
        anchors = {"O1": [{"key": "a", "base_frame": 5}], "O2": []}
        out = dv.cotc_map(anchors, timelines)
        assert out["per_observer"]["O2"] is None
        assert out["n_focal_observers"] == 1
        assert out["raw"] == pytest.approx(1 / 7.0)


# ----------------------------------------------------- semantic code distance --

class TestCodeSetJaccard:

    def test_identical_sets(self):
        assert dv.code_set_jaccard_distance(["1.1.1"], ["1.1.1"]) == 0.0

    def test_disjoint_sets(self):
        assert dv.code_set_jaccard_distance(["1.1.1"], ["1.2"]) == 1.0

    def test_partial_overlap(self):
        d = dv.code_set_jaccard_distance(["2.1.1", "2.4.1"], ["2.4.1"])
        assert d == pytest.approx(1 - 1 / 2)

    def test_multilabel_overlap(self):
        d = dv.code_set_jaccard_distance(["a", "b", "c"], ["b", "c", "d"])
        assert d == pytest.approx(1 - 2 / 4)

    def test_one_side_empty_is_distance_one(self):
        assert dv.code_set_jaccard_distance([], ["3.2"]) == 1.0
        assert dv.code_set_jaccard_distance(["3.2"], []) == 1.0

    def test_both_empty_is_undefined(self):
        assert dv.code_set_jaccard_distance([], []) is None

    def test_duplicates_do_not_change_the_set_distance(self):
        assert dv.code_set_jaccard_distance(["a", "a"], ["a"]) == 0.0

    def test_macro_average_skips_only_mutually_empty_dimensions(self):
        a = {1: ["1.1.1"], 2: [], 3: ["3.2"], 4: [], 5: []}
        b = {1: ["1.1.1"], 2: ["2.5"], 3: ["3.1"], 4: [], 5: []}
        macro, per_dim = dv.code_distance(a, b)
        assert per_dim[1] == 0.0        # identical
        assert per_dim[2] == 1.0        # one side empty -> real distance
        assert per_dim[3] == 1.0        # disjoint
        assert per_dim[4] is None and per_dim[5] is None   # both empty
        assert macro == pytest.approx((0.0 + 1.0 + 1.0) / 3)


# ------------------------------------------------------------------ SMID -----

def _item(obs, key, base, start, end, codes, index=0, doc_id=""):
    return {"observer": obs, "key": key, "base_frame": base, "start": start,
            "end": end, "index": index, "doc_id": doc_id,
            "codes": {d: codes.get(d, []) for d in dv.DIMS}}


class TestSMIDMatching:

    def test_no_candidate_when_the_anchor_is_outside_every_peer_interval(self):
        peers = [_item("O2", "b", 50, 40, 60, {})]
        assert dv.nearest_peer_item(5, peers) is None

    def test_nearest_peer_base_frame_wins(self):
        peers = [_item("O2", "far", 30, 0, 100, {}),
                 _item("O2", "near", 12, 0, 100, {})]
        assert dv.nearest_peer_item(10, peers)["key"] == "near"

    def test_peer_matching_uses_the_interval_not_the_peer_base_frame(self):
        # The peer's baseFrame (90) is far away and outside its own window;
        # the window still contains the focal anchor, so it is a candidate.
        peers = [_item("O2", "b", 90, 0, 20, {})]
        assert dv.nearest_peer_item(10, peers)["key"] == "b"

    def test_tie_break_order_is_length_then_index_then_docid(self):
        # All three peer items sit 5 frames from the anchor.
        wide = _item("O2", "wide", 15, 0, 100, {}, index=1, doc_id="a")
        tight = _item("O2", "tight", 15, 8, 20, {}, index=9, doc_id="z")
        assert dv.nearest_peer_item(10, [wide, tight])["key"] == "tight"

        lo_idx = _item("O2", "lo", 15, 8, 20, {}, index=1, doc_id="z")
        hi_idx = _item("O2", "hi", 15, 8, 20, {}, index=9, doc_id="a")
        assert dv.nearest_peer_item(10, [hi_idx, lo_idx])["key"] == "lo"

        doc_a = _item("O2", "A", 15, 8, 20, {}, index=1, doc_id="aaa")
        doc_z = _item("O2", "Z", 15, 8, 20, {}, index=1, doc_id="zzz")
        assert dv.nearest_peer_item(10, [doc_z, doc_a])["key"] == "A"

    def test_match_is_independent_of_input_order(self):
        peers = [_item("O2", "p%d" % i, 12 + i, 0, 100, {}, index=i)
                 for i in range(5)]
        first = dv.nearest_peer_item(10, peers)["key"]
        assert dv.nearest_peer_item(10, list(reversed(peers)))["key"] == first

    def test_map_score_and_bookkeeping(self):
        items = {
            "O1": [_item("O1", "a", 10, 5, 15, {1: ["1.1.1"], 5: ["5.2"]})],
            "O2": [_item("O2", "b", 11, 5, 15, {1: ["1.1.1"], 5: ["5.3"]})],
        }
        for o in range(3, 9):
            items["O%d" % o] = []
        out = dv.smid_map(items)
        # D1 identical (0), D5 disjoint (1), D2-D4 both empty -> macro 0.5
        assert out["score"] == pytest.approx(0.5)
        assert out["per_dim"][1] == 0.0 and out["per_dim"][5] == 1.0
        assert out["per_dim"][2] is None
        assert out["n_matched_items"] == 2
        assert out["n_matched_directed_pairs"] == 2
        assert out["n_directed_pairs"] == 56
        assert out["match_rate"] == pytest.approx(2 / 14.0)   # 2 items x 7 peers

    def test_unmatched_items_do_not_dilute_the_score(self):
        items = {"O1": [_item("O1", "a", 10, 5, 15, {1: ["1.1.1"]}),
                        _item("O1", "z", 180, 175, 190, {1: ["1.2"]})],
                 "O2": [_item("O2", "b", 11, 5, 15, {1: ["1.1.1"]})]}
        out = dv.smid_map(items)
        assert out["score"] == pytest.approx(0.0)
        assert out["n_focal_items"] == 3
        assert out["n_matched_items"] == 2


# ------------------------------------------------------------------- JSD -----

class TestProfileJSD:

    def test_identical_profiles_are_zero(self):
        p = {"a": 0.5, "b": 0.5}
        assert dv.jsd_base2(p, dict(p)) == pytest.approx(0.0, abs=1e-12)

    def test_disjoint_profiles_are_one(self):
        assert dv.jsd_base2({"a": 1.0}, {"b": 1.0}) == pytest.approx(1.0)
        assert dv.jsd_base2({"a": 0.5, "b": 0.5},
                            {"c": 0.5, "d": 0.5}) == pytest.approx(1.0)

    def test_known_value_is_base_two(self):
        # P = (1, 0), Q = (0.5, 0.5): JSD = 1 - 0.75*log2(3) + ... check bounds
        v = dv.jsd_base2({"a": 1.0}, {"a": 0.5, "b": 0.5})
        assert 0.0 < v < 1.0
        expected = 1.5 - 0.75 * math.log2(3.0)
        assert v == pytest.approx(expected)

    def test_symmetry(self):
        p, q = {"a": 0.7, "b": 0.3}, {"a": 0.2, "c": 0.8}
        assert dv.jsd_base2(p, q) == pytest.approx(dv.jsd_base2(q, p))

    def test_empty_profile_is_undefined(self):
        assert dv.jsd_base2({}, {"a": 1.0}) is None
        assert dv.jsd_base2({}, {}) is None

    def test_normalise_sums_to_one(self):
        prof = dv.normalize_profile({"a": 3, "b": 1})
        assert sum(prof.values()) == pytest.approx(1.0)
        assert prof["a"] == pytest.approx(0.75)

    def test_normalise_empty(self):
        assert dv.normalize_profile({}) == {}
        assert dv.normalize_profile({"a": 0}) == {}

    def test_pair_macro_average_uses_only_shared_dimensions(self):
        a = {1: {"1.1.1": 1.0}, 2: {"2.1.1": 1.0}}
        b = {1: {"1.2": 1.0}, 3: {"3.2": 1.0}}
        score, per_dim = dv.profile_jsd_pair(a, b)
        assert per_dim[1] == pytest.approx(1.0)
        assert per_dim[2] is None and per_dim[3] is None
        assert score == pytest.approx(1.0)

    def test_map_drops_pairs_with_no_shared_dimension(self):
        profiles = {"O1": {1: {"1.1.1": 1.0}},
                    "O2": {1: {"1.1.1": 1.0}},
                    "O3": {}}
        out = dv.profile_jsd_map(profiles)
        assert out["n_pairs"] == 3 and out["n_valid_pairs"] == 1
        assert out["score"] == pytest.approx(0.0)


# ----------------------------------------------------------------- bands -----

class TestBands:

    def test_thresholds_and_assignment(self):
        scores = [i / 100.0 for i in range(101)]
        q33, q67 = dv.band_thresholds(scores)
        assert q33 == pytest.approx(1 / 3.0, abs=0.01)
        assert q67 == pytest.approx(2 / 3.0, abs=0.01)
        assert dv.band_of(0.0, (q33, q67)) == "low"
        assert dv.band_of(q33, (q33, q67)) == "mid"       # boundary is inclusive
        assert dv.band_of(q67, (q33, q67)) == "high"
        assert dv.band_of(1.0, (q33, q67)) == "high"

    def test_undefined_inputs(self):
        assert dv.band_thresholds([]) is None
        assert dv.band_of(None, (0.1, 0.2)) is None
        assert dv.band_of(0.5, None) is None
        assert dv.band_of(float("nan"), (0.1, 0.2)) is None


# ------------------------------------------------- normalisation & the join ---

class TestNormalisation:

    @classmethod
    def setup_class(cls):
        cls.mod = _load_build_module()

    def test_agent_count_requires_the_layout_to_end_with_underscore_four(self):
        f = self.mod.agent_count_of
        assert f("2_forced_hard_4") == 4
        assert f("2_incentivized_hard_4") == 4
        assert f("2_forced_hard") == 2
        # A stray 4 anywhere else must not promote the map to 4 agents.
        assert f("2_forced_hard_seed4_4020000_40") == 2
        assert f("4_forced_hard") == 2

    def test_policy_from_layout_name(self):
        assert self.mod.policy_of("2_forced_hard_4") == "forced"
        assert self.mod.policy_of("2_incentivized_hard") == "incentivized"

    def test_group_normalisation(self):
        f = self.mod.norm_group
        assert f("Low") == "low" and f("LOW") == "low"
        assert f("Mid") == "mid" and f("Middle") == "mid"
        assert f("High") == "high"

    def test_text_normalisation_is_cosmetic_only(self):
        f = self.mod.norm_text
        assert f("  The  robot’s  fine.\n") == f("The robot's fine.")
        assert f(None) == ""
        assert f("A") != f("B")


class TestDuplicateJoinOccurrence:
    """Byte-identical feedback submitted twice must join 1:1, not fan out."""

    @classmethod
    def setup_class(cls):
        cls.mod = _load_build_module()

    def _frames(self):
        import pandas as pd
        rows = [
            # same participant, trajectory, text and score, submitted twice
            {"pid": "P1", "traj": "t.json", "txt": "same text", "sentiment": 4,
             "json_order": 0, "doc_id": "d0", "performance_group": "low"},
            {"pid": "P1", "traj": "t.json", "txt": "same text", "sentiment": 4,
             "json_order": 1, "doc_id": "d1", "performance_group": "low"},
            {"pid": "P1", "traj": "t.json", "txt": "other", "sentiment": 2,
             "json_order": 2, "doc_id": "d2", "performance_group": "low"},
        ]
        J = pd.DataFrame(rows)
        J["traj_id"] = "dir/" + J["traj"]
        J = J.sort_values(["pid", "traj_id", "json_order"], kind="mergesort")
        J["occ"] = J.groupby(["pid", "traj", "txt", "sentiment"]).cumcount()

        X = pd.DataFrame([
            {"pid": "P1", "traj": "t.json", "txt": "same text", "sentiment": 4,
             "excel_row": 0, "excel_group": "low", "d1_codes": "1.1.1"},
            {"pid": "P1", "traj": "t.json", "txt": "same text", "sentiment": 4,
             "excel_row": 1, "excel_group": "low", "d1_codes": "1.2"},
            {"pid": "P1", "traj": "t.json", "txt": "other", "sentiment": 2,
             "excel_row": 2, "excel_group": "low", "d1_codes": "1.3"},
        ])
        X["occ"] = X.groupby(["pid", "traj", "txt", "sentiment"]).cumcount()
        return J, X

    def test_occurrence_index_pairs_rows_one_to_one(self):
        J, X = self._frames()
        both, report = self.mod.join_sources(J, X)
        assert report["joined_rows"] == 3
        assert report["unmatched_rows"] == 0
        assert report["duplicate_key_groups"] == 1
        assert report["duplicate_key_extra_occurrences"] == 1
        # Without the occurrence index this join would be a 2x2 fan-out (4 rows).
        assert len(both) == 3

    def test_json_array_order_and_excel_row_order_are_preserved(self):
        J, X = self._frames()
        both, _ = self.mod.join_sources(J, X)
        dup = both[both["txt"] == "same text"].sort_values("occ")
        assert dup["doc_id"].tolist() == ["d0", "d1"]
        assert dup["excel_row"].tolist() == [0, 1]
        assert dup["d1_codes"].tolist() == ["1.1.1", "1.2"]


# ------------------------------------------------------- built artefacts -----

def _artefacts():
    import json
    import gzip
    import pandas as pd
    maps = os.path.join(ROOT, "data", "divergence_maps.parquet")
    detail = os.path.join(ROOT, "data", "divergence_detail.json.gz")
    report = os.path.join(ROOT, "data", "divergence_report.json")
    if not all(os.path.exists(p) for p in (maps, detail, report)):
        pytest.skip("run  python 05_divergence.py  first")
    with gzip.open(detail, "rt", encoding="utf-8") as fh:
        det = json.load(fh)
    with open(report) as fh:
        rep = json.load(fh)
    return pd.read_parquet(maps), det, rep


class TestBuiltArtefacts:

    @classmethod
    def setup_class(cls):
        cls.M, cls.detail, cls.report = _artefacts()

    def test_every_score_is_finite_and_in_the_unit_interval(self):
        for metric in dv.METRICS:
            col = self.M[metric]
            assert col.notna().all(), "%s has missing values" % metric
            assert (col >= 0).all() and (col <= 1).all(), \
                "%s outside [0,1]" % metric
        for metric in ("cotc_raw", "tjac_raw"):
            col = self.M[metric]
            assert col.notna().all()
            assert (col >= 0).all() and (col <= 1).all()

    def test_per_dimension_scores_are_in_range_or_absent(self):
        for d in dv.DIMS:
            for col in ("smid_d%d" % d, "jsd_d%d" % d):
                vals = self.M[col].dropna()
                assert (vals >= 0).all() and (vals <= 1).all()

    def test_divergence_is_one_minus_raw_for_the_temporal_metrics(self):
        import numpy as np
        assert np.allclose(self.M["cotc"], 1.0 - self.M["cotc_raw"])
        assert np.allclose(self.M["tjac"], 1.0 - self.M["tjac_raw"])

    def test_expected_corpus_shape(self):
        exp = self.report["expected"]
        j, join = self.report["json_source"], self.report["join"]
        assert j["participants"] == exp["participants"]
        assert j["episode_observations"] == exp["episode_observations"]
        assert j["trajectories"] == exp["trajectories"]
        assert j["feedback_items"] == exp["feedback_items"]
        assert j["ranged_items"] == exp["ranged_items"]
        assert j["range_free_items"] == exp["range_free_items"]
        assert join["joined_rows"] == exp["labeled_rows_joined"]
        assert join["unmatched_rows"] == exp["unmatched_rows"]
        assert self.M["traj_id"].nunique() == exp["trajectories"]

    def test_all_eight_observers_stay_assigned_in_every_mode(self):
        assert (self.M["n_assigned_observers"] == 8).all()
        # Primary mode legitimately has fewer *active* observers, and that gap
        # must be visible rather than papered over.
        assert self.M.loc[self.M["mode"] == "primary",
                          "n_active_observers"].min() < 8

    def test_pair_counts_never_exceed_their_ceilings(self):
        assert (self.M["tjac_valid_pairs"] <= 28).all()
        assert (self.M["jsd_valid_pairs"] <= 28).all()
        assert (self.M["smid_matched_directed_pairs"] <= 56).all()
        assert (self.M["tjac_pairs"] == 28).all()
        assert (self.M["smid_directed_pairs"] == 56).all()

    def test_bands_are_global_tertiles_not_refit_per_filter(self):
        for metric in dv.METRICS:
            for mode in dv.MODES:
                sub = self.M[self.M["mode"] == mode]
                q33, q67 = self.report["band_thresholds"][metric][mode]
                for _, row in sub.iterrows():
                    assert row["%s_band" % metric] == dv.band_of(
                        row[metric], (q33, q67))
                counts = sub["%s_band" % metric].value_counts()
                # 108 maps split at the tertiles: ~36 per band.
                assert all(30 <= n <= 42 for n in counts)

    def test_frame_duration_provenance_is_recorded(self):
        cfg = self.report["config"]
        assert cfg["frame_duration_sec"] == 0.42
        assert cfg["sensitivity_half_width_frames"] == 5
        assert cfg["trajectory_frame_counts"] == {"201": 108}

    def test_detail_covers_every_map_and_mode(self):
        assert len(self.detail) == 108
        for traj_id, modes in self.detail.items():
            assert set(modes) == set(dv.MODES)
            for mode, d in modes.items():
                assert len(d["observers"]) == 8
                assert [o["observer"] for o in d["observers"]] == \
                    ["O%d" % i for i in range(1, 9)]

    def test_cotc_item_scores_in_the_detail_are_k_over_seven(self):
        allowed = {round(k / 7.0, 12) for k in range(8)}
        for modes in self.detail.values():
            for d in modes.values():
                for rec in d["cotc"]["per_item"]:
                    assert rec["denominator"] == 7
                    assert 0 <= rec["covered"] <= 7
                    assert round(rec["score"], 12) in allowed
                    assert len(rec["matched_peers"]) == rec["covered"]

    def test_cotc_matched_peers_really_cover_the_anchor(self):
        for modes in self.detail.values():
            for d in modes.values():
                timelines = {o["observer"]: [tuple(iv) for iv in o["timeline"]]
                             for o in d["observers"]}
                for rec in d["cotc"]["per_item"]:
                    for peer in rec["matched_peers"]:
                        assert dv.timeline_contains(timelines[peer],
                                                    rec["base_frame"])
                        assert rec["peer_intervals"][peer]

    def test_observer_timelines_are_merged_and_within_the_trajectory(self):
        for modes in self.detail.values():
            for d in modes.values():
                for o in d["observers"]:
                    tl = [tuple(iv) for iv in o["timeline"]]
                    assert tl == dv.merge_intervals(tl)     # already canonical
                    for s, e in tl:
                        assert 0 <= s <= e <= 200

    def test_temporal_pair_arithmetic_matches_the_stored_timelines(self):
        for modes in self.detail.values():
            for d in modes.values():
                tl = {o["observer"]: [tuple(iv) for iv in o["timeline"]]
                      for o in d["observers"]}
                for p in d["tjac"]["pairs"]:
                    a, b = tl[p["a"]], tl[p["b"]]
                    assert p["intersection"] == dv.intersection_frames(a, b)
                    assert p["union"] == dv.union_frames(a, b)
                    if p["score"] is not None:
                        assert p["score"] == pytest.approx(
                            p["intersection"] / p["union"])

    def test_map_scores_recompute_exactly_from_the_stored_detail(self):
        """End-to-end: every stored map score must fall back out of the pure
        functions when fed only the detail file. Catches any drift between the
        build's aggregation and divergence.py."""
        import numpy as np
        for mode in dv.MODES:
            M = self.M[self.M["mode"] == mode].set_index("traj_id")
            for traj_id, r in M.iterrows():
                d = self.detail[traj_id][mode]
                tl = {o["observer"]: [tuple(iv) for iv in o["timeline"]]
                      for o in d["observers"]}
                anchors = {o: [] for o in tl}
                for rec in d["cotc"]["per_item"]:
                    anchors[rec["observer"]].append(
                        {"key": rec["key"], "base_frame": rec["base_frame"]})
                items = {o: [] for o in tl}
                for it in d["items"]:
                    items[it["observer"]].append(
                        {"key": it["key"], "base_frame": it["base_frame"],
                         "start": it["start"], "end": it["end"],
                         "index": it["index"], "doc_id": it["doc_id"],
                         "codes": {int(k): v for k, v in it["codes"].items()}})
                profiles = {o: {int(k): v for k, v in p.items()}
                            for o, p in d["jsd"]["profiles"].items()}
                got = {
                    "cotc": dv.cotc_map(anchors, tl)["divergence"],
                    "tjac": dv.temporal_jaccard_map(tl)["divergence"],
                    "smid": dv.smid_map(items)["score"],
                    "jsd": dv.profile_jsd_map(profiles)["score"],
                }
                for metric, value in got.items():
                    assert np.isclose(value, r[metric], atol=1e-12), \
                        "%s %s %s" % (mode, traj_id, metric)

    def test_sensitivity_mode_only_adds_items(self):
        prim = self.M[self.M["mode"] == "primary"].set_index("traj_id")
        sens = self.M[self.M["mode"] == "sensitivity"].set_index("traj_id")
        assert (sens["n_items_used"] >= prim["n_items_used"]).all()
        assert (sens["n_active_observers"] >= prim["n_active_observers"]).all()
        # Derived windows appear only in sensitivity mode.
        for traj_id, modes in self.detail.items():
            assert not any(it["derived_range"]
                           for it in modes["primary"]["items"])
            n_derived = sum(1 for it in modes["sensitivity"]["items"]
                            if it["derived_range"])
            assert n_derived == int(prim.loc[traj_id, "n_range_free_items"])


class TestFilteredSelectorAgreement:
    """The distribution and the detail drawer must see one trajectory set."""

    @classmethod
    def setup_class(cls):
        try:
            from data_access import STORE
        except Exception as exc:                     # pragma: no cover
            pytest.skip("data_access unavailable: %s" % exc)
        cls.STORE = STORE
        if not STORE.has_divergence:
            pytest.skip("run  python 05_divergence.py  first")

    def _ids(self, **kw):
        opts = dict(sel_codes={}, groups=[], score_range=[1, 5], valences=[],
                    regimes=[], trajs=[], buckets=[], confident_only=False,
                    keyword=None, within_dim_and=False, agents=[])
        opts.update(kw)
        mask = self.STORE.filter_mask(**opts)
        return self.STORE.df.loc[mask, "id"].astype(int).tolist()

    def test_unfiltered_selection_covers_every_map(self):
        for mode in dv.MODES:
            view = self.STORE.divergence_view(self._ids(), mode)
            assert len(view) == 108

    def test_distribution_and_detail_use_the_same_trajectory_set(self):
        cases = [dict(groups=["low"]), dict(regimes=["forced"]),
                 dict(agents=[4]), dict(groups=["high"], agents=[2]),
                 dict(sel_codes={5: ["5.3"]}), dict(keyword="waiting")]
        for case in cases:
            ids = self._ids(**case)
            expected = set(self.STORE.df.loc[
                self.STORE.df["id"].isin(ids), "traj"])
            for mode in dv.MODES:
                view = self.STORE.divergence_view(ids, mode)
                assert set(view["traj"]) == expected, case
                # Every displayed point can open a detail drawer.
                for traj_id in view["traj_id"]:
                    assert self.STORE.divergence_detail(traj_id, mode) is not None

    def test_agent_count_filter_splits_the_corpus_two_ways(self):
        two = self.STORE.divergence_view(self._ids(agents=[2]), "primary")
        four = self.STORE.divergence_view(self._ids(agents=[4]), "primary")
        assert len(two) == 54 and len(four) == 54
        assert set(two["agent_count"]) == {2}
        assert set(four["agent_count"]) == {4}

    def test_filtering_never_moves_a_score_or_a_threshold(self):
        full = self.STORE.divergence_view(self._ids(), "primary").set_index("traj_id")
        narrow = self.STORE.divergence_view(
            self._ids(groups=["low"]), "primary").set_index("traj_id")
        for traj_id in narrow.index:
            for metric in dv.METRICS:
                assert narrow.loc[traj_id, metric] == full.loc[traj_id, metric]
                assert narrow.loc[traj_id, "%s_band" % metric] == \
                    full.loc[traj_id, "%s_band" % metric]

    def test_empty_selection_yields_an_empty_view_not_an_error(self):
        view = self.STORE.divergence_view([], "primary")
        assert len(view) == 0
