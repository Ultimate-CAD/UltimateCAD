#!/usr/bin/env python3
"""Summarize the OpenVDB offset experiment artifacts without running validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EXPERIMENT_DIR = ROOT / ".codex-run" / "sparse14-offset"
BASELINE_MS = 23798.8272
BASELINE_RSS_BYTES = 1076408320
LABELS = (
    "dilate-010", "offset-010",
    "dilate-0075", "offset-0075",
    "dilate-005", "offset-005",
    "dilate-002", "offset-002",
)


def read_json(path: Path) -> tuple[dict[str, Any] | None, str]:
    if not path.is_file():
        return None, "not-run"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"invalid-report: {exc}"
    if not isinstance(value, dict):
        return None, "invalid-report: expected JSON object"
    return value, "present"


def status_for(path: Path, data: dict[str, Any] | None, predicate: bool) -> str:
    if data is None:
        return "not-run" if not path.exists() else "invalid-report"
    return "pass" if predicate else "fail-or-incomplete"


def summarize(label: str) -> dict[str, Any]:
    folder = EXPERIMENT_DIR / label
    stats, stats_read = read_json(folder / "stats.json")
    results, results_read = read_json(folder / "results.json")
    if stats is None and results is not None and isinstance(results.get("stats"), dict):
        stats = results["stats"]
        stats_read = "embedded-in-results"

    stages = stats.get("stages", []) if stats else []
    if not stages:
        stages_path = folder / "stages.jsonl"
        if stages_path.is_file():
            stages = []
            for line in stages_path.read_text(encoding="utf-8").splitlines():
                try:
                    item = json.loads(line)
                    if isinstance(item, dict):
                        stages.append(item)
                except json.JSONDecodeError:
                    continue

    completed_timings: dict[str, float] = {}
    active_voxels: dict[str, int] = {}
    stage_peak_rss = 0
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        phase = stage.get("phase")
        if not isinstance(phase, str):
            continue
        if stage.get("complete") is True and isinstance(stage.get("durationMs"), (int, float)):
            completed_timings[phase] = float(stage["durationMs"])
        if isinstance(stage.get("activeVoxels"), int):
            active_voxels[phase] = stage["activeVoxels"]
        if isinstance(stage.get("peakRssBytes"), int):
            stage_peak_rss = max(stage_peak_rss, stage["peakRssBytes"])

    independent_path = folder / "independent-accuracy.json"
    manufacturing_path = folder / "manufacturing" / "final" / "dense-manufacturing-qa.json"
    cgal_path = folder / "cgal-final.json"
    exterior_path = folder / "exterior.json"
    independent, independent_read = read_json(independent_path)
    manufacturing, manufacturing_read = read_json(manufacturing_path)
    cgal, cgal_read = read_json(cgal_path)
    exterior, exterior_read = read_json(exterior_path)

    raw_audit = manufacturing.get("rawTopologyAudit") if manufacturing else None
    surface_checks = manufacturing.get("surfaceChecks") if manufacturing else None
    self_intersections = surface_checks.get("selfIntersections") if isinstance(surface_checks, dict) else None
    cgal_ok = bool(cgal and cgal.get("complete") is True and str(cgal.get("status", "")).lower() == "valid")
    exterior_count = None
    if exterior:
        exterior_count = exterior.get("missingOrChanged")
        if exterior_count is None:
            exterior_count = exterior.get("missingOrChangedExteriorTriangles")
    exterior_ok = isinstance(exterior_count, (int, float)) and exterior_count == 0
    independent_ok = bool(independent and independent.get("boundedAccuracyPass") is True)
    accuracy_ok = bool(stats and stats.get("accuracyPass") is True)
    raw_ok = isinstance(raw_audit, dict) and raw_audit.get("valid") is True
    intersections_ok = (
        isinstance(self_intersections, dict)
        and self_intersections.get("complete") is True
        and self_intersections.get("found") == 0
    )
    geometry_validated = all((accuracy_ok, independent_ok, raw_ok, intersections_ok, cgal_ok, exterior_ok))

    validation = {
        "nativeAccuracy": (
            "not-run" if stats is None and not (folder / "stats.json").exists()
            else "invalid-report" if stats is None
            else "pass" if accuracy_ok
            else "fail-or-incomplete"
        ),
        "independentBoundedAccuracy": status_for(independent_path, independent, independent_ok),
        "finalRawTopologyAudit": status_for(manufacturing_path, manufacturing, raw_ok),
        "finalSelfIntersections": status_for(
            manufacturing_path,
            manufacturing,
            intersections_ok,
        ),
        "cgal": status_for(cgal_path, cgal, cgal_ok),
        "exteriorPreservation": status_for(exterior_path, exterior, exterior_ok),
    }
    duration_ms = stats.get("durationMs") if stats else None
    peak_rss = stats.get("peakRssBytes") if stats else None
    termination_memory = (results or {}).get("memoryBeforeTermination") or {}
    peak_scope = "completed native run" if peak_rss is not None else "last stage: lower bound only"
    if peak_rss is None:
        peak_rss = termination_memory.get("peakRssBytes", stage_peak_rss or None)
        if termination_memory.get("peakRssBytes"):
            peak_scope = "sampled immediately before termination"
    if isinstance(peak_rss, int):
        peak_rss = max(peak_rss, stage_peak_rss)
    ratio = BASELINE_MS / duration_ms if isinstance(duration_ms, (int, float)) and duration_ms > 0 else None
    raw_cavity = {
        "path": str(folder / "cavity-raw.mesh.bin"),
        "present": (folder / "cavity-raw.mesh.bin").is_file(),
        "bytes": (folder / "cavity-raw.mesh.bin").stat().st_size if (folder / "cavity-raw.mesh.bin").is_file() else None,
        "rawTopologyAudit": raw_audit,
    }

    if not folder.exists():
        run_status = "not-run"
    elif results and isinstance(results.get("status"), str):
        run_status = results["status"]
    elif stats and isinstance(stats.get("status"), str):
        run_status = stats["status"]
    else:
        run_status = "pending"

    return {
        "label": label,
        "runStatus": run_status,
        "method": stats.get("method") if stats else (results or {}).get("method"),
        "pitchMm": stats.get("pitchMm") if stats else (results or {}).get("pitch"),
        "nativeDurationMs": duration_ms,
        "runnerDurationMs": (results or {}).get("durationMs"),
        "sampledOffsetErrorMm": (stats or {}).get("sampledOffsetErrorMm"),
        "worstSample": (stats or {}).get("worstSample"),
        "independentWholeTriangleErrorBoundMm": (independent or {}).get("wholeTriangleOffsetErrorUpperBoundMm"),
        "generationSpeedRatioVsNativeBaseline": ratio,
        "baselineNativeDurationMs": BASELINE_MS,
        "baselineNativePeakRssBytes": BASELINE_RSS_BYTES,
        "peakRssBytes": peak_rss,
        "peakRssScope": peak_scope,
        "activeVoxelsByStage": active_voxels,
        "stageTimingsMs": completed_timings,
        "validation": validation,
        "geometryValidated": geometry_validated,
        "rawCavityDiagnostic": raw_cavity,
        "manufacturingReady": (manufacturing or {}).get("ready"),
        "manufacturingReadyStatus": "source-report" if manufacturing else "not-assessed",
        "statsReadStatus": stats_read,
        "validationInputs": {
            "independentAccuracy": independent_read,
            "manufacturingFinal": manufacturing_read,
            "cgalFinal": cgal_read,
            "exterior": exterior_read,
        },
    }


def md_cell(value: Any) -> str:
    if value is None:
        return "pending/not-run"
    if isinstance(value, float):
        return f"{value:.4f}"
    return str(value).replace("|", "\\|").replace("\n", " ")


def render_table(records: list[dict[str, Any]], best: dict[str, Any] | None) -> str:
    lines = [
        "# OpenVDB offset experiment summary",
        "",
        f"Native baseline: {BASELINE_MS:.4f} ms; peak RSS {BASELINE_RSS_BYTES} bytes.",
        "Speed ratio uses native run duration only; it is not an end-to-end comparison.",
        "Missing validation is marked pending/not-run. Geometry validation does not imply print readiness.",
        "",
        "| Label | Method | Pitch (mm) | Run status | Geometry validated | Native ms | Speed ratio | Peak RSS (bytes) |",
        "|---|---|---:|---|---:|---:|---:|---:|",
    ]
    for record in records:
        lines.append(
            "| " + " | ".join(
                md_cell(record[key])
                for key in (
                    "label", "method", "pitchMm", "runStatus", "geometryValidated",
                    "nativeDurationMs", "generationSpeedRatioVsNativeBaseline", "peakRssBytes",
                )
            ) + " |"
        )
    lines.extend(["", f"Best fully geometry-validated run: {best['label'] if best else 'none'}", ""])
    return "\n".join(lines)


def main() -> None:
    records = [summarize(label) for label in LABELS]
    validated = [record for record in records if record["geometryValidated"]]
    best = max(validated, key=lambda item: item["generationSpeedRatioVsNativeBaseline"] or 0, default=None)
    output = {
        "experimentDirectory": str(EXPERIMENT_DIR),
        "baseline": {"nativeDurationMs": BASELINE_MS, "peakRssBytes": BASELINE_RSS_BYTES},
        "speedRatioScope": "baseline native duration divided by this run's native duration; not end-to-end",
        "records": records,
        "bestFullyGeometryValidated": best,
        "manufacturingReadinessClaim": None,
    }
    (EXPERIMENT_DIR / "summary.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    (EXPERIMENT_DIR / "table.md").write_text(render_table(records, best), encoding="utf-8")


if __name__ == "__main__":
    main()
