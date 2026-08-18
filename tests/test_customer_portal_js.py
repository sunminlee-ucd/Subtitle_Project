from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CUSTOMER_SCRIPT = ROOT / "customer_portal" / "customer.js"


def test_customer_portal_javascript_syntax() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")

    subprocess.run(
        [node, "--check", str(CUSTOMER_SCRIPT)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
