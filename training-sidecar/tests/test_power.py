"""Tests for the keep-awake config key and the sleep-inhibition lifecycle.

The Windows path can't be asserted from here (there's no readable "is a system
request held" API short of an elevated `powercfg /requests`), so these cover
the parts that are checkable: the config default, and the acquire/release/
self-heal bookkeeping via the helper-process path used on macOS and Linux.
"""

import json
import subprocess
from pathlib import Path

import pytest

import power
from config import read_keep_awake


# --------------------------------------------------------------------------
# Config


def test_keep_awake_defaults_on_when_key_absent(tmp_path: Path):
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps({"projectsFolder": "F:/x"}), encoding="utf-8")

    assert read_keep_awake(config_path) is True


def test_keep_awake_defaults_on_when_config_missing_or_corrupt(tmp_path: Path):
    corrupt = tmp_path / "config.json"
    corrupt.write_text("{not json", encoding="utf-8")

    assert read_keep_awake(None) is True
    assert read_keep_awake(tmp_path / "nope.json") is True
    assert read_keep_awake(corrupt) is True


def test_keep_awake_off_only_on_explicit_false(tmp_path: Path):
    config_path = tmp_path / "config.json"

    config_path.write_text(json.dumps({"keepAwakeWhileBusy": False}), encoding="utf-8")
    assert read_keep_awake(config_path) is False

    # Anything that isn't literally false leaves the inhibition on, rather than
    # silently disabling it on a typo.
    config_path.write_text(json.dumps({"keepAwakeWhileBusy": "no"}), encoding="utf-8")
    assert read_keep_awake(config_path) is True


# --------------------------------------------------------------------------
# Acquire / release


@pytest.fixture
def helper_platform(monkeypatch):
    """Force the helper-process path and record what would be spawned.

    Exercised on every OS so the macOS/Linux branch is covered from a Windows
    dev box too — the mechanism is the same, only the command differs.
    """
    spawned: list[list[str]] = []

    class FakeHelper:
        def __init__(self):
            self.returncode = None
            self.terminated = False

        def poll(self):
            return self.returncode

        def terminate(self):
            self.terminated = True
            self.returncode = 0

        def wait(self, timeout=None):
            return self.returncode

        def kill(self):
            self.returncode = -9

    def fake_popen(command, **_kwargs):
        spawned.append(command)
        return FakeHelper()

    monkeypatch.setattr(power, "_IS_WINDOWS", False)
    monkeypatch.setattr(power, "_helper_command", lambda: ["fake-inhibitor"])
    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(power, "_active", False)
    monkeypatch.setattr(power, "_helper", None)
    monkeypatch.setattr(power, "_warned", False)

    yield spawned

    power.set_keep_awake(False)


def test_acquires_once_and_releases(helper_platform):
    power.set_keep_awake(True)
    assert power.is_keep_awake_active() is True
    assert len(helper_platform) == 1

    # Called every tick — must not pile up helpers.
    power.set_keep_awake(True)
    assert len(helper_platform) == 1

    power.set_keep_awake(False)
    assert power.is_keep_awake_active() is False

    # Releasing twice is a no-op, not a crash.
    power.set_keep_awake(False)
    assert power.is_keep_awake_active() is False


def test_respawns_a_helper_that_died(helper_platform):
    power.set_keep_awake(True)
    assert len(helper_platform) == 1

    # Killed by hand, or swept by an OOM killer. The next tick has to notice:
    # silently leaving the machine free to sleep mid-run is the whole bug.
    power._helper.returncode = 1
    assert power.is_keep_awake_active() is False

    power.set_keep_awake(True)
    assert len(helper_platform) == 2
    assert power.is_keep_awake_active() is True


def test_unsupported_platform_reports_once(monkeypatch, capsys):
    monkeypatch.setattr(power, "_IS_WINDOWS", False)
    monkeypatch.setattr(power, "_helper_command", lambda: None)
    monkeypatch.setattr(power, "_active", False)
    monkeypatch.setattr(power, "_helper", None)
    monkeypatch.setattr(power, "_warned", False)

    power.set_keep_awake(True)
    power.set_keep_awake(True)

    assert power.is_keep_awake_active() is False
    # Ticking every 10s for the life of the process, so the "can't do this
    # here" line must not be printed on every one of them.
    assert capsys.readouterr().out.count("No sleep-inhibition mechanism") == 1
