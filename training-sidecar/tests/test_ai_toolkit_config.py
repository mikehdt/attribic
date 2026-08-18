"""Tests for the ai-toolkit ui_trainer config builder's model block —
specifically the `model_kwargs` path overrides (Krea 2's local TE/VAE
directories) and their interaction with the quantisation flags.

The job lifecycle / server plumbing around the builder is exercised
elsewhere; these tests call `_build_config_dict` directly.
"""

from models import DatasetEntry, ProviderType, StartJobRequest
from providers.ai_toolkit_ui import _build_config_dict


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
