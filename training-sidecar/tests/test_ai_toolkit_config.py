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


class TestSampleBlock:
    def test_neg_is_always_a_string(self):
        # SampleConfig defaults a missing `neg` to the bool False, which
        # crashes Krea 2's prompt encoder (string concat) when sample prompts
        # are pre-cached. The config must always carry a string.
        request = make_request(sample_prompts=["a test prompt"])
        process = _build_config_dict(request)["config"]["process"][0]
        assert process["sample"]["neg"] == ""
