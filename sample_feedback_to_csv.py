#!/usr/bin/env python3
"""Randomly sample feedback from Low/Mid/High JSON files into one CSV."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = SCRIPT_DIR / "analysis" / "dashboard" / "data"
DEFAULT_INPUTS = {
    "low": DEFAULT_DATA_DIR / "main-low.json",
    "mid": DEFAULT_DATA_DIR / "main-mid.json",
    "high": DEFAULT_DATA_DIR / "main-high.json",
}
DEFAULT_CODEBOOK_OUTPUT = DEFAULT_DATA_DIR / "initial-codebook.json"
CSV_COLUMNS = ["participant_id", "trajectory_name", "feedback", "group"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Low/Mid/High JSON 각각에서 피드백을 지정 비율만큼 랜덤 샘플링해 "
            "하나의 CSV로 저장합니다."
        )
    )
    parser.add_argument(
        "--ratio",
        type=float,
        default=0.10,
        help="그룹별 샘플링 비율 (기본값: 0.10)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="재현 가능한 랜덤 샘플을 위한 시드 (기본값: 42)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=SCRIPT_DIR / "feedback_sample_10pct.csv",
        help="출력 CSV 경로 (기본값: bci_interface/feedback_sample_10pct.csv)",
    )
    parser.add_argument(
        "--codebook-output",
        type=Path,
        default=DEFAULT_CODEBOOK_OUTPUT,
        help=(
            "Initial Codebook JSON 출력 경로 "
            "(기본값: analysis/dashboard/data/initial-codebook.json)"
        ),
    )
    parser.add_argument("--low", type=Path, default=DEFAULT_INPUTS["low"])
    parser.add_argument("--mid", type=Path, default=DEFAULT_INPUTS["mid"])
    parser.add_argument("--high", type=Path, default=DEFAULT_INPUTS["high"])
    args = parser.parse_args()

    if not 0 < args.ratio <= 1:
        parser.error("--ratio는 0보다 크고 1 이하여야 합니다.")
    return args


def load_feedback_rows(json_path: Path, fallback_group: str) -> list[dict[str, Any]]:
    try:
        with json_path.open(encoding="utf-8") as file:
            participants: Any = json.load(file)
    except FileNotFoundError as exc:
        raise SystemExit(f"입력 파일을 찾을 수 없습니다: {json_path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"올바른 JSON 파일이 아닙니다: {json_path} ({exc})") from exc

    if not isinstance(participants, dict):
        raise SystemExit(f"JSON 최상위 값은 participant 객체여야 합니다: {json_path}")

    rows: list[dict[str, Any]] = []
    for participant_key, participant in participants.items():
        if not isinstance(participant, dict):
            continue

        participant_id = str(participant.get("id") or participant_key)
        group = str(participant.get("group") or fallback_group).strip().lower()
        if group == "middle":
            group = "mid"

        episodes = participant.get("episodes") or []
        if not isinstance(episodes, list):
            continue

        for episode in episodes:
            if not isinstance(episode, dict):
                continue
            trajectory_path = str(episode.get("fileName") or episode.get("docId") or "")
            # Store only the JSON filename, not its parent directories.
            trajectory_name = Path(trajectory_path.replace("\\", "/")).name
            feedback_items = episode.get("feedbackItems") or []
            if not isinstance(feedback_items, list):
                continue

            for item in feedback_items:
                if not isinstance(item, dict):
                    continue
                feedback = item.get("feedback")
                if feedback is None:
                    continue
                feedback_item_id = str(item.get("docId") or "")
                if not feedback_item_id:
                    raise SystemExit(
                        "Initial Codebook에 사용할 feedback docId가 없습니다: "
                        f"{participant_id} / {trajectory_name}"
                    )
                rows.append(
                    {
                        "participant_id": participant_id,
                        "trajectory_name": trajectory_name,
                        "feedback": str(feedback),
                        "group": group,
                        "_replay": {
                            "trajectoryPath": trajectory_path.replace("\\", "/"),
                            "episodeId": str(episode.get("docId") or ""),
                            "feedbackId": feedback_item_id,
                            "layoutName": str(episode.get("layoutName") or ""),
                            "itemIndex": item.get("index"),
                            "baseFrame": item.get("baseFrame"),
                            "startFrame": item.get("startFrame"),
                            "endFrame": item.get("endFrame"),
                            "sentiment": item.get("sentiment"),
                            "reason": str(item.get("reason") or item.get("correction") or ""),
                        },
                    }
                )
    return rows


def sample_size(total: int, ratio: float) -> int:
    """Round to the nearest item, while keeping one item for a non-empty group."""
    if total == 0:
        return 0
    return max(1, min(total, math.floor(total * ratio + 0.5)))


def write_initial_codebook(
    sampled_rows: list[dict[str, Any]],
    csv_path: Path,
    codebook_path: Path,
    ratio: float,
    seed: int,
    group_counts: dict[str, dict[str, int]],
) -> None:
    """Write the replay-enriched, blank-KY annotation dataset for the dashboard."""
    sample_ids = [row["_replay"]["feedbackId"] for row in sampled_rows]
    if len(sample_ids) != len(set(sample_ids)):
        raise SystemExit("Initial Codebook sampleId가 중복됩니다.")

    source_sha256 = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    items = []
    for csv_row, row in enumerate(sampled_rows):
        csv_values = {column: row[column] for column in CSV_COLUMNS}
        replay = dict(row["_replay"])
        items.append(
            {
                "sampleId": replay["feedbackId"],
                "csvRow": csv_row,
                "csv": csv_values,
                "replay": replay,
                "KY": "",
            }
        )

    codebook = {
        "schemaVersion": 1,
        "title": "Initial Codebook",
        "datasetId": source_sha256,
        "source": {
            "file": csv_path.name,
            "sha256": source_sha256,
            "encoding": "utf-8-sig",
            "rowCount": len(sampled_rows),
            "columns": CSV_COLUMNS,
            "sampling": {
                "ratio": ratio,
                "seed": seed,
                "groups": group_counts,
            },
        },
        "annotation": {
            "annotator": "KY",
            "column": "KY",
            "draftStorage": "browser-localStorage",
        },
        "items": items,
    }

    codebook_path.parent.mkdir(parents=True, exist_ok=True)
    with codebook_path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(codebook, file, ensure_ascii=False, indent=2)
        file.write("\n")


def main() -> None:
    args = parse_args()
    input_paths = {"low": args.low, "mid": args.mid, "high": args.high}
    rng = random.Random(args.seed)
    sampled_rows: list[dict[str, Any]] = []
    group_counts: dict[str, dict[str, int]] = {}

    for group, json_path in input_paths.items():
        rows = load_feedback_rows(json_path, group)
        count = sample_size(len(rows), args.ratio)
        sampled_rows.extend(rng.sample(rows, count))
        group_counts[group] = {"available": len(rows), "sampled": count}
        print(f"{group}: {len(rows)}개 중 {count}개 샘플링")

    # Avoid grouping rows by label in the output while retaining deterministic results.
    rng.shuffle(sampled_rows)
    output_path = args.output.expanduser().resolve()
    codebook_path = args.codebook_output.expanduser().resolve()
    if output_path == codebook_path:
        raise SystemExit("CSV와 Initial Codebook 출력 경로는 서로 달라야 합니다.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=CSV_COLUMNS,
        )
        writer.writeheader()
        writer.writerows(
            {column: row[column] for column in CSV_COLUMNS}
            for row in sampled_rows
        )

    write_initial_codebook(
        sampled_rows,
        output_path,
        codebook_path,
        args.ratio,
        args.seed,
        group_counts,
    )

    print(f"총 {len(sampled_rows)}개를 저장했습니다: {output_path}")
    print(f"Initial Codebook을 저장했습니다: {codebook_path}")


if __name__ == "__main__":
    main()
