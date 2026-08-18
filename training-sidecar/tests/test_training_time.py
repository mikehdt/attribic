"""Tests for training-time marker placement and carry-forward.

Marker layout is policy-driven (`record_time_markers(policy=...)`), not a
provider-name check — see `training_time.py`'s module docstring and
`providers/base.py`'s `time_marker_policy`. These tests exercise both
policies directly (bypassing the provider layer) plus the provider-name
fallback map used by the job-manager's lazy accumulator reseed.
"""

import json
from pathlib import Path

from job_manager import _MAX_TRAINING_GAP_SECONDS, _training_gap_contribution
from training_time import (
    MARKER_NAME,
    PROVIDER_MARKER_POLICY_FALLBACK,
    marker_policy_for_provider_name,
    read_carryforward_seconds,
    record_time_markers,
)


# --------------------------------------------------------------------------
# "per-state-dir" policy (kohya / sd-scripts lineage)


def test_per_state_dir_writes_marker_into_each_new_state_dir(tmp_path: Path):
    output_name = "my-lora"
    state_dir = tmp_path / f"{output_name}-step00000100-state"
    state_dir.mkdir()

    record_time_markers(
        policy="per-state-dir",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=42.5,
        step=100,
        job_id="job-1",
    )

    marker_path = state_dir / MARKER_NAME
    assert marker_path.exists()
    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    assert payload["training_seconds"] == 42.5
    assert payload["step"] == 100
    assert payload["job_id"] == "job-1"


def test_per_state_dir_uses_ledger_value_for_step_encoded_in_dir_name(
    tmp_path: Path,
):
    """A state dir found on a later scan gets the seconds for its own step,
    not the current (by-then larger) total."""
    output_name = "my-lora"
    state_dir = tmp_path / f"{output_name}-step00000100-state"
    state_dir.mkdir()

    record_time_markers(
        policy="per-state-dir",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=99.0,  # current total, larger than at step 100
        step=200,
        job_id="job-1",
        seconds_by_step={100: 42.5},
    )

    payload = json.loads((state_dir / MARKER_NAME).read_text(encoding="utf-8"))
    assert payload["training_seconds"] == 42.5
    assert payload["step"] == 100


def test_per_state_dir_does_not_overwrite_existing_marker(tmp_path: Path):
    output_name = "my-lora"
    state_dir = tmp_path / f"{output_name}-step00000100-state"
    state_dir.mkdir()
    marker_path = state_dir / MARKER_NAME
    marker_path.write_text(
        json.dumps({"training_seconds": 1.0, "step": 100, "job_id": "old"}),
        encoding="utf-8",
    )

    record_time_markers(
        policy="per-state-dir",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=500.0,
        step=100,
        job_id="job-2",
    )

    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    assert payload["training_seconds"] == 1.0
    assert payload["job_id"] == "old"


def test_per_state_dir_ignores_unrelated_dirs(tmp_path: Path):
    output_name = "my-lora"
    (tmp_path / "some-other-dir").mkdir()
    (tmp_path / f"{output_name}-step00000100-notstate").mkdir()

    # No matching *-state dir — should not raise, and no marker anywhere.
    record_time_markers(
        policy="per-state-dir",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=42.5,
        step=100,
        job_id="job-1",
    )

    assert not any(tmp_path.rglob(MARKER_NAME))


def test_per_state_dir_carryforward_reads_marker_from_state_dir(tmp_path: Path):
    output_name = "my-lora"
    state_dir = tmp_path / f"{output_name}-step00000100-state"
    state_dir.mkdir()
    record_time_markers(
        policy="per-state-dir",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=42.5,
        step=100,
        job_id="job-1",
    )

    # Resume path may point at the dir itself, or a file inside it.
    assert read_carryforward_seconds(str(state_dir)) == 42.5
    ckpt_file = state_dir / "checkpoint.pt"
    ckpt_file.write_text("x", encoding="utf-8")
    assert read_carryforward_seconds(str(ckpt_file)) == 42.5


# --------------------------------------------------------------------------
# "single-root" policy (ai-toolkit)


def test_single_root_writes_one_marker_in_save_root(tmp_path: Path):
    output_name = "my-lora"
    save_root = tmp_path / output_name
    save_root.mkdir()

    record_time_markers(
        policy="single-root",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=17.0,
        step=50,
        job_id="job-1",
    )

    marker_path = save_root / MARKER_NAME
    assert marker_path.exists()
    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    assert payload["training_seconds"] == 17.0
    assert payload["step"] == 50


def test_single_root_overwrites_existing_marker(tmp_path: Path):
    output_name = "my-lora"
    save_root = tmp_path / output_name
    save_root.mkdir()

    record_time_markers(
        policy="single-root",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=17.0,
        step=50,
        job_id="job-1",
    )
    record_time_markers(
        policy="single-root",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=99.0,
        step=150,
        job_id="job-1",
    )

    payload = json.loads(
        (save_root / MARKER_NAME).read_text(encoding="utf-8")
    )
    assert payload["training_seconds"] == 99.0
    assert payload["step"] == 150


def test_single_root_no_op_when_save_root_missing(tmp_path: Path):
    # save_root never created — should not raise, no marker written anywhere.
    record_time_markers(
        policy="single-root",
        output_path=str(tmp_path),
        output_name="my-lora",
        training_seconds=17.0,
        step=50,
        job_id="job-1",
    )
    assert not any(tmp_path.rglob(MARKER_NAME))


def test_single_root_carryforward_reads_marker_from_save_root(tmp_path: Path):
    output_name = "my-lora"
    save_root = tmp_path / output_name
    save_root.mkdir()
    record_time_markers(
        policy="single-root",
        output_path=str(tmp_path),
        output_name=output_name,
        training_seconds=17.0,
        step=50,
        job_id="job-1",
    )

    assert read_carryforward_seconds(str(save_root)) == 17.0


# --------------------------------------------------------------------------
# Carry-forward edge cases shared by both policies


def test_carryforward_returns_zero_when_no_resume_state():
    assert read_carryforward_seconds(None) == 0.0
    assert read_carryforward_seconds("") == 0.0


def test_carryforward_returns_zero_when_marker_missing(tmp_path: Path):
    empty_dir = tmp_path / "no-marker-here"
    empty_dir.mkdir()
    assert read_carryforward_seconds(str(empty_dir)) == 0.0


# --------------------------------------------------------------------------
# Provider-name -> policy fallback map (used by the lazy accumulator reseed)


def test_marker_policy_fallback_map_matches_provider_defaults():
    assert PROVIDER_MARKER_POLICY_FALLBACK["kohya"] == "per-state-dir"
    assert PROVIDER_MARKER_POLICY_FALLBACK["musubi"] == "per-state-dir"


def test_marker_policy_for_provider_name_known_and_unknown():
    assert marker_policy_for_provider_name("kohya") == "per-state-dir"
    assert marker_policy_for_provider_name("musubi") == "per-state-dir"
    # ai-toolkit isn't in the fallback map — it lands on the same default
    # as TrainingProvider.time_marker_policy itself.
    assert marker_policy_for_provider_name("ai-toolkit") == "single-root"
    assert marker_policy_for_provider_name("mock") == "single-root"
    assert marker_policy_for_provider_name("unknown-future-backend") == (
        "single-root"
    )


# --------------------------------------------------------------------------
# Per-gap clamping of the training clock (job_manager._training_gap_contribution)
#
# `_accumulate_progress` sums these per-tick contributions into
# `training_seconds`. A gap under the cap should count in full (a legitimate
# between-step pause is still training); a gap over the cap must be clamped
# to the cap, not dropped to zero — dropping would zero out the whole clock
# on a run whose steps are individually slower than the cap (see the
# _MAX_TRAINING_GAP_SECONDS comment in job_manager.py for the ai-toolkit
# low-VRAM case this guards against).


def test_gap_under_cap_counts_in_full():
    assert _training_gap_contribution(1.0) == 1.0
    assert _training_gap_contribution(90.0) == 90.0
    assert _training_gap_contribution(_MAX_TRAINING_GAP_SECONDS) == (
        _MAX_TRAINING_GAP_SECONDS
    )


def test_gap_over_cap_is_clamped_not_dropped():
    over = _MAX_TRAINING_GAP_SECONDS + 60.0
    assert _training_gap_contribution(over) == _MAX_TRAINING_GAP_SECONDS


def test_gap_far_over_cap_still_contributes_only_the_cap():
    # A multi-hour suspend/background gap must not inflate the clock any
    # further than a merely-slow step would.
    huge = _MAX_TRAINING_GAP_SECONDS * 1000
    assert _training_gap_contribution(huge) == _MAX_TRAINING_GAP_SECONDS


def test_zero_or_negative_gap_contributes_nothing():
    # Duplicate tick at the same monotonic timestamp, or a clock jump
    # backwards — neither is a real elapsed gap to attribute.
    assert _training_gap_contribution(0.0) == 0.0
    assert _training_gap_contribution(-5.0) == 0.0
