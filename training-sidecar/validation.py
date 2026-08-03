"""Pre-enqueue validation for /jobs/start.

Everything here runs before a job is created, so a bad request fails fast with
a 400 and a full list of problems — rather than being enqueued and only
failing once a worker picks it up (or, worse, mid-run inside the provider
subprocess). Providers stay the authority on backend-specific checks via
`TrainingProvider.validate_request`; this module owns the checks that are the
same for every provider (output name, dataset paths, provider/model
membership).
"""

import os
import re
from collections.abc import Iterable

from models import (
    JobState,
    ProviderType,
    StartJobRequest,
    _TERMINAL_TRAINING_STATUSES,
)
from providers.base import TrainingProvider

# Windows forbids these characters anywhere in a filename — includes the C0
# control range (0x00-0x1f) alongside the usual reserved punctuation.
_ILLEGAL_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

# Reserved device names, case-insensitively, bare or with any extension
# (e.g. "con", "CON.safetensors"). COM/LPT only reserve 1-9, not the bare word.
_RESERVED_NAME_RE = re.compile(
    r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$", re.IGNORECASE
)


class RequestValidationError(ValueError):
    """Raised by `validate_start_request` with every problem found."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def validate_output_name(name: str) -> list[str]:
    """Every problem with `name` as a filename-safe output name.

    Returns an empty list when the name is fine. Checked against Windows'
    filename rules regardless of host OS, since a run's files may later be
    copied to/from a Windows machine (and the sidecar itself commonly runs
    there).
    """
    errors: list[str] = []

    if not name or not name.strip():
        return ["Output name cannot be empty"]

    if name.startswith("."):
        errors.append("Output name cannot start with a dot")
    if ".." in name:
        errors.append("Output name cannot contain '..'")
    if _ILLEGAL_CHARS_RE.search(name):
        errors.append(
            'Output name cannot contain path separators or the characters'
            ' < > : " / \\ | ? * or control characters'
        )
    if name != name.rstrip(" .") and name.rstrip(" .") != "":
        errors.append("Output name cannot end with a dot or a space")
    if _RESERVED_NAME_RE.match(name):
        errors.append(f"'{name}' is a reserved Windows device name")

    return errors


def validate_start_request(
    request: StartJobRequest,
    providers: dict[str, TrainingProvider],
    jobs: Iterable[JobState],
) -> None:
    """Raise RequestValidationError with every problem found, else return.

    Runs in order: provider registration (the only check that short-circuits
    the rest, since every later check either needs the provider or is about
    to be checked against it anyway), base-model membership, output-name
    shape, output-name uniqueness among live jobs, dataset paths, and finally
    the provider's own semantic checks.
    """
    provider = providers.get(request.provider.value)
    if provider is None:
        raise RequestValidationError(
            [
                f"Provider '{request.provider.value}' is not registered. "
                f"Available: {list(providers.keys())}"
            ]
        )

    errors: list[str] = []

    # The mock provider deliberately accepts any model id (see MockProvider —
    # it exposes a friendly catalogue, not a whitelist), so it's the one
    # provider this check doesn't apply to.
    if request.provider != ProviderType.MOCK:
        supported_ids = {m["id"] for m in provider.get_supported_models()}
        if request.base_model not in supported_ids:
            errors.append(
                f"Unsupported model '{request.base_model}' for provider "
                f"'{request.provider.value}'"
            )

    errors.extend(validate_output_name(request.output_name))

    target_name = request.output_name.strip().lower()
    for job in jobs:
        if job.status in _TERMINAL_TRAINING_STATUSES:
            continue
        existing_name = (job.config or {}).get("output_name")
        if existing_name and str(existing_name).strip().lower() == target_name:
            errors.append(
                f"Output name '{request.output_name}' is already in use by "
                "an in-progress run"
            )
            break

    for dataset in request.datasets:
        if not os.path.isdir(dataset.path):
            errors.append(f"Dataset path does not exist: {dataset.path}")

    errors.extend(provider.validate_request(request))

    if errors:
        raise RequestValidationError(errors)
