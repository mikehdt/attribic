"""Tests for the musubi-tuner provider: dataset TOML generation, cache-dir
fingerprinting, CLI translation, and the sample-prompt grammar (CFG via `--l`
for most archs, `--g` for Flux.2).

The subprocess/log state machine is the shared `SdScriptsProvider` machinery
already covered by test_log_parsing.py; these tests cover only what the
musubi subclass adds or does differently from the Kohya provider.
"""

import asyncio
import json
from pathlib import Path

import pytest

from models import DatasetEntry, ProviderType, StartJobRequest
from providers.musubi import MusubiProvider


@pytest.fixture
def provider(tmp_path: Path) -> MusubiProvider:
    # The scripts path is only touched by validate_environment/_train_command.
    p = MusubiProvider("nonexistent-musubi-path")
    p._cache_root = tmp_path / "musubi-cache"
    return p


def make_request(
    tmp_path: Path,
    hyperparameters: dict = None,
    datasets: list[DatasetEntry] = None,
    sample_prompts=(),
    base_model: str = "zimage",
    vae_key: str = "vae",
) -> StartJobRequest:
    hp = {
        "model_paths": {
            "checkpoint": str(tmp_path / "dit.safetensors"),
            vae_key: str(tmp_path / "vae.safetensors"),
            "qwen": str(tmp_path / "te.safetensors"),
        },
    }
    hp.update(hyperparameters or {})
    return StartJobRequest(
        project_path=str(tmp_path),
        provider=ProviderType.MUSUBI,
        base_model=base_model,
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
    def test_musubi_toml_shape(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"resolution": [768, 1024], "batch_size": 2}
        )
        toml = generate_toml(provider, request, tmp_path)

        assert '[general]' in toml
        assert 'caption_extension = ".txt"' in toml
        # Scalar resolution: the largest chosen size.
        assert "resolution = 1024" in toml
        assert "batch_size = 2" in toml
        assert "enable_bucket = true" in toml
        assert "[[datasets]]" in toml
        assert "image_directory =" in toml
        assert "cache_directory =" in toml
        assert "num_repeats = 5" in toml
        # sd-scripts-only shapes must never appear — musubi's strict TOML
        # parser rejects unknown keys.
        assert "[[datasets.subsets]]" not in toml
        assert "image_dir =" not in toml

    def test_caption_augmentation_keys_dropped(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            datasets=[
                DatasetEntry(
                    path=str(tmp_path / "imgs"),
                    num_repeats=1,
                    caption_shuffling=True,
                    keep_tokens=2,
                    caption_dropout_rate=0.1,
                    flip_augment=True,
                    is_regularization=True,
                )
            ],
        )
        toml = generate_toml(provider, request, tmp_path)
        for key in (
            "shuffle_caption",
            "keep_tokens",
            "caption_dropout_rate",
            "flip_aug",
            "is_reg",
        ):
            assert key not in toml

    def test_native_resolution_disables_bucketing(self, provider, tmp_path):
        request = make_request(tmp_path, {"native_resolution": "1280x768"})
        toml = generate_toml(provider, request, tmp_path)
        assert "resolution = [1280, 768]" in toml
        assert "enable_bucket = false" in toml
        assert "bucket_no_upscale" not in toml

    def test_bucket_no_upscale_flows_through(self, provider, tmp_path):
        request = make_request(tmp_path, {"bucket_no_upscale": True})
        toml = generate_toml(provider, request, tmp_path)
        assert "bucket_no_upscale = true" in toml


# --------------------------------------------------------------------------
# Cache fingerprinting
# --------------------------------------------------------------------------


class TestCacheFingerprint:
    def cache_dir_of(self, provider, request, tmp_path) -> str:
        toml = generate_toml(provider, request, tmp_path)
        for line in toml.splitlines():
            if line.startswith("cache_directory"):
                return line
        raise AssertionError("no cache_directory in generated TOML")

    def test_same_settings_reuse_the_dir(self, provider, tmp_path):
        a = self.cache_dir_of(provider, make_request(tmp_path), tmp_path)
        b = self.cache_dir_of(provider, make_request(tmp_path), tmp_path)
        assert a == b

    def test_settings_changes_get_a_fresh_dir(self, provider, tmp_path):
        base = self.cache_dir_of(provider, make_request(tmp_path), tmp_path)
        for hp in (
            {"resolution": [768]},
            {"native_resolution": "1280x768"},
            {"bucket_no_upscale": True},
        ):
            changed = self.cache_dir_of(
                provider, make_request(tmp_path, hp), tmp_path
            )
            assert changed != base, f"{hp} should change the cache dir"

        # A different VAE file also invalidates.
        request = make_request(tmp_path)
        request.hyperparameters["model_paths"]["vae"] = str(
            tmp_path / "other-vae.safetensors"
        )
        assert self.cache_dir_of(provider, request, tmp_path) != base

    def test_resolution_list_dedups_to_effective_resolution(
        self, provider, tmp_path
    ):
        # generate_config only ever writes the single largest value from a
        # multi-resolution list into the TOML's `resolution` key (see
        # `max_res`) — so [512, 768, 1024] and [1024] produce byte-identical
        # latent/text-encoder caches and must share one cache dir, not two.
        # Fingerprinting the full requested list (as this used to) gave them
        # separate directories despite that, duplicating multi-GB caches.
        base = self.cache_dir_of(provider, make_request(tmp_path), tmp_path)
        multi = self.cache_dir_of(
            provider,
            make_request(tmp_path, {"resolution": [512, 768, 1024]}),
            tmp_path,
        )
        assert multi == base

        # A multi-value list whose *effective* (largest) resolution actually
        # differs must still get its own dir.
        different_max = self.cache_dir_of(
            provider,
            make_request(tmp_path, {"resolution": [512, 768]}),
            tmp_path,
        )
        assert different_max != base

    def test_each_dataset_gets_its_own_dir(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            datasets=[
                DatasetEntry(path=str(tmp_path / "a")),
                DatasetEntry(path=str(tmp_path / "b")),
            ],
        )
        toml = generate_toml(provider, request, tmp_path)
        dirs = [
            line for line in toml.splitlines()
            if line.startswith("cache_directory")
        ]
        assert len(dirs) == 2
        assert dirs[0] != dirs[1]

    def test_manifest_written(self, provider, tmp_path):
        generate_toml(provider, make_request(tmp_path), tmp_path)
        manifests = list(provider.cache_root.rglob("cache-manifest.json"))
        assert len(manifests) == 1
        recorded = json.loads(manifests[0].read_text(encoding="utf-8"))
        assert recorded["arch"] == "zimage"
        assert recorded["dataset"] == str(tmp_path / "imgs")


# --------------------------------------------------------------------------
# CLI translation
# --------------------------------------------------------------------------


class TestBuildCliArgs:
    def test_component_flags(self, provider, tmp_path):
        args = build_args(provider, make_request(tmp_path), tmp_path)
        assert f"--dit={tmp_path / 'dit.safetensors'}" in args
        assert f"--vae={tmp_path / 'vae.safetensors'}" in args
        assert f"--text_encoder={tmp_path / 'te.safetensors'}" in args

    def test_flow_matching_defaults(self, provider, tmp_path):
        args = build_args(provider, make_request(tmp_path), tmp_path)
        assert "--timestep_sampling=shift" in args
        assert "--weighting_scheme=none" in args
        # _num drops the trailing .0 — argparse parses "2" as float fine.
        assert "--discrete_flow_shift=2" in args
        assert "--network_module=networks.lora_zimage" in args

    def test_always_on_flags(self, provider, tmp_path):
        args = build_args(provider, make_request(tmp_path), tmp_path)
        assert "--sdpa" in args
        assert "--persistent_data_loader_workers" in args
        assert "--max_data_loader_n_workers=2" in args
        # Musubi's own default save precision is fp32 — ours must be explicit.
        assert "--save_precision=bf16" in args

    def test_sd_scripts_only_flags_absent(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"min_snr_gamma": 5, "noise_offset": 0.05}
        )
        args = build_args(provider, request, tmp_path)
        joined = " ".join(args)
        for flag in (
            "--console_log_simple",
            "--train_batch_size",
            "--save_model_as",
            "--cache_latents",
            "--min_snr_gamma",
            "--noise_offset",
            "--sample_sampler",
            "--network_train_unet_only",
            "--no_half_vae",
        ):
            assert flag not in joined

    def test_fp8_flags(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {
                "transformer_quantization": "float8",
                "text_encoder_quantization": "float8",
            },
        )
        args = build_args(provider, request, tmp_path)
        assert "--fp8_base" in args
        assert "--fp8_scaled" in args
        assert "--fp8_llm" in args

        off = build_args(provider, make_request(tmp_path), tmp_path)
        assert "--fp8_base" not in off
        assert "--fp8_llm" not in off

    def test_blocks_to_swap(self, provider, tmp_path):
        request = make_request(tmp_path, {"blocks_to_swap": 20})
        args = build_args(provider, request, tmp_path)
        assert "--blocks_to_swap=20" in args
        # Frozen-base LoRA training always gets the fast swap flavour:
        # pinned CPU memory + H2D-only streaming (checkpointing is on by
        # default, which h2d_only requires).
        assert "--use_pinned_memory_for_block_swap" in args
        assert "--block_swap_h2d_only" in args
        assert "--blocks_to_swap=0" not in build_args(
            provider, make_request(tmp_path), tmp_path
        )

    def test_block_swap_flags_absent_without_swap(self, provider, tmp_path):
        args = build_args(provider, make_request(tmp_path), tmp_path)
        assert "--use_pinned_memory_for_block_swap" not in args
        assert "--block_swap_h2d_only" not in args

    def test_h2d_only_requires_gradient_checkpointing(self, provider, tmp_path):
        # musubi raises when h2d_only is passed without checkpointing, so the
        # builder must drop it (pinned plain swap remains).
        request = make_request(
            tmp_path, {"blocks_to_swap": 20, "gradient_checkpointing": False}
        )
        args = build_args(provider, request, tmp_path)
        assert "--use_pinned_memory_for_block_swap" in args
        assert "--block_swap_h2d_only" not in args

    def test_save_cadence_and_retention(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"save_every_n_steps": 250, "max_saves_to_keep": 4}
        )
        args = build_args(provider, request, tmp_path)
        assert "--save_every_n_steps=250" in args
        # Step-unit window is interval x count (sd-scripts semantics).
        assert "--save_last_n_steps=1000" in args

        request = make_request(
            tmp_path, {"save_every_n_epochs": 1, "max_saves_to_keep": 3}
        )
        args = build_args(provider, request, tmp_path)
        assert "--save_every_n_epochs=1" in args
        assert "--save_last_n_epochs=3" in args

    def test_epoch_duration_mode(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"duration_mode": "epochs", "epochs": 16, "steps": 999}
        )
        args = build_args(provider, request, tmp_path)
        assert "--max_train_epochs=16" in args
        assert not any(a.startswith("--max_train_steps") for a in args)

    def test_weight_decay_merges_into_optimizer_args(self, provider, tmp_path):
        request = make_request(tmp_path, {"weight_decay": 0.01})
        args = build_args(provider, request, tmp_path)
        idx = args.index("--optimizer_args")
        assert args[idx + 1] == "weight_decay=0.01"


class TestNewArchitectures:
    """Per-arch quirks of the entries beyond Z-Image: fp8 flag names,
    --model_version wiring, and the Flux.2 ae→--vae component mapping."""

    def test_krea2_args(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {
                "transformer_quantization": "float8",
                "text_encoder_quantization": "float8",
            },
            base_model="krea2",
        )
        args = build_args(provider, request, tmp_path)
        assert "--network_module=networks.lora_krea2" in args
        assert "--timestep_sampling=shift" in args
        assert "--discrete_flow_shift=2.5" in args
        # DiT fp8 works; the krea2 scripts have no TE fp8 flag at all.
        assert "--fp8_base" in args and "--fp8_scaled" in args
        joined = " ".join(args)
        assert "--fp8_llm" not in joined
        assert "--fp8_vl" not in joined
        assert "--fp8_text_encoder" not in joined
        assert "--model_version" not in joined

    def test_qwen_image_args(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {"text_encoder_quantization": "float8"},
            base_model="qwen-image",
        )
        args = build_args(provider, request, tmp_path)
        assert "--network_module=networks.lora_qwen_image" in args
        assert "--fp8_vl" in args
        assert "--fp8_llm" not in " ".join(args)

    def test_flux2_args(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {"text_encoder_quantization": "float8"},
            base_model="flux2-klein-base-4b",
            vae_key="ae",
        )
        args = build_args(provider, request, tmp_path)
        assert "--network_module=networks.lora_flux_2" in args
        assert "--model_version=klein-base-4b" in args
        assert "--timestep_sampling=flux2_shift" in args
        assert "--fp8_text_encoder" in args
        # The app catalogues the Flux.2 autoencoder under `ae`; musubi's flag
        # for it is --vae.
        assert f"--vae={tmp_path / 'vae.safetensors'}" in args

    def test_flux2_blocks_to_swap_capped(self, provider, tmp_path):
        for name in ("dit.safetensors", "vae.safetensors", "te.safetensors"):
            (tmp_path / name).write_bytes(b"")
        request = make_request(
            tmp_path,
            {"blocks_to_swap": 17},
            base_model="flux2-klein-base-9b",
            vae_key="ae",
        )
        errors = provider.validate_request(request)
        assert any("16" in e for e in errors)


# --------------------------------------------------------------------------
# Sample prompts
# --------------------------------------------------------------------------


class TestSampleArgs:
    def _prompt_line(self, provider, request, tmp_path, model_def=None):
        args = provider._sample_args(
            request, str(tmp_path), model_def or {"train_defaults": {}}
        )
        prompt_file = next(
            a.split("=", 1)[1] for a in args if a.startswith("--sample_prompts=")
        )
        return Path(prompt_file).read_text(encoding="utf-8")

    def test_guidance_flag_is_l(self, provider, tmp_path):
        # Musubi samplers read CFG from `--l` (they parse `--g` but ignore it
        # for every arch except Flux.2).
        request = make_request(
            tmp_path,
            {"guidance_scale": 4, "sample_steps": 24, "resolution": [1024]},
            sample_prompts=["a cat"],
        )
        line = self._prompt_line(provider, request, tmp_path)
        assert "--l 4" in line
        assert "--g " not in line
        assert "--w 1024" in line and "--h 1024" in line
        assert "--s 24" in line
        # Frame count is video-only; never emitted for image archs.
        assert "--f " not in line

    def test_flux2_guidance_flag_is_g(self, provider, tmp_path):
        from providers.musubi import _find_model

        request = make_request(
            tmp_path,
            {"guidance_scale": 4},
            sample_prompts=["a cat"],
            base_model="flux2-klein-base-9b",
            vae_key="ae",
        )
        line = self._prompt_line(
            provider, request, tmp_path, _find_model("flux2-klein-base-9b")
        )
        assert "--g 4" in line
        assert "--l " not in line

    def test_user_guidance_wins(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"guidance_scale": 4}, sample_prompts=["a cat --l 7"]
        )
        line = self._prompt_line(provider, request, tmp_path)
        assert line.count("--l ") == 1
        assert "--l 7" in line

    def test_krea2_default_negative_injected(self, provider, tmp_path):
        from providers.musubi import _find_model

        request = make_request(
            tmp_path,
            sample_prompts=["a cat", "a dog --n my own negative"],
            base_model="krea2",
        )
        line = self._prompt_line(
            provider, request, tmp_path, _find_model("krea2")
        )
        lines = line.splitlines()
        # Krea 2 only runs CFG when a negative prompt exists; the provider
        # injects a generic one where the prompt has none.
        assert "--n low quality, blurry" in lines[0]
        # A user-supplied negative is left alone.
        assert "--n my own negative" in lines[1]
        assert "low quality, blurry" not in lines[1]

    def test_qwen_image_flow_shift_emitted(self, provider, tmp_path):
        from providers.musubi import _find_model

        request = make_request(
            tmp_path,
            {"discrete_flow_shift": 2.2},
            sample_prompts=["a cat"],
            base_model="qwen-image",
        )
        line = self._prompt_line(
            provider, request, tmp_path, _find_model("qwen-image")
        )
        # Qwen-Image's sampler falls back to flow shift 14.5 without --fs.
        assert "--fs 2.2" in line
        # Other archs don't emit it (their samplers ignore or self-derive it).
        zline = self._prompt_line(
            provider, make_request(tmp_path, sample_prompts=["a cat"]), tmp_path
        )
        assert "--fs " not in zline

    def test_cadence_step_value_passes_through(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {"sample_every_n_steps": 100},
            sample_prompts=["a cat"],
        )
        args = provider._sample_args(
            request, str(tmp_path), {"train_defaults": {}}
        )
        assert "--sample_every_n_steps=100" in args

    def test_zero_cadence_omits_flag_rather_than_fabricating_one(
        self, provider, tmp_path
    ):
        # A 0/0 cadence used to fall back to a fabricated
        # --sample_every_n_steps=250 — a schedule the UI's predictor
        # (deriveSampleSteps/predict_sample_steps) never showed the user, and
        # which would crash musubi outright if 0 were ever passed through
        # literally (should_sample_images does steps % sample_every_n_steps
        # with no <=0 guard). Omitting both flags matches the predictor's "no
        # samples" prediction and can never divide by zero.
        request = make_request(tmp_path, sample_prompts=["a cat"])
        args = provider._sample_args(
            request, str(tmp_path), {"train_defaults": {}}
        )
        joined = " ".join(args)
        assert "--sample_every_n_steps" not in joined
        assert "--sample_every_n_epochs" not in joined


# --------------------------------------------------------------------------
# Request validation
# --------------------------------------------------------------------------


class TestValidateRequest:
    def touch_components(self, tmp_path):
        for name in ("dit.safetensors", "vae.safetensors", "te.safetensors"):
            (tmp_path / name).write_bytes(b"")

    def test_valid_request_passes(self, provider, tmp_path):
        self.touch_components(tmp_path)
        assert provider.validate_request(make_request(tmp_path)) == []

    def test_unsupported_optimizer_rejected(self, provider, tmp_path):
        self.touch_components(tmp_path)
        request = make_request(tmp_path, {"optimizer": "prodigy"})
        errors = provider.validate_request(request)
        assert any("prodigy" in e for e in errors)

    def test_blocks_to_swap_capped(self, provider, tmp_path):
        self.touch_components(tmp_path)
        request = make_request(tmp_path, {"blocks_to_swap": 29})
        errors = provider.validate_request(request)
        assert any("28" in e for e in errors)

    def test_missing_component_reported(self, provider, tmp_path):
        request = make_request(tmp_path)
        del request.hyperparameters["model_paths"]["qwen"]
        # The other two exist on disk; the TE is neither sent nor on disk.
        self.touch_components(tmp_path)
        errors = provider.validate_request(request)
        assert any("Qwen3 text encoder" in e for e in errors)

    def test_nonexistent_component_path_reported(self, provider, tmp_path):
        # Paths are set but no files were created.
        errors = provider.validate_request(make_request(tmp_path))
        assert any("does not exist" in e for e in errors)
