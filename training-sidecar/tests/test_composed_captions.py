"""Tests for run-scoped composed caption files.

Covers the module itself (what gets written, what is deliberately left alone,
and the two cleanup paths) and the two providers that consume it — the point
being that a hybrid project trains on the half the run asked for instead of on
the raw `tags, __, prose` string.
"""

import asyncio
from pathlib import Path

import pytest

from composed_captions import (
    EXTENSION_PREFIX,
    cleanup_run,
    compose_folder,
    extension_for_job,
    sweep_orphans,
)
from models import DatasetEntry, ProviderType, StartJobRequest
from providers.kohya import KohyaProvider
from providers.musubi import MusubiProvider

HYBRID = "1girl, cyberpunk, __, A cyberpunk girl looks at the camera."
TAGS_ONLY = "1girl, solo, outdoors"


def write_dataset(folder: Path, captions: dict[str, str]) -> Path:
    """A dataset folder of `<name>.jpg` + `<name>.txt` pairs."""
    folder.mkdir(parents=True, exist_ok=True)
    for name, caption in captions.items():
        (folder / f"{name}.jpg").write_bytes(b"not-really-a-jpeg")
        (folder / f"{name}.txt").write_text(caption, encoding="utf-8")
    return folder


# --------------------------------------------------------------------------
# What gets written
# --------------------------------------------------------------------------


class TestComposeFolder:
    def test_non_hybrid_folder_is_left_alone(self, tmp_path):
        """The whole feature has to be inert for a tags-only project."""
        folder = write_dataset(tmp_path / "ds", {"a": TAGS_ONLY, "b": TAGS_ONLY})

        assert compose_folder(str(folder), "tags", "job1") is None
        assert not list(folder.glob(f"*{EXTENSION_PREFIX}*"))

    def test_tags_emission_drops_the_delimiter_and_the_prose(self, tmp_path):
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})

        result = compose_folder(str(folder), "tags", "job1")

        assert result.written == 1
        assert result.changed == 1
        composed = (folder / f"a{extension_for_job('job1')}").read_text(
            encoding="utf-8"
        )
        assert composed.strip() == "1girl, cyberpunk"
        assert "__" not in composed

    def test_natural_emission_keeps_only_the_prose(self, tmp_path):
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})

        compose_folder(str(folder), "natural", "job1")

        composed = (folder / f"a{extension_for_job('job1')}").read_text(
            encoding="utf-8"
        )
        assert composed.strip() == "A cyberpunk girl looks at the camera."

    def test_both_emission_joins_the_halves_with_one_separator(self, tmp_path):
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})

        compose_folder(str(folder), "both", "job1")

        composed = (folder / f"a{extension_for_job('job1')}").read_text(
            encoding="utf-8"
        )
        assert composed.strip() == (
            "1girl, cyberpunk, A cyberpunk girl looks at the camera."
        )

    def test_mixed_folder_copies_the_non_hybrid_captions_verbatim(self, tmp_path):
        """The extension override is per folder, so every caption needs a file.

        Skipping the plain ones would train them on an empty caption under
        sd-scripts and drop them from the dataset under musubi.
        """
        folder = write_dataset(
            tmp_path / "ds", {"hybrid": HYBRID, "plain": TAGS_ONLY}
        )

        result = compose_folder(str(folder), "tags", "job1")

        extension = extension_for_job("job1")
        assert result.written == 2
        assert result.changed == 1
        assert (folder / f"plain{extension}").read_text(
            encoding="utf-8"
        ).strip() == TAGS_ONLY

    def test_empty_half_is_counted_and_left_without_a_file(self, tmp_path):
        """sd-scripts asserts a caption file is non-empty; an empty one kills the run."""
        folder = write_dataset(
            tmp_path / "ds", {"a": HYBRID, "uncaptioned": "1girl, solo, __, "}
        )

        result = compose_folder(str(folder), "natural", "job1")

        assert result.emptied == 1
        assert result.written == 1
        assert not (folder / f"uncaptioned{extension_for_job('job1')}").exists()

    def test_canonical_txt_is_never_written(self, tmp_path):
        """The tagging UI owns the `.txt` and it is the only copy."""
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})

        compose_folder(str(folder), "tags", "job1")

        assert (folder / "a.txt").read_text(encoding="utf-8") == HYBRID

    def test_no_emission_composes_nothing(self, tmp_path):
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})

        assert compose_folder(str(folder), None, "job1") is None
        assert not list(folder.glob(f"*{EXTENSION_PREFIX}*"))

    def test_extension_is_a_single_suffix(self, tmp_path):
        """musubi matches captions to images with `splitext`, which strips one
        suffix only — a `.attribic-<id>.txt` would match no image and silently
        empty the dataset (dataset/media_utils.py:glob_images)."""
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})
        compose_folder(str(folder), "tags", "job1")

        composed = next(folder.glob(f"*{EXTENSION_PREFIX}*"))
        assert composed.stem == "a"
        assert composed.suffix == extension_for_job("job1")


# --------------------------------------------------------------------------
# Cleanup
# --------------------------------------------------------------------------


class TestCleanup:
    def test_cleanup_removes_only_this_run(self, tmp_path):
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})
        compose_folder(str(folder), "tags", "mine")
        compose_folder(str(folder), "natural", "theirs")

        assert cleanup_run([str(folder)], "mine") == 1
        assert not (folder / f"a{extension_for_job('mine')}").exists()
        assert (folder / f"a{extension_for_job('theirs')}").exists()
        assert (folder / "a.txt").exists()

    def test_sweep_spares_live_runs(self, tmp_path):
        """A long run and a stale file look identical on disk, so the live job
        set is the only safe discriminator."""
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})
        compose_folder(str(folder), "tags", "running")
        compose_folder(str(folder), "tags", "killed")

        assert sweep_orphans([str(folder)], {"running"}) == 1
        assert (folder / f"a{extension_for_job('running')}").exists()
        assert not (folder / f"a{extension_for_job('killed')}").exists()

    def test_sweep_ignores_the_users_own_files(self, tmp_path):
        folder = write_dataset(tmp_path / "ds", {"a": HYBRID})
        decoy = folder / "holiday.attribic-notes.jpg"
        decoy.write_bytes(b"not ours")

        assert sweep_orphans([str(folder)], set()) == 0
        assert decoy.exists()
        assert (folder / "a.txt").exists()


# --------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------


def make_request(tmp_path: Path, provider: ProviderType, datasets) -> StartJobRequest:
    model_paths = {
        "checkpoint": str(tmp_path / "dit.safetensors"),
        "vae": str(tmp_path / "vae.safetensors"),
        "qwen": str(tmp_path / "te.safetensors"),
    }
    return StartJobRequest(
        project_path=str(tmp_path),
        provider=provider,
        base_model="zimage" if provider is ProviderType.MUSUBI else "sdxl",
        output_path=str(tmp_path / "loras"),
        output_name="demo",
        datasets=datasets,
        hyperparameters={"model_paths": model_paths},
    )


class TestKohyaConfig:
    """SDXL and Anima route through Kohya, and both prefer a tag emission —
    the exact case where a raw hybrid caption is worst."""

    def generate(self, tmp_path, datasets, job_id="job1"):
        provider = KohyaProvider("nonexistent-scripts-path")
        request = make_request(tmp_path, ProviderType.KOHYA, datasets)
        path = asyncio.run(
            provider.generate_config(request, str(tmp_path), job_id)
        )
        return Path(path).read_text(encoding="utf-8")

    def test_hybrid_subset_points_at_the_composed_captions(self, tmp_path):
        folder = write_dataset(tmp_path / "hybrid", {"a": HYBRID})
        toml = self.generate(
            tmp_path,
            [DatasetEntry(path=str(folder), caption_emission="tags")],
        )

        assert f'caption_extension = "{extension_for_job("job1")}"' in toml

    def test_non_hybrid_subset_keeps_the_inherited_txt(self, tmp_path):
        folder = write_dataset(tmp_path / "plain", {"a": TAGS_ONLY})
        toml = self.generate(
            tmp_path,
            [DatasetEntry(path=str(folder), caption_emission="tags")],
        )

        # Only the [general] default, no per-subset override.
        assert toml.count("caption_extension") == 1
        assert 'caption_extension = ".txt"' in toml

    def test_only_the_hybrid_subset_is_overridden(self, tmp_path):
        hybrid = write_dataset(tmp_path / "hybrid", {"a": HYBRID})
        plain = write_dataset(tmp_path / "plain", {"b": TAGS_ONLY})
        toml = self.generate(
            tmp_path,
            [
                DatasetEntry(path=str(plain), caption_emission="tags"),
                DatasetEntry(path=str(hybrid), caption_emission="tags"),
            ],
        )

        subsets = toml.split("[[datasets.subsets]]")
        assert "caption_extension" not in subsets[1]
        assert extension_for_job("job1") in subsets[2]


class TestMusubiConfig:
    @pytest.fixture
    def provider(self, tmp_path: Path) -> MusubiProvider:
        p = MusubiProvider("nonexistent-musubi-path")
        p._cache_root = tmp_path / "musubi-cache"
        return p

    def generate(self, provider, tmp_path, datasets, job_id="job1"):
        config_dir = tmp_path / "config"
        config_dir.mkdir(exist_ok=True)
        request = make_request(tmp_path, ProviderType.MUSUBI, datasets)
        path = asyncio.run(
            provider.generate_config(request, str(config_dir), job_id)
        )
        return Path(path).read_text(encoding="utf-8")

    def test_hybrid_dataset_points_at_the_composed_captions(
        self, provider, tmp_path
    ):
        folder = write_dataset(tmp_path / "hybrid", {"a": HYBRID})
        toml = self.generate(
            provider,
            tmp_path,
            [DatasetEntry(path=str(folder), caption_emission="natural")],
        )

        assert f'caption_extension = "{extension_for_job("job1")}"' in toml

    def test_emission_splits_the_text_encoder_cache(self, provider, tmp_path):
        """The TE cache is computed from the captions, so two emissions over one
        folder must not share a cache directory."""
        folder = write_dataset(tmp_path / "hybrid", {"a": HYBRID})

        natural = self.generate(
            provider,
            tmp_path,
            [DatasetEntry(path=str(folder), caption_emission="natural")],
        )
        tags = self.generate(
            provider,
            tmp_path,
            [DatasetEntry(path=str(folder), caption_emission="tags")],
            job_id="job2",
        )

        def cache_dir(toml: str) -> str:
            line = next(
                ln for ln in toml.splitlines() if ln.startswith("cache_directory")
            )
            return line.split("=", 1)[1].strip()

        assert cache_dir(natural) != cache_dir(tags)

    def test_non_hybrid_dataset_keeps_its_existing_cache(
        self, provider, tmp_path
    ):
        """The emission joins the fingerprint only where it changed something —
        otherwise every existing project would silently re-cache."""
        folder = write_dataset(tmp_path / "plain", {"a": TAGS_ONLY})

        with_emission = self.generate(
            provider,
            tmp_path,
            [DatasetEntry(path=str(folder), caption_emission="natural")],
        )
        without = self.generate(
            provider,
            tmp_path,
            [DatasetEntry(path=str(folder), caption_emission=None)],
            job_id="job2",
        )

        assert with_emission == without
