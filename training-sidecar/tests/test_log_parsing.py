"""Tests for the sd-scripts log parsing and training-loop state machine.

Two halves:

* the pure pieces (patterns, `_append_log_line`, the CLI/TOML helpers) driven
  both by synthetic lines and by `fixtures/kohya-log-tails.txt` — real captured
  output from runs on this machine, including bilingual prep lines and the
  shredded multi-worker lines that a rich-formatted logger produces;
* the state machine itself, driven end to end through a fake subprocess whose
  stdout/stderr we feed line by line.
"""

import asyncio
from pathlib import Path

import pytest

from models import DatasetEntry, JobStatus, ProviderType, StartJobRequest
from providers import sd_scripts_base
from providers.kohya import KohyaProvider
from providers.sd_scripts_base import (
    EPOCH_PATTERN,
    LOSS_PATTERN,
    RATE_PATTERN,
    SAMPLE_ANNOUNCE_PATTERN,
    SAMPLING_PHASE,
    TQDM_PATTERN,
    SubprocessRun,
    _append_log_line,
    _num,
    _parse_eta_seconds,
    _parse_kv_args,
    _parse_native_resolution,
    _prompt_line_has_flag,
    _sampling_phase,
    _toml_bool,
    _toml_str,
)

FIXTURE = Path(__file__).parent / "fixtures" / "kohya-log-tails.txt"


def fixture_lines() -> list[str]:
    """The captured log tails, minus the `=== job (status) ===` separators."""
    text = FIXTURE.read_text(encoding="utf-8")
    return [
        line
        for line in text.splitlines()
        if line.strip() and not line.startswith("===")
    ]


@pytest.fixture
def provider() -> KohyaProvider:
    # The path is only touched by validate_environment / _train_command, which
    # these tests don't call.
    return KohyaProvider("nonexistent-scripts-path")


# --------------------------------------------------------------------------
# Superseding a previous run under the same output name
# --------------------------------------------------------------------------


def _flux_request(
    tmp_path: Path, output_name: str = "demo", resume_state: str = None
) -> StartJobRequest:
    hp = {
        "model_paths": {
            "checkpoint": str(tmp_path / "flux1-dev.safetensors"),
            "clip_l": str(tmp_path / "clip_l.safetensors"),
            "t5": str(tmp_path / "t5xxl.safetensors"),
            "ae": str(tmp_path / "ae.safetensors"),
        },
    }
    if resume_state:
        hp["resume_state"] = resume_state
    return StartJobRequest(
        project_path=str(tmp_path),
        provider=ProviderType.KOHYA,
        base_model="flux-dev",
        output_path=str(tmp_path / "loras"),
        output_name=output_name,
        datasets=[DatasetEntry(path=str(tmp_path / "imgs"), num_repeats=1)],
        hyperparameters=hp,
    )


class TestMoveStaleRunFiles:
    """`_move_stale_run_files` / `_is_run_checkpoint` / `_is_run_state_dir`:
    the scan-and-move behind `SdScriptsProvider._supersede_previous_run` (see
    Finding 1 — kohya/musubi previously overwrote a finished run's weights
    outright on a reused output name, unlike ai-toolkit's own supersede)."""

    def test_moves_checkpoints_and_state_dirs(self, tmp_path):
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "demo.safetensors").write_bytes(b"final")
        (loras / "demo-000005.safetensors").write_bytes(b"epoch5")
        (loras / "demo-step00000250.safetensors").write_bytes(b"step250")
        (loras / "demo-state").mkdir()
        (loras / "demo-step00000250-state").mkdir()
        # A sibling run whose name is a prefix-extension of ours must survive
        # untouched — this is exactly the "demo" vs "demo-v2" collision the
        # suffix-shape check (_RUN_SUFFIX_RE) exists to avoid.
        (loras / "demo-v2.safetensors").write_bytes(b"other run")
        (loras / "demo-v2-state").mkdir()
        # Sample PNGs are timestamped and never collide — must be left alone.
        (loras / "sample").mkdir()
        (loras / "sample" / "demo_000250_00_20260101000000.png").write_bytes(b"x")

        scan = sd_scripts_base._move_stale_run_files(str(loras), "demo")

        assert scan.moved_ckpts == 3
        assert scan.moved_states == 2
        assert scan.failed == 0
        assert scan.dest == loras / "_superseded" / "demo"
        assert scan.real_names == ("demo",)
        for name in (
            "demo.safetensors",
            "demo-000005.safetensors",
            "demo-step00000250.safetensors",
        ):
            assert not (loras / name).exists()
            assert (scan.dest / name).exists()
        for name in ("demo-state", "demo-step00000250-state"):
            assert not (loras / name).exists()
            assert (scan.dest / name).is_dir()
        # Untouched: the sibling run and the sample PNG.
        assert (loras / "demo-v2.safetensors").exists()
        assert (loras / "demo-v2-state").is_dir()
        assert (
            loras / "sample" / "demo_000250_00_20260101000000.png"
        ).exists()

    def test_no_stale_files_is_a_noop(self, tmp_path):
        loras = tmp_path / "loras"
        loras.mkdir()
        scan = sd_scripts_base._move_stale_run_files(str(loras), "demo")
        assert scan == sd_scripts_base._SupersedeScan()

    def test_missing_output_dir_is_a_noop(self, tmp_path):
        scan = sd_scripts_base._move_stale_run_files(
            str(tmp_path / "does-not-exist"), "demo"
        )
        assert scan == sd_scripts_base._SupersedeScan()

    def test_repeated_supersede_gets_a_disambiguated_dir(self, tmp_path):
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "demo.safetensors").write_bytes(b"run one")
        sd_scripts_base._move_stale_run_files(str(loras), "demo")

        (loras / "demo.safetensors").write_bytes(b"run two")
        scan = sd_scripts_base._move_stale_run_files(str(loras), "demo")

        assert scan.dest == loras / "_superseded" / "demo-2"

    # --- Finding 1: case-variant output names on a case-insensitive host ---

    def test_matches_a_differently_cased_output_name(self, tmp_path):
        """The exact scenario from the review: a finished run "Demo" left
        Demo.safetensors/Demo-state behind, and a new run is launched as
        "demo". On NTFS those are the SAME path, so if this match were
        case-sensitive, `_move_stale_run_files` would report nothing stale
        and kohya's first checkpoint write would silently land on (and
        destroy) the old file. Reverting `_matched_run_name` to a bare `==`
        makes this fail: 0 moved instead of 1.

        Also plants "Demo-v2" alongside it — case-folding the comparison
        must not resurrect the prefix-collision bug `_RUN_SUFFIX_RE` exists
        to prevent ("demo" vs "demo-v2", see the module constant's docstring)
        just because case-folding is now in the mix too. A case-insensitive
        match implemented as a naive `startswith` (dropping the suffix-shape
        check) would fail this half: "Demo-v2" would wrongly get swept up as
        this run's own file.
        """
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "Demo.safetensors").write_bytes(b"finished run")
        (loras / "Demo-state").mkdir()
        (loras / "Demo-v2.safetensors").write_bytes(b"other run")
        (loras / "Demo-v2-state").mkdir()

        scan = sd_scripts_base._move_stale_run_files(str(loras), "demo")

        assert scan.moved_ckpts == 1
        assert scan.moved_states == 1
        assert not (loras / "Demo.safetensors").exists()
        # The moved file keeps its real on-disk spelling...
        assert (scan.dest / "Demo.safetensors").exists()
        # ...and the scan reports it separately from the (lowercase) name
        # that was searched for, so a caller can tell the two apart.
        assert scan.real_names == ("Demo",)
        # The differently-shaped sibling survives untouched.
        assert (loras / "Demo-v2.safetensors").exists()
        assert (loras / "Demo-v2-state").is_dir()

    # --- Finding 2: some/all rename() calls raise ---

    def test_total_rename_failure_reports_failed_and_no_dest(
        self, tmp_path, monkeypatch
    ):
        """If every rename() raises, nothing moved: `dest` must be None (not
        the stash dir — that would contradict the "None means nothing to
        move" contract and read as success), `failed` must say so, and the
        empty stash dir created for the attempt must not be left behind.
        Reverting the fix makes this fail: the old code returned
        `(0, 0, dest)` with `dest` non-None here."""
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "demo.safetensors").write_bytes(b"final")

        def raise_oserror(self, target):
            raise OSError("file is locked")

        monkeypatch.setattr(Path, "rename", raise_oserror)

        scan = sd_scripts_base._move_stale_run_files(str(loras), "demo")

        assert scan.moved_ckpts == 0
        assert scan.moved_states == 0
        assert scan.failed == 1
        assert scan.dest is None
        # The per-run stash dir created for the attempt is cleaned up again
        # (its `_superseded` container may still exist, empty, which is
        # harmless — it's the per-name dir that must not linger empty).
        assert not (loras / "_superseded" / "demo").exists()
        # The file itself was never moved.
        assert (loras / "demo.safetensors").exists()

    def test_partial_rename_failure_keeps_dest_and_reports_failed(
        self, tmp_path, monkeypatch
    ):
        """One file moves, one doesn't: `dest` should still point at the
        stash dir (something genuinely landed there) while `failed` flags
        the leftover so the caller still warns about it."""
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "demo.safetensors").write_bytes(b"final")
        (loras / "demo-000005.safetensors").write_bytes(b"epoch5")

        real_rename = Path.rename

        def flaky_rename(self, target):
            if self.name == "demo-000005.safetensors":
                raise OSError("file is locked")
            return real_rename(self, target)

        monkeypatch.setattr(Path, "rename", flaky_rename)

        scan = sd_scripts_base._move_stale_run_files(str(loras), "demo")

        assert scan.moved_ckpts == 1
        assert scan.failed == 1
        assert scan.dest is not None
        assert (scan.dest / "demo.safetensors").exists()
        assert (loras / "demo-000005.safetensors").exists()


class TestSupersedePreviousRun:
    """`SdScriptsProvider._supersede_previous_run` — the generate_config-time
    call both KohyaProvider and MusubiProvider make."""

    def test_queues_a_prelude_note(self, provider, tmp_path):
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "demo.safetensors").write_bytes(b"final")

        provider._supersede_previous_run(_flux_request(tmp_path), "job1")

        notes = provider._caption_prelude("job1")
        assert any("Moved" in n and "demo" in n for n in notes)
        # Popped, not just read — a second call finds nothing left to report.
        assert provider._caption_prelude("job1") == []

    def test_no_note_when_nothing_to_move(self, provider, tmp_path):
        (tmp_path / "loras").mkdir()
        provider._supersede_previous_run(_flux_request(tmp_path), "job1")
        assert provider._caption_prelude("job1") == []

    def test_resume_state_skips_supersede_entirely(self, provider, tmp_path):
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "demo.safetensors").write_bytes(b"final")
        resume_dir = loras / "demo-state"
        resume_dir.mkdir()

        request = _flux_request(tmp_path, resume_state=str(resume_dir))
        provider._supersede_previous_run(request, "job2")

        # The checkpoint and the dir the run was told to resume from are both
        # left exactly where the run expects to find them.
        assert (loras / "demo.safetensors").exists()
        assert resume_dir.is_dir()
        assert provider._caption_prelude("job2") == []

    def test_note_names_the_real_on_disk_spelling_for_a_case_variant(
        self, provider, tmp_path
    ):
        """Finding 1's other half: the note text must not claim the old run
        was also called "demo" when it was actually "Demo" — that would be
        confusing next to a `_superseded/demo/Demo.safetensors` the user can
        see has a different spelling than the folder it's sitting in."""
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "Demo.safetensors").write_bytes(b"finished run")

        provider._supersede_previous_run(_flux_request(tmp_path), "job1")

        notes = provider._caption_prelude("job1")
        assert any("Moved" in n and "Demo" in n for n in notes)

    def test_total_move_failure_queues_a_warning_not_a_false_success(
        self, provider, tmp_path, monkeypatch
    ):
        """Finding 2, at the `_supersede_previous_run` level: when every move
        fails, the queued note must be a warning that the overwrite risk is
        still live — not the old grammatically-broken, factually-false
        "Moved  from an earlier run of 'demo' into _superseded/demo" note
        the empty-`parts` bug produced. Reverting the fix makes this fail:
        the old code emitted a "Moved" note with an empty `parts` list here."""
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "demo.safetensors").write_bytes(b"final")

        monkeypatch.setattr(
            Path, "rename", lambda self, target: (_ for _ in ()).throw(
                OSError("file is locked")
            )
        )

        provider._supersede_previous_run(_flux_request(tmp_path), "job1")

        notes = provider._caption_prelude("job1")
        assert len(notes) == 1
        assert notes[0].startswith("Warning:")
        assert "demo" in notes[0]
        assert "Moved" not in notes[0]
        # The file is still exactly where the run is about to write.
        assert (loras / "demo.safetensors").exists()

    def test_partial_move_failure_queues_both_a_move_note_and_a_warning(
        self, provider, tmp_path, monkeypatch
    ):
        loras = tmp_path / "loras"
        loras.mkdir()
        (loras / "demo.safetensors").write_bytes(b"final")
        (loras / "demo-000005.safetensors").write_bytes(b"epoch5")

        real_rename = Path.rename

        def flaky_rename(self, target):
            if self.name == "demo-000005.safetensors":
                raise OSError("file is locked")
            return real_rename(self, target)

        monkeypatch.setattr(Path, "rename", flaky_rename)

        provider._supersede_previous_run(_flux_request(tmp_path), "job1")

        notes = provider._caption_prelude("job1")
        assert any(n.startswith("Moved") for n in notes)
        assert any(n.startswith("Warning:") for n in notes)


# --------------------------------------------------------------------------
# Fake subprocess
# --------------------------------------------------------------------------


class FakeStream:
    """Minimal stand-in for asyncio.StreamReader.

    `_read_stream` only ever calls `read(n)` and stops on a falsy result, so
    that is all this has to provide. Reading an empty, unclosed stream blocks
    for ever — which is exactly what the read-timeout test needs.
    """

    def __init__(self):
        self._chunks: asyncio.Queue = asyncio.Queue()

    def feed(self, data: str) -> None:
        self._chunks.put_nowait(data.encode("utf-8"))

    def close(self) -> None:
        self._chunks.put_nowait(b"")

    async def read(self, _n: int = -1) -> bytes:
        return await self._chunks.get()


class FakeProcess:
    """Stand-in for asyncio.subprocess.Process."""

    def __init__(self, exit_code: int = 0):
        self.stdout = FakeStream()
        self.stderr = FakeStream()
        self._exit_code = exit_code
        self._returncode = None

    def feed_lines(self, lines, stderr: bool = False) -> None:
        stream = self.stderr if stderr else self.stdout
        for line in lines:
            stream.feed(line + "\n")

    def close_streams(self) -> None:
        self.stdout.close()
        self.stderr.close()

    def mark_exited(self) -> None:
        """Set returncode without any EOF — a child that died holding pipes."""
        self._returncode = self._exit_code

    @property
    def returncode(self):
        return self._returncode

    async def wait(self) -> int:
        self._returncode = self._exit_code
        return self._returncode


class TestRunPhaseSubprocessCancelledPath:
    """Finding: `_run_phase_subprocess` used to return on the cancelled path
    without clearing `run.process`, the one exit from the function (and from
    `_stream_training_progress`) that didn't uphold that invariant."""

    def test_cancelled_path_clears_run_process(
        self, provider, tmp_path, monkeypatch
    ):
        proc = FakeProcess()
        proc.feed_lines(["steps:  25%|##        | 1/4 [00:01<00:03,  1.00it/s]"])
        proc.close_streams()

        async def fake_create_subprocess_exec(*args, **kwargs):
            return proc

        monkeypatch.setattr(
            asyncio, "create_subprocess_exec", fake_create_subprocess_exec
        )

        run = SubprocessRun()

        async def go():
            gen = provider._run_phase_subprocess(
                "job-1", run, ["fake"], str(tmp_path), {}, "Caching latents"
            )
            async for _ in gen:
                # Cancel arrives mid-phase, same as a user hitting stop while
                # musubi's pre-cache subprocess is still running.
                run.cancelled = True

        asyncio.run(go())
        assert run.process is None


def make_request(tmp_path: Path, sample_prompts=()) -> StartJobRequest:
    return StartJobRequest(
        project_path=str(tmp_path),
        provider=ProviderType.KOHYA,
        base_model="anima",
        # No `sample/` subfolder is ever created, so sample scanning is a
        # consistent no-op and nothing is written to disk.
        output_path=str(tmp_path / "loras"),
        output_name="demo",
        datasets=[DatasetEntry(path=str(tmp_path / "imgs"))],
        hyperparameters={},
        sample_prompts=list(sample_prompts),
    )


def drive(
    provider: KohyaProvider,
    request: StartJobRequest,
    proc: FakeProcess,
    *,
    run: SubprocessRun = None,
    cancel_after: int = None,
):
    """Run the state machine over `proc` and return every JobProgress it yields."""
    run = run or SubprocessRun()
    run.process = proc

    async def go():
        out = []
        gen = provider._stream_training_progress("job-1", request, run, proc)
        async for progress in gen:
            out.append(progress)
            if cancel_after is not None and len(out) == cancel_after:
                run.cancelled = True
        return out

    return asyncio.run(go())


def transcript_run(
    provider,
    request,
    lines,
    *,
    exit_code: int = 0,
    stderr: bool = False,
    cancel_after: int = None,
):
    proc = FakeProcess(exit_code)
    proc.feed_lines(lines, stderr=stderr)
    proc.close_streams()
    return drive(provider, request, proc, cancel_after=cancel_after)


# --------------------------------------------------------------------------
# Fixture-driven: real captured output
# --------------------------------------------------------------------------


def test_fixture_lines_never_crash_the_classifier(provider):
    """Every classification step survives the mangled interleaved lines.

    The capture includes lines where several DataLoader workers' rich-formatted
    writes were spliced together mid-token ("dataset.py:epoch is incremented.
    1, epoch: 2  464"). None of them may raise.
    """
    log: list[str] = []
    for line in fixture_lines():
        lower = line.lower()
        provider._preparing_phase_for(lower)
        provider._is_save_announce(line)
        provider._is_save_done(line)
        EPOCH_PATTERN.search(line)
        SAMPLE_ANNOUNCE_PATTERN.search(lower)
        match = TQDM_PATTERN.search(line)
        if match:
            assert int(match.group(1)) >= 0
            assert int(match.group(2)) >= 0
            _parse_eta_seconds(match.group(3))
        LOSS_PATTERN.search(line)
        RATE_PATTERN.search(line)
        _append_log_line(log, line)
    assert log  # something survived


def test_fixture_epoch_lines_parse():
    """`epoch N/M` lines parse, and the shredded ones produce no false match."""
    epochs = [
        (int(m.group(1)), int(m.group(2)))
        for line in fixture_lines()
        if (m := EPOCH_PATTERN.search(line))
    ]
    assert epochs == [(1, 70), (2, 70), (3, 70), (70, 70)]


def test_fixture_sampler_bars_parse():
    """The sampler's own diffusion bars give current/total/eta/rate."""
    bars = [
        m
        for line in fixture_lines()
        if line.startswith("Sampling:") and (m := TQDM_PATTERN.search(line))
    ]
    assert len(bars) == 38
    first = bars[0]
    assert (int(first.group(1)), int(first.group(2))) == (5, 20)
    assert _parse_eta_seconds(first.group(3)) == 14
    rate = RATE_PATTERN.search(first.group(0))
    assert rate.group(1) == "1.03" and rate.group(2) == "it/s"
    # The inverted rate on a slow step is read as s/it, not it/s.
    slow = next(
        RATE_PATTERN.search(line)
        for line in fixture_lines()
        if "1.01s/it" in line.replace(" ", "")
    )
    assert slow.group(2) == "s/it"


def test_fixture_terminal_save_lines_are_recognised(provider):
    lines = fixture_lines()
    announces = [line for line in lines if provider._is_save_announce(line)]
    dones = [line for line in lines if provider._is_save_done(line)]
    assert announces == [
        "saving checkpoint: C:\\train\\loras\\demo-lora.safetensors"
    ]
    assert dones == ["model saved."]


def test_fixture_prep_lines_produce_no_phase_label(provider):
    """The bilingual prep summary must not be mistaken for a caching phase.

    "num train images * repeats / 学習画像の数×繰り返し回数: 80" and friends are
    just the run header — labelling them would freeze a stale phase on the UI.
    """
    labels = {
        provider._preparing_phase_for(line.lower()) for line in fixture_lines()
    }
    assert labels == {None}


@pytest.mark.parametrize(
    "line,expected",
    [
        ("caching latents / latentsをキャッシュしています", "Caching latents"),
        (
            "caching text encoder outputs / テキストエンコーダー出力をキャッシュ",
            "Caching text-encoder outputs",
        ),
        ("INFO loading U-Net from model.safetensors", "Loading model"),
        ("running training / 学習開始", None),
    ],
)
def test_preparing_phase_labels(provider, line, expected):
    assert provider._preparing_phase_for(line.lower()) == expected


def test_fixture_triton_warnings_are_kept_apart():
    """Distinct worker warnings are NOT collapsed — they name different pids.

    torch emits one `triton not found` warning per DataLoader worker, each
    stamped with its own timestamp and pid. `_append_log_line` only collapses
    lines that compare equal once the sd-scripts timestamp is stripped, so
    these stay as they are (collapsing them would hide which workers warned).
    """
    triton = [line for line in fixture_lines() if "triton not found" in line]
    assert len(triton) == 7
    log: list[str] = []
    for line in triton:
        _append_log_line(log, line)
    assert len(log) == 7


def test_repeated_warning_block_collapses():
    """Verbatim repeats — what --console_log_simple actually produces — collapse."""
    warning = (
        "W0731 10:42:53.297000 7828 torch\\utils\\flop_counter.py:29] "
        "triton not found; flop counting will not work for triton kernels"
    )
    log: list[str] = []
    for _ in range(5):
        _append_log_line(log, warning)
    assert log == [warning]


def test_alternating_epoch_block_collapses():
    """The two-line epoch rollover block repeats as a pair, and is collapsed."""
    block = [
        "2026-07-31 10:45:53 INFO     epoch is incremented.    dataset.py:464",
        "current_epoch: 1, epoch: 2",
        # Same block a second later — a different timestamp, same content.
        "2026-07-31 10:45:54 INFO     epoch is incremented.    dataset.py:464",
        "current_epoch: 1, epoch: 2",
    ]
    log: list[str] = []
    for line in block:
        _append_log_line(log, line)
    assert len(log) == 2


# --------------------------------------------------------------------------
# Pure pieces
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("00:30<09:30,  2.30it/s", 570),
        ("00:04<00:14,  1.03it/s", 14),
        ("12:00<1:15:30,  0.10it/s", 4530),
        ("00:00<?, ?it/s", None),
        ("no bracket here", None),
    ],
)
def test_parse_eta_seconds(text, expected):
    assert _parse_eta_seconds(text) == expected


def test_training_bar_fields():
    line = "steps:   5%|▌         | 150/3000 [00:30<09:30,  2.30it/s, avr_loss=0.0912]"
    match = TQDM_PATTERN.search(line)
    assert (int(match.group(1)), int(match.group(2))) == (150, 3000)
    assert float(LOSS_PATTERN.search(line).group(1)) == pytest.approx(0.0912)
    assert _parse_eta_seconds(match.group(3)) == 570
    rate = RATE_PATTERN.search(line)
    assert (rate.group(1), rate.group(2)) == ("2.30", "it/s")


@pytest.mark.parametrize(
    "line,step",
    [
        ("generating sample images at step / サンプル画像生成 ステップ: 250", 250),
        ("Generating sample images at step 250", 250),
    ],
)
def test_sample_announce_pattern(line, step):
    assert int(SAMPLE_ANNOUNCE_PATTERN.search(line.lower()).group(1)) == step


@pytest.mark.parametrize(
    "index,total,expected",
    [
        (0, 4, SAMPLING_PHASE),
        (1, 4, f"{SAMPLING_PHASE} - 1/4"),
        # An extra `prompt:` block can't push the count past the prompt total.
        (9, 4, f"{SAMPLING_PHASE} - 4/4"),
        (2, 0, SAMPLING_PHASE),
    ],
)
def test_sampling_phase_label(index, total, expected):
    assert _sampling_phase(index, total) == expected


@pytest.mark.parametrize(
    "name,expected",
    [
        # Step cadence: {output_name}_{step:06d}_{promptIdx:02d}_{timestamp}.png
        ("demo_000250_00_20260731103000.png", (250, None, 0)),
        # Epoch cadence: the six digits are the epoch, so the step is unknown.
        ("demo_e000004_02_20260731103000.png", (0, 4, 2)),
        # Underscores in output_name are fine — the prefix is stripped exactly.
        ("demo_000250_01_20260731103000_1234.png", (250, None, 1)),
    ],
)
def test_parse_sample_names(provider, name, expected):
    sample = provider._parse_sample(f"C:\\loras\\sample\\{name}", "demo")
    assert (sample.step, sample.epoch, sample.prompt_index) == expected
    assert sample.path == f"sample/{name}"


@pytest.mark.parametrize(
    "name",
    [
        "other-run_000250_00_x.png",  # another run's prefix
        "demo_abc_00_x.png",  # not the filename grammar
        "demo_00025_00_x.png",  # five digits, not six
    ],
)
def test_parse_sample_rejects_foreign_names(provider, name):
    assert provider._parse_sample(f"C:\\loras\\sample\\{name}", "demo") is None


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("", []),
        (None, []),
        ("conv_dim=8 conv_alpha=4", ["conv_dim=8", "conv_alpha=4"]),
        # Bare tokens with no '=' are dropped.
        ("conv_dim=8 nonsense", ["conv_dim=8"]),
        # A quoted value containing spaces survives as one arg (this used to be
        # truncated to `algo="lokr`).
        ('algo="lokr full" conv_dim=8', ["algo=lokr full", "conv_dim=8"]),
        # The whole pair quoted works too.
        ('"algo=lokr full"', ["algo=lokr full"]),
        # Windows backslash paths are not treated as escapes.
        (
            r"lora_path=C:\models\a\b.safetensors",
            [r"lora_path=C:\models\a\b.safetensors"],
        ),
        # Unbalanced quotes fall back to whitespace splitting rather than
        # dropping the user's input on the floor.
        ('algo="lokr', ['algo="lokr']),
    ],
)
def test_parse_kv_args(raw, expected):
    assert _parse_kv_args(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, None),
        ("", None),
        ("1280x768", (1280, 768)),
        ("1280 X 768", (1280, 768)),
        ("1280×768", (1280, 768)),
        ("1280,768", (1280, 768)),
    ],
)
def test_parse_native_resolution(raw, expected):
    assert _parse_native_resolution(raw) == expected


@pytest.mark.parametrize("raw", ["1280", "1280x", "abc", "1281x768", "0x768"])
def test_parse_native_resolution_rejects(raw):
    with pytest.raises(ValueError):
        _parse_native_resolution(raw)


@pytest.mark.parametrize(
    "line,flag,expected",
    [
        ("a girl --w 512", "w", True),
        ("a girl --w 512", "h", False),
        # "--ss euler_a" must not read as the "-s" steps flag.
        ("a girl --ss euler_a", "s", False),
        ("a girl --l 4.0", "l", True),
        # A bare "--w" with no value isn't a set flag.
        ("a girl --w", "w", False),
    ],
)
def test_prompt_line_has_flag(line, flag, expected):
    assert _prompt_line_has_flag(line, flag) is expected


def test_add_missing_sample_flags_respects_user_flags(provider):
    line = provider._add_missing_sample_flags("a girl --w 640", 512, 512, 20, "4")
    assert line == "a girl --w 640 --h 512 --s 20 --l 4"


def test_sample_guidance_flag_is_overridable(provider):
    class Musubiish(KohyaProvider):
        sample_guidance_flag = "g"

    line = Musubiish("x")._add_missing_sample_flags("a girl", 512, 512, 20, "4")
    assert line == "a girl --w 512 --h 512 --s 20 --g 4"


@pytest.mark.parametrize(
    "value,expected",
    [(1, "1"), (True, "1"), (False, "0"), (1e-4, "0.0001"), (2.0, "2"), (0.5, "0.5")],
)
def test_num(value, expected):
    assert _num(value) == expected


def test_toml_helpers():
    assert _toml_bool(True) == "true" and _toml_bool(False) == "false"
    assert _toml_str(r"C:\imgs\a") == r'"C:\\imgs\\a"'
    assert _toml_str('say "hi"') == '"say \\"hi\\""'


# --------------------------------------------------------------------------
# State machine, end to end
# --------------------------------------------------------------------------

HAPPY_PATH = [
    "steps:   0%|          | 0/4 [00:00<?, ?it/s]",
    "epoch 1/2",
    "steps:  25%|██▌       | 1/4 [00:01<00:03,  1.00it/s, avr_loss=0.15]",
    "steps:  50%|█████     | 2/4 [00:02<00:02,  1.00it/s, avr_loss=0.14]",
    "saving checkpoint: C:\\train\\loras\\demo-step00000002.safetensors",
    "epoch 2/2",
    "steps:  75%|███████▌  | 3/4 [00:03<00:01,  1.00it/s, avr_loss=0.13]",
    "steps: 100%|██████████| 4/4 [00:04<00:00,  1.00it/s, avr_loss=0.12]",
    "saving checkpoint: C:\\train\\loras\\demo.safetensors",
    "model saved.",
]


def test_happy_path_steps_loss_and_eta(provider, tmp_path):
    out = transcript_run(provider, make_request(tmp_path), HAPPY_PATH)

    training = [p for p in out if p.status == JobStatus.TRAINING and p.phase is None]
    assert [p.current_step for p in training] == [0, 1, 2, 3, 4]
    assert all(p.total_steps == 4 for p in training)
    assert [p.loss for p in training] == [None, 0.15, 0.14, 0.13, 0.12]
    assert [p.eta_seconds for p in training] == [None, 3, 2, 1, 0]
    assert [p.speed for p in training] == [None] + ["1.00 it/s"] * 4
    # The epoch lines land between bars and are carried on the next tick.
    assert training[1].current_epoch == 1 and training[1].total_epochs == 2
    assert training[-1].current_epoch == 2


def test_happy_path_save_confirmations_land_at_the_right_step(provider, tmp_path):
    out = transcript_run(provider, make_request(tmp_path), HAPPY_PATH)

    saves = [(p.phase, p.saved_checkpoints) for p in out if p.saved_checkpoints]
    assert saves == [
        ("Saving checkpoint", [2]),  # bar frozen on step 2
        ("Saving checkpoint", [4]),
        ("Checkpoint saved", [4]),  # "model saved." — the run-end save
    ]


def test_happy_path_terminal_reports_a_full_bar(provider, tmp_path):
    out = transcript_run(provider, make_request(tmp_path), HAPPY_PATH)

    terminal = out[-1]
    assert terminal.status == JobStatus.COMPLETED
    assert (terminal.current_step, terminal.total_steps) == (4, 4)
    assert (terminal.current_epoch, terminal.total_epochs) == (2, 2)


def test_saving_state_is_recognised_as_a_save_phase(provider, tmp_path):
    """`saving state at epoch N` used to fall through as generic output."""
    out = transcript_run(
        provider,
        make_request(tmp_path),
        [
            "steps:  25%|██▌       | 1/4 [00:01<00:03,  1.00it/s, avr_loss=0.15]",
            "saving checkpoint: C:\\train\\loras\\demo.safetensors",
            "saving state at epoch 1",
        ],
    )
    phases = [p.phase for p in out if p.phase]
    assert phases == ["Saving checkpoint", "Saving checkpoint"]
    assert out[-2].saved_checkpoints == [1]


SAMPLING_TRANSCRIPT = [
    "steps:   0%|          | 0/4 [00:00<?, ?it/s]",
    "steps:  25%|██▌       | 1/4 [00:01<00:03,  1.00it/s, avr_loss=0.15]",
    "generating sample images at step / サンプル画像生成 ステップ: 1",
    "prompt: a girl, size: 512x512, steps: 20, scale: 4.0, seed: None",
    "Sampling:   5%|▌         | 1/20 [00:00<00:16,  1.12it/s]",
    "Sampling: 100%|██████████| 20/20 [00:19<00:00,  1.02it/s]",
    "prompt: a boy, size: 512x512, steps: 20, scale: 4.0, seed: None",
    "Sampling:  50%|█████     | 10/20 [00:09<00:09,  1.01it/s]",
    # tqdm catching the training bar up to the step sampling fired at — still
    # the pause, not training resuming.
    "steps:  25%|██▌       | 1/4 [00:20<01:00,  1.00it/s, avr_loss=0.15]",
    # Past it: training is genuinely back.
    "steps:  50%|█████     | 2/4 [00:21<00:02,  1.00it/s, avr_loss=0.14]",
]


def test_sampling_pause_counts_images_and_exits_on_the_training_bar(
    provider, tmp_path
):
    request = make_request(tmp_path, sample_prompts=["a girl", "a boy"])
    out = transcript_run(provider, request, SAMPLING_TRANSCRIPT)

    phases = [p.phase for p in out if p.phase]
    assert phases == [
        # The announcement opens the event before any image has started.
        SAMPLING_PHASE,
        f"{SAMPLING_PHASE} - 1/2",  # first prompt block
        f"{SAMPLING_PHASE} - 1/2",  # its diffusion bar (1/20)
        f"{SAMPLING_PHASE} - 1/2",  # ... and (20/20)
        f"{SAMPLING_PHASE} - 2/2",  # second prompt block
        f"{SAMPLING_PHASE} - 2/2",  # its diffusion bar
        f"{SAMPLING_PHASE} - 2/2",  # frozen training-bar repaint at step 1
    ]

    bars = [p.sample_progress for p in out if p.sample_progress]
    assert [(b.current, b.total) for b in bars] == [(1, 20), (20, 20), (10, 20)]

    # The sampler's 20/20 bar must never be mistaken for training progress.
    assert all(p.total_steps in (0, 4) for p in out)

    resumed = out[-2]
    assert resumed.status == JobStatus.TRAINING
    assert resumed.phase is None and resumed.current_step == 2


def test_sampling_pause_holds_the_epoch_back(provider, tmp_path):
    """An epoch logged mid-pause is applied only once the pause ends."""
    request = make_request(tmp_path, sample_prompts=["a girl"])
    out = transcript_run(
        provider,
        request,
        [
            "steps:  25%|██▌       | 1/4 [00:01<00:03,  1.00it/s, avr_loss=0.15]",
            "epoch 1/2",
            "generating sample images at step / サンプル画像生成 ステップ: 1",
            "epoch 2/2",  # logged during the pause
            "prompt: a girl, size: 512x512, steps: 20, scale: 4.0, seed: None",
            "steps:  50%|█████     | 2/4 [00:21<00:02,  1.00it/s, avr_loss=0.14]",
        ],
    )
    during = [p for p in out if p.phase and p.phase.startswith(SAMPLING_PHASE)]
    assert all(p.current_epoch == 1 for p in during)
    assert out[-2].current_epoch == 2  # adopted on the resuming bar


def test_cancelled_run_yields_no_terminal_event(provider, tmp_path):
    out = transcript_run(
        provider,
        make_request(tmp_path),
        HAPPY_PATH,
        exit_code=1,  # the kill's exit code
        cancel_after=2,
    )
    assert out  # the ticks before the cancel still came through
    assert all(
        p.status not in (JobStatus.COMPLETED, JobStatus.FAILED) for p in out
    )


def test_failure_reports_the_stderr_tail(provider, tmp_path):
    out = transcript_run(
        provider,
        make_request(tmp_path),
        [
            "steps:  25%|██▌       | 1/4 [00:01<00:03,  1.00it/s, avr_loss=0.15]",
            "Traceback (most recent call last):",
            "torch.OutOfMemoryError: CUDA out of memory.",
        ],
        exit_code=1,
        stderr=True,
    )
    terminal = out[-1]
    assert terminal.status == JobStatus.FAILED
    assert "exited with code 1" in terminal.error
    assert "CUDA out of memory" in terminal.error
    assert terminal.log_lines


def test_read_loop_gives_up_when_the_child_died_holding_its_pipes(
    provider, tmp_path, monkeypatch
):
    """No EOF is coming, so the loop must not wait for one for ever."""
    monkeypatch.setattr(sd_scripts_base, "STREAM_READ_TIMEOUT_S", 0.05)
    proc = FakeProcess(0)
    proc.mark_exited()  # returncode set, streams never closed
    out = drive(provider, make_request(tmp_path), proc)
    assert out[-1].status == JobStatus.COMPLETED


def test_read_loop_keeps_waiting_while_the_child_is_alive(
    provider, tmp_path, monkeypatch
):
    """A slow step (23 s/it has been observed) must not end the run."""
    monkeypatch.setattr(sd_scripts_base, "STREAM_READ_TIMEOUT_S", 0.02)
    proc = FakeProcess(0)

    async def go():
        out = []
        run = SubprocessRun()
        gen = provider._stream_training_progress(
            "job-1", make_request(tmp_path), run, proc
        )
        task = asyncio.create_task(_collect(gen, out))
        # Several timeout windows pass with nothing on the streams and no
        # returncode: the loop should still be waiting.
        await asyncio.sleep(0.1)
        assert not task.done()
        proc.feed_lines(
            ["steps: 100%|██████████| 4/4 [00:04<00:00,  1.00it/s, avr_loss=0.1]"]
        )
        proc.close_streams()
        await task
        return out

    out = asyncio.run(go())
    assert out[-1].status == JobStatus.COMPLETED
    assert out[-1].current_step == 4


async def _collect(gen, out):
    async for progress in gen:
        out.append(progress)


# --------------------------------------------------------------------------
# Dataset config (bucketing)
# --------------------------------------------------------------------------


def generate_config(tmp_path, hyperparameters, job_id: str = "job0") -> str:
    request = make_request(tmp_path)
    request.hyperparameters = hyperparameters
    provider = KohyaProvider("nonexistent-scripts-path")
    path = asyncio.run(provider.generate_config(request, str(tmp_path), job_id))
    return Path(path).read_text(encoding="utf-8")


def test_single_resolution_still_buckets(tmp_path):
    """A one-resolution run used to centre-crop every non-square image."""
    toml = generate_config(tmp_path, {"resolution": [1024]})
    assert "resolution = 1024" in toml
    assert "enable_bucket = true" in toml
    assert "min_bucket_reso = 256" in toml
    assert "max_bucket_reso = 1024" in toml


def test_multi_resolution_buckets_between_the_chosen_sizes(tmp_path):
    toml = generate_config(tmp_path, {"resolution": [768, 1024]})
    assert "enable_bucket = true" in toml
    assert "min_bucket_reso = 768" in toml
    assert "max_bucket_reso = 1024" in toml


def test_native_resolution_disables_bucketing(tmp_path):
    toml = generate_config(
        tmp_path, {"resolution": [1024], "native_resolution": "1280x768"}
    )
    assert "resolution = [1280, 768]" in toml
    assert "enable_bucket = false" in toml
    assert "bucket_reso" not in toml
