"""Test bootstrap.

The sidecar's modules import each other flat (`from models import ...`), so the
sidecar root has to be on sys.path before any test imports one. pytest only
inserts the test file's own directory, so put the parent on the front here.
"""

import sys
from pathlib import Path

SIDECAR_ROOT = Path(__file__).resolve().parent.parent
if str(SIDECAR_ROOT) not in sys.path:
    sys.path.insert(0, str(SIDECAR_ROOT))
