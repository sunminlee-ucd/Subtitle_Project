from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import UTC, datetime

from fastapi import APIRouter

router = APIRouter()

_METADATA = "http://metadata.google.internal/computeMetadata/v1"
_CLOUD_RUN_REQUEST_LIMIT = 2_000_000
_CLOUD_RUN_CPU_LIMIT = 180_000
_CLOUD_RUN_MEMORY_LIMIT = 360_000


def _read_json(url: str, headers: dict[str, str] | None = None, timeout: int = 4) -> dict:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def _metadata(path: str) -> str:
    request = urllib.request.Request(
        f"{_METADATA}/{path}", headers={"Metadata-Flavor": "Google"}
    )
    with urllib.request.urlopen(request, timeout=2) as response:  # noqa: S310
        return response.read().decode("utf-8").strip()


def _access_token() -> str:
    return _metadata("instance/service-accounts/default/token") and _read_json(
        f"{_METADATA}/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
        timeout=2,
    )["access_token"]


def _sum_metric(
    project: str,
    service: str,
    region: str,
    metric_type: str,
    start: datetime,
    end: datetime,
    token: str,
) -> float:
    filter_value = (
        f'metric.type="{metric_type}" AND resource.type="cloud_run_revision" '
        f'AND resource.labels.service_name="{service}" '
        f'AND resource.labels.location="{region}"'
    )
    query = urllib.parse.urlencode(
        {
            "filter": filter_value,
            "interval.startTime": start.isoformat().replace("+00:00", "Z"),
            "interval.endTime": end.isoformat().replace("+00:00", "Z"),
            "view": "FULL",
            "pageSize": 100000,
        }
    )
    payload = _read_json(
        f"https://monitoring.googleapis.com/v3/projects/{project}/timeSeries?{query}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
    )
    total = 0.0
    for series in payload.get("timeSeries", []):
        for point in series.get("points", []):
            value = point.get("value", {})
            raw = value.get("int64Value", value.get("doubleValue", 0))
            total += float(raw or 0)
    return total


def _cpu_count(value: str) -> float:
    value = str(value or "1").strip()
    if value.endswith("m"):
        return float(value[:-1]) / 1000.0
    return float(value)


def _memory_gib(value: str) -> float:
    value = str(value or "512Mi").strip()
    units = {"Ki": 1 / (1024 * 1024), "Mi": 1 / 1024, "Gi": 1, "Ti": 1024}
    for suffix, multiplier in units.items():
        if value.endswith(suffix):
            return float(value[: -len(suffix)]) * multiplier
    return float(value) / (1024**3)


@router.get("/api/usage/cloud-run")
def cloud_run_usage() -> dict[str, object]:
    """Return aggregate Cloud Run usage only; no customer or request data is exposed."""
    service = os.getenv("K_SERVICE", "subtitle-project")
    region = os.getenv("CLOUD_RUN_REGION", "europe-west2")
    now = datetime.now(UTC)
    start = datetime(now.year, now.month, 1, tzinfo=UTC)
    result: dict[str, object] = {
        "available": False,
        "service": service,
        "region": region,
        "period_start": start.isoformat(),
        "period_end": now.isoformat(),
        "limits": {
            "requests": _CLOUD_RUN_REQUEST_LIMIT,
            "vcpu_seconds": _CLOUD_RUN_CPU_LIMIT,
            "gib_seconds": _CLOUD_RUN_MEMORY_LIMIT,
        },
        "scope_note": "Cloud Run free tier is shared across projects on the billing account.",
    }
    try:
        project = _metadata("project/project-id")
        token = _access_token()
        service_payload = _read_json(
            f"https://run.googleapis.com/v2/projects/{project}/locations/{region}/services/{service}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        limits = (
            service_payload.get("template", {})
            .get("containers", [{}])[0]
            .get("resources", {})
            .get("limits", {})
        )
        cpu = _cpu_count(limits.get("cpu", "1"))
        memory = _memory_gib(limits.get("memory", "512Mi"))
        requests = _sum_metric(
            project,
            service,
            region,
            "run.googleapis.com/request_count",
            start,
            now,
            token,
        )
        billable = _sum_metric(
            project,
            service,
            region,
            "run.googleapis.com/container/billable_instance_time",
            start,
            now,
            token,
        )
        result.update(
            {
                "available": True,
                "project": project,
                "requests": round(requests),
                "billable_instance_seconds": billable,
                "cpu": cpu,
                "memory_gib": memory,
                "estimated_vcpu_seconds": billable * cpu,
                "estimated_gib_seconds": billable * memory,
            }
        )
    except Exception as exc:  # Cloud Monitoring access is optional for this dashboard.
        result["message"] = (
            "Automatic Cloud Run usage is unavailable. Grant the runtime service account "
            "Cloud Monitoring Viewer and Cloud Run Viewer permissions. "
            f"({type(exc).__name__})"
        )
    return result
