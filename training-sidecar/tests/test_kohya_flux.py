"""Tests for the Kohya provider's Flux.1 support: the four-component flag
mapping, flow-matching args, fp8 emission, and the sample-prompt guidance
grammar (`--g` embedded guidance instead of the SDXL family's `--l` CFG).
"""

from pathlib import Path

import pytest

from models import DatasetEntry, ProviderType, StartJobRequest
from providers.kohya import KohyaProvider, _find_model


@pytest.fixture
def provider() -> KohyaProvider:
    # The scripts path is only touched by validate_environment/_train_command.
    return KohyaProvider("nonexistent-sd-scripts-path")


def make_request(
    tmp_path: Path,
    hyperparameters: dict = None,
    sample_prompts=(),
    base_model: str = "flux-dev",
) -> StartJobRequest:
    hp = {
        "model_paths": {
            "checkpoint": str(tmp_path / "flux1-dev.safetensors"),
            "clip_l": str(tmp_path / "clip_l.safetensors"),
            "t5": str(tmp_path / "t5xxl.safetensors"),
            "ae": str(tmp_path / "ae.safetensors"),
        },
    }
    hp.update(hyperparameters or {})
    return StartJobRequest(
        project_path=str(tmp_path),
        provider=ProviderType.KOHYA,
        base_model=base_model,
        output_path=str(tmp_path / "loras"),
        output_name="demo",
        datasets=[DatasetEntry(path=str(tmp_path / "imgs"), num_repeats=5)],
        hyperparameters=hp,
        sample_prompts=list(sample_prompts),
    )


def build_args(provider, request, tmp_path: Path) -> list[str]:
    return provider._build_cli_args(request, "dataset.toml", str(tmp_path))


class TestFluxCliArgs:
    def test_component_flags(self, provider, tmp_path):
        args = build_args(provider, make_request(tmp_path), tmp_path)
        assert (
            f"--pretrained_model_name_or_path={tmp_path / 'flux1-dev.safetensors'}"
            in args
        )
        assert f"--clip_l={tmp_path / 'clip_l.safetensors'}" in args
        assert f"--t5xxl={tmp_path / 't5xxl.safetensors'}" in args
        assert f"--ae={tmp_path / 'ae.safetensors'}" in args

    def test_flow_matching_and_static_flags(self, provider, tmp_path):
        args = build_args(provider, make_request(tmp_path), tmp_path)
        assert "--network_module=networks.lora_flux" in args
        assert "--timestep_sampling=shift" in args
        assert "--discrete_flow_shift=3.1582" in args
        # Training-time embedded guidance must be 1.0 for dev; prediction raw.
        assert "--guidance_scale=1.0" in args
        assert "--model_prediction_type=raw" in args
        # DDPM-only flags stay out even if a stale config carries values.
        request = make_request(tmp_path, {"min_snr_gamma": 5, "noise_offset": 0.05})
        joined = " ".join(build_args(provider, request, tmp_path))
        assert "--min_snr_gamma" not in joined
        assert "--noise_offset" not in joined

    def test_fp8_mapping(self, provider, tmp_path):
        both = make_request(
            tmp_path,
            {
                "transformer_quantization": "float8",
                "text_encoder_quantization": "float8",
            },
        )
        args = build_args(provider, both, tmp_path)
        assert "--fp8_base" in args
        assert "--fp8_base_unet" not in args

        dit_only = make_request(
            tmp_path,
            {
                "transformer_quantization": "float8",
                "text_encoder_quantization": "none",
            },
        )
        args = build_args(provider, dit_only, tmp_path)
        assert "--fp8_base_unet" in args
        assert "--fp8_base" not in args

        off = make_request(tmp_path, {"transformer_quantization": "none"})
        assert "--fp8" not in " ".join(build_args(provider, off, tmp_path))

    def test_sdxl_never_gets_fp8(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {
                "transformer_quantization": "float8",
                "text_encoder_quantization": "float8",
                "model_paths": {
                    "checkpoint": str(tmp_path / "sdxl.safetensors")
                },
            },
            base_model="sdxl",
        )
        assert "--fp8" not in " ".join(build_args(provider, request, tmp_path))

    def test_blocks_to_swap(self, provider, tmp_path):
        request = make_request(tmp_path, {"blocks_to_swap": 22})
        assert "--blocks_to_swap=22" in build_args(provider, request, tmp_path)

    def test_blocks_to_swap_capped(self, provider, tmp_path):
        for name in (
            "flux1-dev.safetensors",
            "clip_l.safetensors",
            "t5xxl.safetensors",
            "ae.safetensors",
        ):
            (tmp_path / name).write_bytes(b"")
        request = make_request(tmp_path, {"blocks_to_swap": 36})
        errors = provider.validate_request(request)
        assert any("35" in e for e in errors)


class TestFluxSampleArgs:
    def _prompt_line_and_args(self, provider, request, tmp_path):
        model_def = _find_model(request.base_model)
        args = provider._sample_args(request, str(tmp_path), model_def)
        prompt_file = next(
            a.split("=", 1)[1] for a in args if a.startswith("--sample_prompts=")
        )
        return Path(prompt_file).read_text(encoding="utf-8"), args

    def test_guidance_flag_is_g_and_sampler_absent(self, provider, tmp_path):
        request = make_request(
            tmp_path, {"guidance_scale": 4}, sample_prompts=["a cat"]
        )
        line, args = self._prompt_line_and_args(provider, request, tmp_path)
        # Flux prompt lines carry embedded guidance as --g; --l (real CFG)
        # stays absent so it defaults off.
        assert "--g 4" in line
        assert "--l " not in line
        # flux_train_network ignores --sample_sampler (hard-wired Euler).
        assert not any(a.startswith("--sample_sampler") for a in args)

    def test_sdxl_still_gets_sampler_and_l(self, provider, tmp_path):
        request = make_request(
            tmp_path,
            {
                "guidance_scale": 7,
                "model_paths": {
                    "checkpoint": str(tmp_path / "sdxl.safetensors")
                },
            },
            sample_prompts=["a cat"],
            base_model="sdxl",
        )
        line, args = self._prompt_line_and_args(provider, request, tmp_path)
        assert "--l 7" in line
        assert any(a.startswith("--sample_sampler") for a in args)
