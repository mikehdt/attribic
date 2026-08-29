"""Tests for the Fizgig provider: dataset TOML generation, CLI translation,
the quantisation-value mapping, and the epoch-only validation rules.

The subprocess/log state machine is the shared `SdScriptsProvider` machinery
already covered by test_log_parsing.py; these tests cover only what the
Fizgig subclass adds or does differently from the musubi provider it is
modelled on — including its own preview-announce grammar, driven through the
real state machine via test_log_parsing's transcript harness.
"""

import asyncio
from pathlib import Path

import pytest

from models import DatasetEntry, ProviderType, StartJobRequest
from providers.fizgig import FizgigProvider
from providers.sd_scripts_base import SAMPLING_PHASE
from test_log_parsing import transcript_run


@pytest.fixture
def provider(tmp_path: Path) -> FizgigProvider:
    # The scripts path is only touched by validate_environment/_train_command.
    p = FizgigProvider("nonexistent-fizgig-path")
    p._cache_root = tmp_path / "fizgig-cache"
    return p


def make_request(
    tmp_path: Path,
    hyperparameters: dict = None,
    datasets: list[DatasetEntry] = None,
    sample_prompts=(),
    with_turbo_lora: bool = False,
) -> StartJobRequest:
    model_paths = {
        "checkpoint": str(tmp_path / "dit.safetensors"),
        "vae": str(tmp_path / "vae.safetensors"),
        "qwen": str(tmp_path / "te.safetensors"),
    }
    if with_turbo_lora:
        model_paths["turbo_lora"] = str(tmp_path / "turbo_lora.safetensors")
    hp = {"model_paths": model_paths, "duration_mode": "epochs", "epochs": 20}
    hp.update(hyperparameters or {})
    return StartJobRequest(
        project_path=str(tmp_path),
        provider=ProviderType.FIZGIG,
        base_model="krea2",
        output_path=str(tmp_path / "loras"),
        output_name="demo",
        datasets=datasets
        or [DatasetEntry(path=str(tmp_path / "imgs"), num_repeats=5)],
        hyperparameters=hp,
        sample_prompts=list(sample_prompts),
    )


def generate_toml(
    provider, request, tmp_path: Path, job_id: str = "job0"
) -> str:
    config_dir = tmp_path / "config"
    config_dir.mkdir(exist_ok=True)
    path = asyncio.run(
        provider.generate_config(request, str(config_dir), job_id)
    )
    return Path(path).read_text(encoding="utf-8")


def build_args(provider, request, tmp_path: Path) -> list[str]:
    return provider._build_cli_args(request, "dataset.toml", str(tmp_path))


# --------------------------------------------------------------------------
# Dataset TOML
# --------------------------------------------------------------------------


class TestGenerateConfig:
    def test_toml_shape(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"resolution": [768, 1024], "batch_size": 2}
        )
        toml = generate_toml(provider, request, tmp_path)

        assert "[general]" in toml
        assert 'caption_extension = ".txt"' in toml
        # Only the max of a multi-value resolution list is written.
        assert "resolution = 1024" in toml
        assert "batch_size = 2" in toml
        assert "enable_bucket = true" in toml
        assert "[[datasets]]" in toml
        assert "num_repeats = 5" in toml
        assert "cache_directory" in toml

    def test_native_resolution_pins_size_and_disables_bucketing(
        self, provider, tmp_path
    ):
        request = make_request(tmp_path, {"native_resolution": "1280x768"})
        toml = generate_toml(provider, request, tmp_path)
        assert "resolution = [1280, 768]" in toml
        assert "enable_bucket = false" in toml

    def test_cache_dir_fingerprint_changes_with_resolution(
        self, provider, tmp_path
    ):
        r1 = make_request(tmp_path, {"resolution": [1024]})
        r2 = make_request(tmp_path, {"resolution": [768]})
        t1 = generate_toml(provider, r1, tmp_path, "job1")
        t2 = generate_toml(provider, r2, tmp_path, "job2")

        def cache_of(toml):
            for line in toml.splitlines():
                if line.startswith("cache_directory"):
                    return line
            return None

        assert cache_of(t1) != cache_of(t2)


# --------------------------------------------------------------------------
# CLI translation
# --------------------------------------------------------------------------


class TestBuildCliArgs:
    def test_core_args(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {
                "network_dim": 16,
                "network_alpha": 8,
                "lr": 2e-4,
                "epochs": 30,
                "seed": 7,
            },
        )
        args = build_args(provider, request, tmp_path)
        assert "--max_train_epochs=30" in args
        assert "--network_dim=16" in args
        assert "--network_alpha=8" in args
        assert "--learning_rate=0.0002" in args
        assert "--seed=7" in args
        # Epoch-only backend: no step-based duration ever.
        assert not any(a.startswith("--max_train_steps") for a in args)
        # bf16 is hardcoded upstream — no precision flags.
        assert not any("precision" in a for a in args)

    def test_quantization_default_fp8_emits_nothing(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"transformer_quantization": "float8"}
        )
        args = build_args(provider, request, tmp_path)
        assert "--no_fp8" not in args
        assert not any(a.startswith("--quant_int8") for a in args)
        assert "--quantize_4bit" not in args

    def test_quantization_none_opts_out_of_fp8(self, provider, tmp_path):
        request = make_request(tmp_path, {"transformer_quantization": "none"})
        assert "--no_fp8" in build_args(provider, request, tmp_path)

    def test_quantization_int8_uses_exact_gradient_mode(
        self, provider, tmp_path
    ):
        request = make_request(tmp_path, {"transformer_quantization": "int8"})
        assert "--quant_int8=bf16" in build_args(provider, request, tmp_path)

    def test_quantization_nf4(self, provider, tmp_path):
        request = make_request(tmp_path, {"transformer_quantization": "nf4"})
        assert "--quantize_4bit" in build_args(provider, request, tmp_path)

    def test_lokr_network(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"network_type": "lokr", "lokr_factor": 4}
        )
        args = build_args(provider, request, tmp_path)
        assert "--network_type=lokr" in args
        assert "--lokr_factor=4" in args

    def test_standard_lora_omits_network_type(self, provider, tmp_path):
        request = make_request(tmp_path)
        args = build_args(provider, request, tmp_path)
        assert not any(a.startswith("--network_type") for a in args)

    def test_dotted_optimizer_maps_to_catalogue_name(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"optimizer": "bitsandbytes.optim.Lion8bit"}
        )
        assert "--optimizer_type=lion8bit" in build_args(
            provider, request, tmp_path
        )

    def test_warmup_gated_on_non_constant_scheduler(self, provider, tmp_path):
        constant = make_request(
            tmp_path, {"scheduler": "constant", "warmup_steps": 100}
        )
        assert not any(
            a.startswith("--lr_warmup_steps")
            for a in build_args(provider, constant, tmp_path)
        )
        cosine = make_request(
            tmp_path, {"scheduler": "cosine", "warmup_steps": 100}
        )
        assert "--lr_warmup_steps=100" in build_args(provider, cosine, tmp_path)

    def test_weight_decay_rides_optimizer_args(self, provider, tmp_path):
        request = make_request(tmp_path, {"weight_decay": 0.01})
        args = build_args(provider, request, tmp_path)
        assert "--optimizer_args=weight_decay=0.01" in args

    def test_user_optimizer_args_win_on_collision(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {"weight_decay": 0.01, "optimizer_args": "weight_decay=0.05"},
        )
        args = build_args(provider, request, tmp_path)
        assert "--optimizer_args=weight_decay=0.05" in args

    def test_save_state_maps_retention(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {
                "save_every_n_epochs": 5,
                "save_state": True,
                "max_saves_to_keep": 3,
            },
        )
        args = build_args(provider, request, tmp_path)
        assert "--save_every_n_epochs=5" in args
        assert "--save_state" in args
        assert "--save_state_on_train_end" in args
        assert "--keep_last_n_states=3" in args

    def test_blocks_to_swap(self, provider, tmp_path):
        request = make_request(tmp_path, {"blocks_to_swap": 10})
        assert "--blocks_to_swap=10" in build_args(provider, request, tmp_path)


# --------------------------------------------------------------------------
# Sample args
# --------------------------------------------------------------------------


class TestSampleArgs:
    def test_plain_prompt_file_and_turbo_lora(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {"sample_every_n_epochs": 2, "seed": 11},
            sample_prompts=["a portrait", "a landscape"],
            with_turbo_lora=True,
        )
        args = build_args(provider, request, tmp_path)
        prompt_arg = next(a for a in args if a.startswith("--sample_prompts="))
        content = Path(prompt_arg.split("=", 1)[1]).read_text(encoding="utf-8")
        # Plain prompts, one per line — no sd-scripts inline flags.
        assert content == "a portrait\na landscape"
        assert any(a.startswith("--turbo_lora=") for a in args)
        assert "--sample_every_n_epochs=2" in args
        assert "--sample_seed=11" in args

    def test_first_prompt_size_wins(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            sample_prompts=["one", "two"],
            with_turbo_lora=True,
        )
        request.sample_sizes = [[1216, 832], [832, 1216]]
        args = build_args(provider, request, tmp_path)
        assert "--sample_width=1216" in args
        assert "--sample_height=832" in args

    def test_sample_at_first(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {"sample_first_step": True},
            sample_prompts=["one"],
            with_turbo_lora=True,
        )
        assert "--sample_at_first" in build_args(provider, request, tmp_path)

    def test_sample_steps_forwarded_guidance_not(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {"sample_steps": 9, "guidance_scale": 5.5},
            sample_prompts=["one"],
            with_turbo_lora=True,
        )
        args = build_args(provider, request, tmp_path)
        assert "--sample_steps=9" in args
        # guidance_scale describes RAW-model CFG; the Turbo preview path is
        # CFG-free, so it must never become --sample_cfg_scale.
        assert not any(a.startswith("--sample_cfg_scale") for a in args)

    def test_no_sampling_emits_no_sample_flags(self, provider, tmp_path):
        request = make_request(tmp_path)
        args = build_args(provider, request, tmp_path)
        assert not any("sample" in a for a in args)
        assert not any("turbo" in a for a in args)


# --------------------------------------------------------------------------
# Preview-announce log grammar, through the real state machine
# --------------------------------------------------------------------------


class TestPreviewLogGrammar:
    def test_preview_pause_labels_and_counts_by_bar_restart(
        self, provider, tmp_path
    ):
        """Fizgig announces previews with its own wording and echoes no
        per-image "prompt:" blocks — the label comes from the announce
        pattern and the image count from its sampler bar restarting."""
        request = make_request(
            tmp_path, sample_prompts=["one", "two"], with_turbo_lora=True
        )
        out = transcript_run(
            provider,
            request,
            [
                "steps:  25%|██▌       | 1/4 [00:01<00:03,  1.00it/s, avr_loss=0.15]",
                "INFO:fizgig.krea2.trainer:rendering previews (epoch 1) on the training DiT + Turbo LoRA...",
                "sampling:  12%|█▎        | 1/8 [00:01<00:07,  1.00it/s]",
                "sampling: 100%|██████████| 8/8 [00:08<00:00,  1.00it/s]",
                "sampling:  12%|█▎        | 1/8 [00:01<00:07,  1.00it/s]",
                "sampling: 100%|██████████| 8/8 [00:08<00:00,  1.00it/s]",
                "steps:  50%|█████     | 2/4 [00:21<00:02,  1.00it/s, avr_loss=0.14]",
            ],
        )

        phases = [p.phase for p in out if p.phase]
        assert phases == [
            SAMPLING_PHASE,  # the announce opens the event
            f"{SAMPLING_PHASE} - 1/2",  # first image's bar starts
            f"{SAMPLING_PHASE} - 1/2",  # ... and finishes
            f"{SAMPLING_PHASE} - 2/2",  # bar restarts: second image
            f"{SAMPLING_PHASE} - 2/2",
        ]

        bars = [p.sample_progress for p in out if p.sample_progress]
        assert [(b.current, b.total) for b in bars] == [
            (1, 8),
            (8, 8),
            (1, 8),
            (8, 8),
        ]

        # The sampler's 8/8 bar must never be read as training progress.
        assert all(p.total_steps in (0, 4) for p in out)

        resumed = out[-2]
        assert resumed.phase is None and resumed.current_step == 2

    def test_sample_at_first_labels_the_preparing_phase(
        self, provider, tmp_path
    ):
        """The epoch-0 preview renders before the training bar exists, so its
        announce must label the preparing path instead."""
        request = make_request(
            tmp_path, sample_prompts=["one"], with_turbo_lora=True
        )
        out = transcript_run(
            provider,
            request,
            [
                "INFO:fizgig.krea2.trainer:rendering epoch-0 preview (Sample at Start, on training DiT)...",
                "sampling:  50%|█████     | 4/8 [00:04<00:04,  1.00it/s]",
            ],
        )
        preparing = [p for p in out if p.phase == SAMPLING_PHASE]
        assert preparing, "epoch-0 preview never got the sampling label"
        # The sampler's own bar draws determinate progress under the label.
        assert (preparing[-1].current_step, preparing[-1].total_steps) == (4, 8)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


def touch_model_paths(request: StartJobRequest) -> None:
    for path in request.hyperparameters["model_paths"].values():
        Path(path).write_bytes(b"")


class TestValidateRequest:
    def test_valid_request_passes(self, provider, tmp_path):
        request = make_request(tmp_path)
        touch_model_paths(request)
        assert provider.validate_request(request) == []

    def test_steps_mode_rejected(self, provider, tmp_path):
        request = make_request(tmp_path, {"duration_mode": "steps"})
        touch_model_paths(request)
        errors = provider.validate_request(request)
        assert any("epochs" in e for e in errors)

    def test_step_cadences_rejected(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"save_every_n_steps": 250, "sample_every_n_steps": 250}
        )
        touch_model_paths(request)
        errors = provider.validate_request(request)
        assert sum("epochs mode" in e for e in errors) == 2

    def test_unsupported_optimizer_rejected(self, provider, tmp_path):
        request = make_request(tmp_path, {"optimizer": "adafactor"})
        touch_model_paths(request)
        errors = provider.validate_request(request)
        assert any("adafactor" in e for e in errors)

    def test_sampling_without_turbo_lora_rejected(self, provider, tmp_path):
        request = make_request(tmp_path, sample_prompts=["a portrait"])
        touch_model_paths(request)
        errors = provider.validate_request(request)
        assert any("Turbo LoRA" in e for e in errors)

    def test_sampling_with_turbo_lora_passes(self, provider, tmp_path):
        request = make_request(
            tmp_path, sample_prompts=["a portrait"], with_turbo_lora=True
        )
        touch_model_paths(request)
        assert provider.validate_request(request) == []

    def test_blocks_to_swap_capped(self, provider, tmp_path):
        request = make_request(tmp_path, {"blocks_to_swap": 27})
        touch_model_paths(request)
        errors = provider.validate_request(request)
        assert any("at most 26" in e for e in errors)

    def test_missing_component_reported(self, provider, tmp_path):
        request = make_request(tmp_path)
        del request.hyperparameters["model_paths"]["vae"]
        touch_model_paths(request)
        errors = provider.validate_request(request)
        assert any("Qwen-Image VAE" in e for e in errors)
