from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_admin_request_can_prepare_customer_for_access_grant() -> None:
    source = (PORTAL / "admin.js").read_text(encoding="utf-8")

    assert 'let pendingGrantCustomerId = "";' in source
    assert 'owner.textContent=`Customer: ${customerLabel(row.customer_id)}`' in source
    assert 'prepare.textContent="Prepare access"' in source
    assert 'pendingGrantCustomerId=row.customer_id||""' in source
    assert '$("grantCustomer").value=pendingGrantCustomerId' in source
    assert 'subtitle_grants' in source
    assert '"Access granted. The subtitle is now available to this customer in authorized clients."' in source


def test_admin_upload_still_uses_private_storage_before_grant() -> None:
    source = (PORTAL / "admin.js").read_text(encoding="utf-8")

    assert 'uploadStorage("subtitle-files",storagePath' in source
    assert 'client.update("subtitle_tracks",{storage_path:storagePath}' in source
    assert 'client.upsert("subtitle_grants"' in source


def test_customer_and_admin_portal_scripts_have_valid_javascript_syntax() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")

    for script_name in ("customer.js", "admin.js", "supabase-client.js"):
        subprocess.run(
            [node, "--check", str(PORTAL / script_name)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
