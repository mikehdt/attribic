"""Tests for post-run cache clearing.

Covers the module's two sweeps (what counts as a cache file and what is left
alone) and each provider's `finish_run` — including the opt-out and the
concurrent-run guard, which are the two ways this is supposed to do nothing.
"""

import asyncio
from pathlib import Path

import pytest

from cache_cleanup import (
    AI_TOOLKIT_CACHE_DIRS,
    normalise,
    remove_tree,
    sweep_cache_dirs,
    sweep_image_sidecar_caches,
)
from models import DatasetEntry, ProviderType, StartJobRequest
from providers.ai_toolkit_ui import AiToolkitUiProvider
from providers.kohya import KohyaProvider
from providers.musubi import MusubiProvider


def write_images(folder: Path, names: list[str]) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    for name in names:
        (folder / f"{name}.jpg").write_bytes(b"not-really-a-jpeg")
        (folder / f"{name}.txt").write_text("a caption", encoding="utf-8")
    return folder


def names_in(folder: Path) -> set[str]:
    return {p.name for p in folder.iterdir()}


# --------------------------------------------------------------------------
# sd-scripts: .npz beside the image
# --------------------------------------------------------------------------


class TestSweepImageSidecarCaches:
    def test_removes_every_strategy_suffix(self, tmp_path: Path):
        folder = write_images(tmp_path / "imgs", ["portrait-01"])
        # Latents (per-arch suffixes, plus the legacy bare-.npz strategy) and
        # text-encoder outputs, exactly as the sd-scripts strategies name them.
        for name in (
            "portrait-01_1024x1024_sdxl.npz",
            "portrait-01_0768x1024_flux.npz",
            "portrait-01_1024x1024_anima.npz",
            "portrait-01_1024x1024.npz",
            "portrait-01_te_outputs.npz",
            "portrait-01_anima_te.npz",
        ):
            (folder / name).write_bytes(b"cache")

        assert sweep_image_sidecar_caches(str(folder)) == 6
        assert names_in(folder) == {"portrait-01.jpg", "portrait-01.txt"}

    def test_leaves_unrelated_files_alone(self, tmp_path: Path):
        folder = write_images(tmp_path / "imgs", ["portrait-01"])
        (folder / "portrait-01_1024x1024_sdxl.npz").write_bytes(b"cache")
        # Not named after any image in the folder — someone else's file.
        (folder / "embeddings.npz").write_bytes(b"mine")
        (folder / "notes.txt").write_text("keep me", encoding="utf-8")

        assert sweep_image_sidecar_caches(str(folder)) == 1
        assert "embeddings.npz" in names_in(folder)
        assert "notes.txt" in names_in(folder)

    def test_stem_prefix_match_is_not_fooled_by_partial_names(
        self, tmp_path: Path
    ):
        # `portrait` is a prefix of `portrait-01` but not at an `_` boundary,
        # so a cache for an image that is no longer there stays put.
        folder = write_images(tmp_path / "imgs", ["portrait-01"])
        (folder / "portrait-02_1024x1024_sdxl.npz").write_bytes(b"cache")

        assert sweep_image_sidecar_caches(str(folder)) == 0

    def test_empty_or_missing_folder_is_a_no_op(self, tmp_path: Path):
        assert sweep_image_sidecar_caches(str(tmp_path / "nope")) == 0
        (tmp_path / "empty").mkdir()
        assert sweep_image_sidecar_caches(str(tmp_path / "empty")) == 0


# --------------------------------------------------------------------------
# ai-toolkit: per-directory cache folders
# --------------------------------------------------------------------------


class TestSweepCacheDirs:
    def test_removes_both_cache_folders(self, tmp_path: Path):
        folder = write_images(tmp_path / "imgs", ["a", "b"])
        for name in AI_TOOLKIT_CACHE_DIRS:
            cache = folder / name
            cache.mkdir()
            (cache / "a_hash.safetensors").write_bytes(b"cache")
            (cache / "b_hash.safetensors").write_bytes(b"cache")

        assert sweep_cache_dirs(str(folder)) == 4
        assert names_in(folder) == {"a.jpg", "a.txt", "b.jpg", "b.txt"}

    def test_absent_cache_folders_are_a_no_op(self, tmp_path: Path):
        folder = write_images(tmp_path / "imgs", ["a"])
        assert sweep_cache_dirs(str(folder)) == 0
        assert names_in(folder) == {"a.jpg", "a.txt"}

    def test_remove_tree_counts_nested_files(self, tmp_path: Path):
        root = tmp_path / "cache"
        (root / "nested").mkdir(parents=True)
        (root / "one.safetensors").write_bytes(b"x")
        (root / "nested" / "two.safetensors").write_bytes(b"x")

        assert remove_tree(root) == 2
        assert not root.exists()
        # Second call has nothing to do rather than raising.
        assert remove_tree(root) == 0


# --------------------------------------------------------------------------
# Provider hooks
# --------------------------------------------------------------------------


def kohya_request(folders: list[Path], hyperparameters: dict) -> StartJobRequest:
    return StartJobRequest(
        project_path=str(folders[0]),
        provider=ProviderType.KOHYA,
        base_model="sdxl",
        output_path=str(folders[0] / "loras"),
        output_name="demo",
        datasets=[DatasetEntry(path=str(f)) for f in folders],
        hyperparameters=hyperparameters,
    )


class TestKohyaFinishRun:
    def test_clears_when_asked(self, tmp_path: Path):
        folder = write_images(tmp_path / "imgs", ["a"])
        (folder / "a_1024x1024_sdxl.npz").write_bytes(b"cache")
        request = kohya_request([folder], {"clear_caches": True})

        provider = KohyaProvider("nonexistent-sd-scripts-path")
        assert provider.finish_run(request, "job0", True, set()) == 1

    def test_opting_out_leaves_the_cache(self, tmp_path: Path):
        folder = write_images(tmp_path / "imgs", ["a"])
        (folder / "a_1024x1024_sdxl.npz").write_bytes(b"cache")
        request = kohya_request([folder], {})

        provider = KohyaProvider("nonexistent-sd-scripts-path")
        assert provider.finish_run(request, "job0", False, set()) == 0
        assert "a_1024x1024_sdxl.npz" in names_in(folder)

    def test_folder_another_run_is_using_is_skipped(self, tmp_path: Path):
        mine = write_images(tmp_path / "mine", ["a"])
        shared = write_images(tmp_path / "shared", ["b"])
        (mine / "a_1024x1024_sdxl.npz").write_bytes(b"cache")
        (shared / "b_1024x1024_sdxl.npz").write_bytes(b"cache")
        request = kohya_request([mine, shared], {"clear_caches": True})

        provider = KohyaProvider("nonexistent-sd-scripts-path")
        removed = provider.finish_run(
            request, "job0", True, {normalise(str(shared))}
        )

        assert removed == 1
        assert "b_1024x1024_sdxl.npz" in names_in(shared)


class TestAiToolkitFinishRun:
    def make_provider(self) -> AiToolkitUiProvider:
        # finish_run never touches the UI server, so it can stay unbuilt.
        return AiToolkitUiProvider("nonexistent-toolkit-path", server=None)

    def make_request(self, folders: list[Path], hyperparameters: dict):
        return StartJobRequest(
            project_path=str(folders[0]),
            provider=ProviderType.AI_TOOLKIT,
            base_model="zimage-turbo",
            output_path=str(folders[0] / "loras"),
            output_name="demo",
            datasets=[DatasetEntry(path=str(f)) for f in folders],
            hyperparameters=hyperparameters,
        )

    def seed_cache(self, folder: Path) -> None:
        for name in AI_TOOLKIT_CACHE_DIRS:
            (folder / name).mkdir()
            (folder / name / "a_hash.safetensors").write_bytes(b"cache")

    def test_clears_every_repeat_folder(self, tmp_path: Path):
        # The project root and each `N_label` repeat folder arrive as separate
        # dataset entries, which is what makes a flat per-entry sweep enough.
        root = write_images(tmp_path / "proj", ["a"])
        repeats = write_images(tmp_path / "proj" / "5_char", ["b"])
        self.seed_cache(root)
        self.seed_cache(repeats)
        request = self.make_request([root, repeats], {"clear_caches": True})

        assert self.make_provider().finish_run(request, "job0", True, set()) == 4
        for folder in (root, repeats):
            for name in AI_TOOLKIT_CACHE_DIRS:
                assert not (folder / name).exists()

    def test_opting_out_leaves_the_cache(self, tmp_path: Path):
        root = write_images(tmp_path / "proj", ["a"])
        self.seed_cache(root)
        request = self.make_request([root], {})

        assert self.make_provider().finish_run(request, "job0", False, set()) == 0
        assert (root / AI_TOOLKIT_CACHE_DIRS[0]).exists()


class TestMusubiFinishRun:
    """Musubi caches outside the dataset, so the dirs come from the run record
    `generate_config` wrote rather than from the dataset paths."""

    @pytest.fixture
    def provider(self, tmp_path: Path) -> MusubiProvider:
        p = MusubiProvider("nonexistent-musubi-path")
        p._cache_root = tmp_path / "musubi-cache"
        return p

    def make_request(self, tmp_path: Path, folder: Path, hyperparameters: dict):
        hp = {
            "model_paths": {
                "checkpoint": str(tmp_path / "dit.safetensors"),
                "vae": str(tmp_path / "vae.safetensors"),
                "qwen": str(tmp_path / "te.safetensors"),
            },
        }
        hp.update(hyperparameters)
        return StartJobRequest(
            project_path=str(tmp_path),
            provider=ProviderType.MUSUBI,
            base_model="zimage",
            output_path=str(tmp_path / "loras"),
            output_name="demo",
            datasets=[DatasetEntry(path=str(folder))],
            hyperparameters=hp,
        )

    def generate(self, provider, request, tmp_path: Path, job_id: str) -> Path:
        config_dir = tmp_path / "config"
        config_dir.mkdir(exist_ok=True)
        asyncio.run(
            provider.generate_config(request, str(config_dir), job_id)
        )
        cache_dirs = provider._run_cache_dirs.get(job_id, [])
        return cache_dirs[0][1] if cache_dirs else None

    def test_clears_the_dirs_this_run_used(self, provider, tmp_path: Path):
        folder = write_images(tmp_path / "imgs", ["a"])
        request = self.make_request(tmp_path, folder, {"clear_caches": True})
        cache_dir = self.generate(provider, request, tmp_path, "job0")
        (cache_dir / "a_zimage.safetensors").write_bytes(b"cache")

        # The manifest the cache dir writes for itself is counted too.
        assert provider.finish_run(request, "job0", True, set()) == 2
        assert not cache_dir.exists()
        # The record is dropped, so a second call can't delete anything.
        assert provider._run_cache_dirs == {}

    def test_nothing_is_recorded_without_the_opt_in(
        self, provider, tmp_path: Path
    ):
        folder = write_images(tmp_path / "imgs", ["a"])
        request = self.make_request(tmp_path, folder, {})
        assert self.generate(provider, request, tmp_path, "job0") is None
        assert provider.finish_run(request, "job0", False, set()) == 0

    def test_folder_another_run_is_using_is_skipped(
        self, provider, tmp_path: Path
    ):
        folder = write_images(tmp_path / "imgs", ["a"])
        request = self.make_request(tmp_path, folder, {"clear_caches": True})
        cache_dir = self.generate(provider, request, tmp_path, "job0")

        removed = provider.finish_run(
            request, "job0", True, {normalise(str(folder))}
        )

        assert removed == 0
        assert cache_dir.exists()
