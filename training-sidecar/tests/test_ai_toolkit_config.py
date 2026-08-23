"""Tests for the ai-toolkit ui_trainer provider.

Most of this file exercises `_build_config_dict` directly (the model block's
`model_kwargs` path overrides for Krea 2's local TE/VAE directories, and their
interaction with the quantisation flags). `TestSamplePromptFlags` and
`TestCancelDuringSetup` exercise the run lifecycle:

* sample-prompt flag detection, mirroring ai-toolkit's own (case-sensitive,
  `--`-split) prompt parser rather than sd-scripts' — see
  `_aitk_prompt_line_has_flag`.
* the cancel-before-there's-anything-to-cancel bug, where a cancel landing
  during dataset-manifest building, checkpoint superseding, or the
  ai-toolkit server's cold start (up to 180s via `ensure_running()`) used to
  be a total no-op — the run continued invisibly and unstoppably, and the
  queue worker stayed blocked behind it.
* the ghost-run hole in that bug's original fix: a cancel landing after
  `/start` but before ai-toolkit's own cron worker claims the row (status
  'queued', pid still null) used to issue only ai-toolkit's `/stop`, which
  leaves a pid-less row's `status` untouched — so the row stayed live in
  ai-toolkit's queue table and could launch, unmanaged, whenever anything
  later started that GPU's queue. `_stop_ai_toolkit_job` picks between
  `/stop` and `mark_stopped` based on the row's live `pid`.
"""

import asyncio

import httpx

from models import DatasetEntry, ProviderType, StartJobRequest
from providers.ai_toolkit_ui import (
    AiToolkitUiProvider,
    _build_config_dict,
    _sample_prompt_lines,
)


def make_request(
    hyperparameters: dict = None,
    base_model: str = "krea2",
    sample_prompts=(),
):
    hp = {"model_paths": {"checkpoint": "X:/models/krea2/raw.safetensors"}}
    hp.update(hyperparameters or {})
    hp.setdefault("model_path", hp["model_paths"].get("checkpoint"))
    return StartJobRequest(
        project_path="X:/proj",
        provider=ProviderType.AI_TOOLKIT,
        base_model=base_model,
        output_path="X:/loras",
        output_name="demo",
        datasets=[DatasetEntry(path="X:/proj/imgs", num_repeats=5)],
        hyperparameters=hp,
        sample_prompts=list(sample_prompts),
    )


def model_block(request) -> dict:
    return _build_config_dict(request)["config"]["process"][0]["model"]


def train_block(request) -> dict:
    return _build_config_dict(request)["config"]["process"][0]["train"]


class TestModelKwargs:
    def test_krea2_local_te_and_vae_become_model_kwargs(self):
        request = make_request(
            {
                "model_paths": {
                    "checkpoint": "X:/models/krea2/raw.safetensors",
                    "te_repo": "X:/models/krea2",
                    "vae_repo": "X:/models/krea2",
                },
            }
        )
        block = model_block(request)
        assert block["model_kwargs"] == {
            "text_encoder_path": "X:/models/krea2",
            "vae_path": "X:/models/krea2",
        }

    def test_krea2_partial_paths_emit_only_what_was_sent(self):
        request = make_request(
            {
                "model_paths": {
                    "checkpoint": "X:/models/krea2/raw.safetensors",
                    "te_repo": "X:/models/krea2",
                },
            }
        )
        block = model_block(request)
        assert block["model_kwargs"] == {"text_encoder_path": "X:/models/krea2"}

    def test_krea2_without_paths_omits_model_kwargs(self):
        # No te_repo/vae_repo sent -> ai-toolkit falls back to its own HF
        # downloads; the config must not carry an empty model_kwargs block.
        block = model_block(make_request())
        assert "model_kwargs" not in block

    def test_musubi_component_keys_do_not_leak_into_other_models(self):
        # Only models with a catalogue `model_kwargs_paths` mapping emit
        # model_kwargs, even when the client sends extra component paths.
        request = make_request(
            {
                "model_paths": {
                    "checkpoint": "X:/models/zimage",
                    "te_repo": "X:/models/zimage",
                    "vae_repo": "X:/models/zimage",
                },
            },
            base_model="zimage-turbo",
        )
        block = model_block(request)
        assert "model_kwargs" not in block

    def test_krea2_still_quantizes_and_sends_checkpoint(self):
        block = model_block(make_request())
        assert block["name_or_path"] == "X:/models/krea2/raw.safetensors"
        assert block["arch"] == "krea2"
        assert block["quantize"] is True


class TestTrainingAdapter:
    """`model.assistant_lora_path` — the de-distilling assistant LoRA the
    distilled Turbo checkpoints (Krea 2 Turbo, Z-Image Turbo) must train
    through. Sent as the `training_adapter` component path."""

    def krea2_turbo(self, extra_paths=None, hyperparameters=None):
        paths = {"checkpoint": "X:/models/krea2/turbo.safetensors"}
        paths.update(extra_paths or {})
        hp = {"model_paths": paths}
        hp.update(hyperparameters or {})
        return make_request(hp, base_model="krea2-turbo")

    def test_adapter_path_becomes_assistant_lora_path(self):
        block = model_block(
            self.krea2_turbo(
                {"training_adapter": "X:/models/krea2/krea2_turbo_v1.safetensors"}
            )
        )
        assert (
            block["assistant_lora_path"]
            == "X:/models/krea2/krea2_turbo_v1.safetensors"
        )
        # Same arch class as RAW — ai-toolkit's `krea2:turbo` suffix is
        # cosmetic (ModelConfig strips it), so we never send it.
        assert block["arch"] == "krea2"
        assert block["name_or_path"] == "X:/models/krea2/turbo.safetensors"

    def test_missing_adapter_omits_the_key_entirely(self):
        # A `None` would reach ModelConfig as a set-but-empty value; the key
        # has to be absent so ai-toolkit takes its own default.
        assert "assistant_lora_path" not in model_block(self.krea2_turbo())

    def test_turbo_sample_defaults_disable_cfg(self):
        # guidance_scale 1 is what turns CFG *off*: the krea2 sampler passes
        # max(0, gs - 1) to a 0-normalised pipeline.
        request = self.krea2_turbo()
        request.sample_prompts = ["a photo of a cat"]
        sample = _build_config_dict(request)["config"]["process"][0]["sample"]
        assert sample["guidance_scale"] == 1
        assert sample["sample_steps"] == 9

    def test_turbo_shares_krea2_model_kwargs_paths(self):
        block = model_block(self.krea2_turbo({"te_repo": "X:/models/krea2"}))
        assert block["model_kwargs"] == {"text_encoder_path": "X:/models/krea2"}

    def test_raw_krea2_sends_no_adapter(self):
        assert "assistant_lora_path" not in model_block(make_request())


class TestFirstSample:
    def test_default_takes_the_baseline_sample(self):
        assert train_block(make_request())["skip_first_sample"] is False

    def test_opting_out_skips_it(self):
        block = train_block(make_request({"sample_first_step": False}))
        assert block["skip_first_sample"] is True

    def test_legacy_request_keeps_the_baseline_sample(self):
        # A resumed job's stored hyperparameters predate the field — it must
        # behave as it did before the toggle existed.
        block = train_block(make_request({"sample_first_step": None}))
        assert block["skip_first_sample"] is False


class TestLayerOffloading:
    def test_percent_drives_layer_offloading(self):
        block = model_block(make_request({"layer_offload_percent": 100}))
        assert block["layer_offloading"] is True
        assert block["layer_offloading_transformer_percent"] == 1.0
        assert block["layer_offloading_text_encoder_percent"] == 0.0

    def test_partial_percent_scales(self):
        block = model_block(make_request({"layer_offload_percent": 40}))
        assert block["layer_offloading_transformer_percent"] == 0.4

    def test_zero_percent_disables(self):
        # An explicit 0 wins even with low_vram on — the field is
        # authoritative once the client sends it.
        block = model_block(
            make_request({"layer_offload_percent": 0, "low_vram": True})
        )
        assert "layer_offloading" not in block

    def test_legacy_request_falls_back_to_catalogue(self):
        # A resumed job's stored hyperparameters predate the field: krea2
        # with low_vram must keep offloading via the catalogue default.
        block = model_block(make_request({"low_vram": True}))
        assert block["layer_offloading"] is True
        assert block["layer_offloading_transformer_percent"] == 1.0

    def test_legacy_request_without_low_vram_stays_full_speed(self):
        block = model_block(make_request({"low_vram": False}))
        assert "layer_offloading" not in block

    def test_legacy_models_without_catalogue_entry_do_not_offload(self):
        # Z-Image's fp8 DiT fits in 16 GB — no catalogue fallback there.
        block = model_block(
            make_request({"low_vram": True}, base_model="zimage-turbo")
        )
        assert "layer_offloading" not in block


class TestSaveBlock:
    def test_save_format_passes_through(self):
        request = make_request({"save_format": "bf16"})
        process = _build_config_dict(request)["config"]["process"][0]
        assert process["save"]["dtype"] == "bf16"

    def test_save_format_defaults_to_fp16(self):
        process = _build_config_dict(make_request())["config"]["process"][0]
        assert process["save"]["dtype"] == "fp16"


class TestLrScheduler:
    def test_defaults_to_constant_with_no_params(self):
        train = train_block(make_request())
        assert train["lr_scheduler"] == "constant"
        assert train["lr_scheduler_params"] == {}

    def test_cosine_needs_no_params(self):
        # BaseSDTrainProcess injects `total_iters`, which toolkit/scheduler.py
        # renames to CosineAnnealingLR's `T_max` — so the run's step count is
        # already the annealing period and we must not fight it.
        train = train_block(make_request({"scheduler": "cosine"}))
        assert train["lr_scheduler"] == "cosine"
        assert train["lr_scheduler_params"] == {}

    def test_linear_pins_factors_to_decay(self):
        # torch's LinearLR defaults ramp *up* (1/3 -> 1.0).
        train = train_block(make_request({"scheduler": "linear"}))
        assert train["lr_scheduler_params"] == {
            "start_factor": 1.0,
            "end_factor": 0.0,
        }

    def test_warmup_is_passed_for_constant_with_warmup(self):
        train = train_block(
            make_request(
                {"scheduler": "constant_with_warmup", "warmup_steps": 120}
            )
        )
        assert train["lr_scheduler_params"] == {"num_warmup_steps": 120}

    def test_warmup_is_dropped_for_schedulers_that_cannot_use_it(self):
        # ai-toolkit builds torch schedulers directly, so only the
        # constant_with_warmup branch has anywhere to put a warmup count.
        train = train_block(
            make_request({"scheduler": "cosine", "warmup_steps": 120})
        )
        assert train["lr_scheduler_params"] == {}


class TestSampleBlock:
    def test_neg_is_always_a_string(self):
        # SampleConfig defaults a missing `neg` to the bool False, which
        # crashes Krea 2's prompt encoder (string concat) when sample prompts
        # are pre-cached. The config must always carry a string.
        request = make_request(sample_prompts=["a test prompt"])
        process = _build_config_dict(request)["config"]["process"][0]
        assert process["sample"]["neg"] == ""


class TestSampleCadence:
    """`_build_config_dict`'s `sample.sample_every` — see
    `_resolve_sample_every_steps`. The kohya and musubi providers stopped
    fabricating a 250-step cadence for a 0/0 (disabled) sampling schedule;
    this backend must agree, since job_manager.predict_sample_steps already
    predicts no upcoming samples for that request and 0 is itself
    ai-toolkit's own "never sample" (BaseSDTrainProcess gates on
    `self.sample_config.sample_every and step % ... == 0`, which
    short-circuits before ever reaching the modulo).
    """

    def test_zero_cadence_does_not_fabricate_a_schedule(self):
        request = make_request(
            {"sample_every_n_steps": 0, "sample_every_n_epochs": 0},
            sample_prompts=["a cat"],
        )
        process = _build_config_dict(request)["config"]["process"][0]
        assert process["sample"]["sample_every"] == 0

    def test_step_cadence_passes_through(self):
        request = make_request(
            {"sample_every_n_steps": 100},
            sample_prompts=["a cat"],
        )
        process = _build_config_dict(request)["config"]["process"][0]
        assert process["sample"]["sample_every"] == 100

    def test_epoch_cadence_converts_to_steps(self):
        request = make_request(
            {"sample_every_n_epochs": 2, "epochs": 10, "steps": 1000},
            sample_prompts=["a cat"],
        )
        process = _build_config_dict(request)["config"]["process"][0]
        # steps_per_epoch(2, epochs=10, total_steps=1000) -> (1000//10)*2 = 200
        assert process["sample"]["sample_every"] == 200


class TestSamplePromptFlags:
    """`_sample_prompt_lines` detects an existing `--w`/`--h` the way
    ai-toolkit's OWN prompt parser does (`_aitk_prompt_line_has_flag`, a local
    mirror of `SampleConfig._process_prompt_string`) — case-sensitive, split
    on a bare `--` — rather than the old naive
    `" --w " not in f" {prompt} "` substring check, and rather than
    sd-scripts' own `_prompt_line_has_flag` (case-insensitive, splits on
    `" --"`), which an earlier pass borrowed by mistake since it belongs to a
    different backend's parser.
    """

    def test_appends_missing_size_flags(self):
        request = make_request(sample_prompts=["a cat"])
        lines = _sample_prompt_lines(request, default_res=1024)
        assert lines == ["a cat --w 1024 --h 1024"]

    def test_keeps_users_explicit_flag_and_value(self):
        # The user's own --w wins over the resolved default, and only the
        # missing --h is appended.
        request = make_request(sample_prompts=["a cat --w 512"])
        lines = _sample_prompt_lines(request, default_res=1024)
        assert lines == ["a cat --w 512 --h 1024"]

    def test_bare_trailing_flag_with_no_value_is_not_treated_as_set(self):
        # A dangling "--w" with nothing after it isn't a meaningful width
        # override. ai-toolkit's real parser (SampleConfig.
        # _process_prompt_string) would actually try to consume it anyway —
        # `flag = 'w'`, `content = ''`, then `self.width = int('')` — and
        # raise; it doesn't "skip" a valueless flag. We choose to treat it as
        # unset on our side regardless, so our own resolved "--w 1024" still
        # gets appended rather than leaving the run with no width override at
        # all. (Whether that first, unconsumed "--w" still trips ai-toolkit's
        # own parser is ai-toolkit's problem, not something this line of
        # defence can fix — a bare trailing "--w" is a malformed prompt
        # either way.)
        request = make_request(sample_prompts=["a cat --w"])
        lines = _sample_prompt_lines(request, default_res=1024)
        assert lines == ["a cat --w --w 1024 --h 1024"]

    def test_flag_case_matters(self):
        # ai-toolkit's real parser compares case-SENSITIVELY (`if flag ==
        # 'w'`) — a user's "--W 512" is invisible to it, so treating it as
        # "already set" (the sd-scripts helper's behaviour, borrowed here by
        # mistake in an earlier pass) would silently drop the width override
        # entirely: ai-toolkit falls back to the run-level sample size, and
        # the user's per-prompt "--W 512" is never read by anything. Both
        # --w and --h get appended since neither lowercase flag is present.
        request = make_request(sample_prompts=["a cat --W 512"])
        lines = _sample_prompt_lines(request, default_res=1024)
        assert lines == ["a cat --W 512 --w 1024 --h 1024"]

    def test_unrelated_flag_starting_with_w_does_not_count(self):
        # A flag that merely starts with "w" (not "w" itself) must not
        # suppress the real --w — ai-toolkit's parser takes the flag name as
        # everything up to the first space and compares the whole thing, not
        # a prefix.
        request = make_request(sample_prompts=["a cat --ww 512"])
        lines = _sample_prompt_lines(request, default_res=1024)
        assert "--w 1024" in lines[0]

    def test_per_prompt_size_overrides_default(self):
        request = make_request(sample_prompts=["a cat", "a dog"])
        request.sample_sizes = [[768, 512]]
        lines = _sample_prompt_lines(request, default_res=1024)
        assert lines[0] == "a cat --w 768 --h 512"
        assert lines[1] == "a dog --w 1024 --h 1024"


# ---------------------------------------------------------------------------
# Cancel-during-setup — see the module docstring.
# ---------------------------------------------------------------------------


class FakeAiToolkitServer:
    """Stand-in for `AiToolkitServer` — just the surface `_run` touches.

    `on_ensure_running`, when given, runs inside `ensure_running()` — used to
    simulate a cancel landing exactly during the (real-world: up to 180s)
    server cold-start window, before anything has talked to ai-toolkit's API.
    """

    def __init__(self, on_ensure_running=None):
        self.base_url = "http://fake-aitk.invalid"
        self.log_path = None
        self._on_ensure_running = on_ensure_running

    async def ensure_running(self, timeout: float = 180.0) -> None:
        if self._on_ensure_running is not None:
            await self._on_ensure_running()


class FakeAitkApi:
    """Minimal in-memory ai-toolkit job API, served via `httpx.MockTransport`.

    Records every request as `(method, path)` so tests can assert on exactly
    which ai-toolkit endpoints were (or, importantly, were not) called.
    `on_create`, when set, runs after computing the create response but
    before returning it — used to simulate a cancel landing in the
    create-response-in-flight window, before `_run` has had a chance to
    record the id it's about to receive.
    """

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.job_id = "aitk-job-1"
        self.job_row = {
            "id": self.job_id,
            # Matches the real schema default (Job.status @default("stopped")
            # in ui/prisma/schema.prisma) — processQueue.ts only ever picks
            # up 'queued' rows, so a freshly created, not-yet-started row can
            # never be launched. `/start` is what flips this to 'queued'.
            "status": "stopped",
            "step": 0,
            "info": "",
            "speed_string": "",
            "pid": None,
        }
        self.on_create = None

    async def handler(self, request: httpx.Request) -> httpx.Response:
        method, path = request.method, request.url.path
        self.calls.append((method, path))
        if path == "/api/jobs" and method == "POST":
            if self.on_create is not None:
                await self.on_create()
            return httpx.Response(200, json={"id": self.job_id})
        if path == f"/api/jobs/{self.job_id}/start":
            # Mirrors ui/src/app/api/jobs/[jobID]/start/route.ts.
            self.job_row["status"] = "queued"
            self.job_row["stop"] = False
            return httpx.Response(200, json={"ok": True})
        if path == f"/api/jobs/{self.job_id}/stop":
            # Mirrors ui/src/app/api/jobs/[jobID]/stop/route.ts: unconditionally
            # sets `stop`/`info`, but only flips `status` to 'stopped' when a
            # pid exists. On a pid-less row this deliberately does NOT dequeue
            # it — that asymmetry is the ghost-run hole Finding 1 closes.
            self.job_row["stop"] = True
            if self.job_row.get("pid"):
                self.job_row["status"] = "stopped"
                self.job_row["info"] = "Job stopped"
            else:
                self.job_row["info"] = "Stopping job..."
            return httpx.Response(200, json={"ok": True})
        if path == f"/api/jobs/{self.job_id}/mark_stopped":
            # Mirrors ui/src/app/api/jobs/[jobID]/mark_stopped/route.ts:
            # unconditionally dequeues, no signal sent. The only endpoint
            # that actually removes a pid-less 'queued' row from ai-toolkit's
            # queue table.
            self.job_row["status"] = "stopped"
            self.job_row["stop"] = True
            self.job_row["pid"] = None
            self.job_row["info"] = "Job stopped"
            return httpx.Response(200, json={"ok": True})
        if path.startswith("/api/queue/") and path.endswith("/start"):
            return httpx.Response(200, json={"ok": True})
        if path == "/api/jobs" and method == "GET":
            return httpx.Response(200, json=self.job_row)
        if path == f"/api/jobs/{self.job_id}/log":
            return httpx.Response(200, json={"log": "", "offset": 0})
        return httpx.Response(404, json={"error": f"unhandled {method} {path}"})


def _patch_async_client_transport(monkeypatch, transport: httpx.MockTransport):
    """Route every `httpx.AsyncClient(...)` the provider opens (there are
    several, short-lived ones) through `transport` instead of the network.
    `_run` and `cancel_training` don't take a client as a parameter, so this
    is the only seam available without editing the provider's call sites."""
    real_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        kwargs.setdefault("transport", transport)
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)


async def _drain(agen):
    return [item async for item in agen]


class TestCancelDuringSetup:
    def test_cancel_during_server_startup_creates_nothing(self, monkeypatch):
        # cancel_training() lands while ensure_running() is still "starting
        # the server" — before `_run` has posted anything to ai-toolkit.
        # Previously this found no aitk_id and was a silent no-op; now the
        # flag alone must be enough to stop `_run` from ever calling
        # POST /api/jobs.
        api = FakeAitkApi()
        _patch_async_client_transport(monkeypatch, httpx.MockTransport(api.handler))

        job_id = "job-setup-cancel"
        holder: dict = {}

        async def on_ensure_running():
            await holder["provider"].cancel_training(job_id)

        server = FakeAiToolkitServer(on_ensure_running=on_ensure_running)
        provider = AiToolkitUiProvider("X:/toolkit", server)
        holder["provider"] = provider

        request = make_request(sample_prompts=[])
        items = asyncio.run(
            _drain(
                provider.start_training(
                    request, config_path=None, gpu_id=0, job_id=job_id
                )
            )
        )

        assert api.calls == []
        assert not any(
            "Job created" in line for item in items for line in item.log_lines
        )
        # The run record is dropped once the generator finishes, same as a
        # normal completion — nothing is left behind for a stale cancel to
        # find later.
        assert job_id not in provider._runs

    def test_cancel_before_server_start_skips_ensure_running(self, monkeypatch):
        # A cancel landing during dataset-manifest building / checkpoint
        # superseding — pure local filesystem work, before `ensure_running()`
        # is even called — must not still pay for the (real-world: up to
        # 180s) server cold start before the worker notices. Simulate this by
        # flipping `cancelled` directly once the generator has yielded its
        # first setup line (proving `run` is registered) but before it would
        # reach "Starting ai-toolkit server...".
        ensure_running_called = False

        async def on_ensure_running():
            nonlocal ensure_running_called
            ensure_running_called = True

        api = FakeAitkApi()
        _patch_async_client_transport(monkeypatch, httpx.MockTransport(api.handler))
        server = FakeAiToolkitServer(on_ensure_running=on_ensure_running)
        provider = AiToolkitUiProvider("X:/toolkit", server)
        job_id = "job-presetup-cancel"
        request = make_request(sample_prompts=[])
        gen = provider.start_training(
            request, config_path=None, gpu_id=0, job_id=job_id
        )

        async def drive():
            await gen.__anext__()  # the dataset-warning setup line
            # Exactly what cancel_training() does when aitk_id doesn't exist
            # yet — no ai-toolkit HTTP round trip needed to observe the effect.
            provider._runs[job_id].cancelled = True
            return [item async for item in gen]

        remaining = asyncio.run(drive())

        assert remaining == []
        assert not ensure_running_called
        assert api.calls == []

    def test_cancel_between_create_and_start_stops_and_cleans_up(self, monkeypatch):
        # cancel_training() lands while the create response is still in
        # flight — before `_run` has recorded the aitk_id it's about to
        # receive, so cancel_training() itself has nothing to act on. `_run`
        # must notice `run.cancelled` once it does see the id, and must never
        # call /start. The row is provably inert in this particular window
        # (status stays 'stopped', ai-toolkit's schema default, until
        # `/start` runs — never picked up by processQueue.ts regardless), but
        # `_run` still cleans it up for uniformity with the post-`/start`
        # cases, where the row genuinely is live in the queue.
        api = FakeAitkApi()
        job_id = "job-create-cancel"
        holder: dict = {}

        async def on_create():
            await holder["provider"].cancel_training(job_id)

        api.on_create = on_create
        _patch_async_client_transport(monkeypatch, httpx.MockTransport(api.handler))

        server = FakeAiToolkitServer()
        provider = AiToolkitUiProvider("X:/toolkit", server)
        holder["provider"] = provider

        request = make_request(sample_prompts=[])
        asyncio.run(
            _drain(
                provider.start_training(
                    request, config_path=None, gpu_id=0, job_id=job_id
                )
            )
        )

        paths_called = [p for _, p in api.calls]
        assert ("POST", "/api/jobs") in api.calls
        assert f"/api/jobs/{api.job_id}/start" not in paths_called
        # No pid ever existed on this row, so the cleanup path is
        # mark_stopped, not /stop — see `_stop_ai_toolkit_job`.
        assert f"/api/jobs/{api.job_id}/mark_stopped" in paths_called
        assert f"/api/jobs/{api.job_id}/stop" not in paths_called
        assert api.job_row["status"] == "stopped"

    def test_cancel_during_poll_stops_polling_and_dequeues_ghost_job(
        self, monkeypatch
    ):
        # Once the job is created, started, and queued (status 'queued', pid
        # still null — the worker hasn't claimed it), a cancel arriving here
        # is exactly the ghost-run hole from Finding 1: calling ai-toolkit's
        # `/stop` alone would leave `status: 'queued'` untouched (its route
        # only flips status when a pid already exists), so ai-toolkit's own
        # cron worker would pick this row up and launch an unmanaged training
        # run later, contending for the GPU with nothing in the sidecar
        # watching it. `mark_stopped` is what actually dequeues it. This test
        # also covers the "stop polling promptly" behaviour the poll loop's
        # early return provides — that's what kept the queue worker's `await
        # runner()` blocked behind an already-cancelled job before this fix.
        monkeypatch.setattr(
            "providers.ai_toolkit_ui.POLL_INTERVAL_SECONDS", 0.001
        )
        api = FakeAitkApi()
        _patch_async_client_transport(monkeypatch, httpx.MockTransport(api.handler))

        server = FakeAiToolkitServer()
        provider = AiToolkitUiProvider("X:/toolkit", server)
        job_id = "job-poll-cancel"
        request = make_request(sample_prompts=[])
        gen = provider.start_training(
            request, config_path=None, gpu_id=0, job_id=job_id
        )

        async def drive():
            saw_waiting = False
            async for item in gen:
                if item.log_lines and item.log_lines[-1] == (
                    "Waiting for worker to pick up job..."
                ):
                    saw_waiting = True
                    break
            assert saw_waiting
            assert api.job_row["status"] == "queued"
            assert api.job_row["pid"] is None

            # aitk_id is set by now; the row is queued with no pid — the
            # ghost-run hole's exact window.
            await provider.cancel_training(job_id)
            polls_after_cancel = sum(
                1 for m, p in api.calls if m == "GET" and p == "/api/jobs"
            )

            remaining = [item async for item in gen]
            polls_after_drain = sum(
                1 for m, p in api.calls if m == "GET" and p == "/api/jobs"
            )
            return remaining, polls_after_cancel, polls_after_drain

        remaining, polls_after_cancel, polls_after_drain = asyncio.run(drive())

        assert remaining == []
        # No further row polling once cancelled — the loop returned instead
        # of doing another `/api/jobs` poll cycle waiting out ai-toolkit's
        # own eventual "stopped" status. (cancel_training's own row reads,
        # used to decide between /stop and mark_stopped, are the only
        # `/api/jobs` GETs left — captured in polls_after_cancel already, so
        # draining the rest of the generator must add none.)
        assert polls_after_drain == polls_after_cancel
        # The pid-less row is genuinely dequeued.
        assert ("GET", f"/api/jobs/{api.job_id}/mark_stopped") in api.calls
        assert ("GET", f"/api/jobs/{api.job_id}/stop") not in api.calls
        assert api.job_row["status"] == "stopped"

    def test_cancel_while_running_uses_graceful_stop_not_mark_stopped(
        self, monkeypatch
    ):
        # Once ai-toolkit's worker has actually claimed the row (pid set,
        # status 'running'), cancel must keep using the graceful /stop path —
        # it's what signals the trainer to shut down in an orderly way — and
        # must NOT use mark_stopped, which would write status:'stopped'/
        # pid:None with no signal at all and abandon a live training process
        # still touching the GPU. This is the behaviour the cancel fix must
        # not regress while closing the pid-less ghost-run hole.
        monkeypatch.setattr(
            "providers.ai_toolkit_ui.POLL_INTERVAL_SECONDS", 0.001
        )
        api = FakeAitkApi()
        _patch_async_client_transport(monkeypatch, httpx.MockTransport(api.handler))

        server = FakeAiToolkitServer()
        provider = AiToolkitUiProvider("X:/toolkit", server)
        job_id = "job-running-cancel"
        request = make_request(sample_prompts=[])
        gen = provider.start_training(
            request, config_path=None, gpu_id=0, job_id=job_id
        )

        async def drive():
            async for item in gen:
                if item.log_lines and item.log_lines[-1] == (
                    "Waiting for worker to pick up job..."
                ):
                    break
            # Simulate the worker having actually claimed the row.
            api.job_row["status"] = "running"
            api.job_row["pid"] = 4242

            await provider.cancel_training(job_id)
            return [item async for item in gen]

        remaining = asyncio.run(drive())

        assert remaining == []
        assert ("GET", f"/api/jobs/{api.job_id}/stop") in api.calls
        assert ("GET", f"/api/jobs/{api.job_id}/mark_stopped") not in api.calls
        # The fake's /stop mirrors the real route: a pid means it flips
        # status to 'stopped' itself, no mark_stopped needed.
        assert api.job_row["status"] == "stopped"
