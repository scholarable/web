#!/usr/bin/env python3
"""Read scanner refresh metadata once. No deployment, secrets, PDF access or sends."""
import json
import subprocess
import sys
import time
from datetime import datetime, timezone

REPO = "repos/FlamurMaliqi/Scholarable"
WORKFLOW = "refresh-document-scanner.yml"
MAX_AGE_SECONDS = 30 * 3600  # Warn 18 hours before the scanner's 48-hour cutoff.


def collect(fetch=None, now=None):
    now = now or datetime.now(timezone.utc)
    deadline = time.monotonic() + 70

    def api(path):
        timeout = min(8, deadline - time.monotonic())
        if timeout <= 0:
            raise ValueError("deadline")
        result = subprocess.run(["gh", "api", f"{REPO}/{path}"],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=timeout, check=True)
        if len(result.stdout) > 1_000_000:
            raise ValueError("oversized response")
        return json.loads(result.stdout)

    fetch = fetch or api
    report = {"mode": "read_only", "delivered": False, "state": "unavailable",
              "acquired_at": now.isoformat()}
    try:
        workflow = fetch(f"actions/workflows/{WORKFLOW}")
        if workflow["path"] != f".github/workflows/{WORKFLOW}":
            raise ValueError("wrong workflow")
        variables = fetch("actions/variables?per_page=100")
        if variables["total_count"] > 100:
            raise ValueError("incomplete variables")
        enabled = next((v["value"] for v in variables["variables"]
                        if v["name"] == "SCHOLARABLE_SCANNER_REFRESH_ENABLED"), None)
        if enabled != "true":
            report["state"] = "paused"
            return report
        if workflow["state"] != "active":
            report["state"] = "workflow_disabled"
            return report
        runs = fetch(f"actions/workflows/{WORKFLOW}/runs?branch=main&per_page=10")["workflow_runs"]
        if not isinstance(runs, list) or len(runs) > 10:
            raise ValueError("invalid runs")
        latest = None
        for run in runs:
            if (run["head_branch"] != "main" or run["event"] not in ("schedule", "workflow_dispatch")
                    or run["status"] != "completed" or run["conclusion"] != "success"):
                continue
            if type(run["id"]) is not int or run["id"] <= 0:
                raise ValueError("invalid run id")
            jobs = fetch(f"actions/runs/{run['id']}/jobs?per_page=100")
            if jobs["total_count"] > 100:
                raise ValueError("incomplete jobs")
            for job in jobs["jobs"]:
                if job["name"] != "refresh" or job["conclusion"] != "success":
                    continue
                for step in job["steps"]:
                    if step["name"] != "Deploy refreshed image paused" or step["conclusion"] != "success":
                        continue
                    completed = datetime.fromisoformat(step["completed_at"].replace("Z", "+00:00"))
                    age = (now - completed).total_seconds()
                    if age < 0:
                        raise ValueError("future deployment")
                    if latest is None or completed > latest:
                        latest = completed
        # ponytail: inspect only ten recent runs; a busy history fails missing rather than guessing fresh.
        if latest is None:
            report["state"] = "missing"
        else:
            age = int((now - latest).total_seconds())
            report.update(state="stale" if age >= MAX_AGE_SECONDS else "fresh",
                          last_success_at=latest.isoformat(), age_seconds=age)
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        report["state"] = "unavailable"  # Never publish raw API errors, headers or logs.
    return report


def self_test():
    from datetime import timedelta
    now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
    enabled, active, fail = True, True, False
    completed = now - timedelta(hours=1)
    runs = [dict(id=1, head_branch="main", event="schedule", status="completed", conclusion="success"),
            dict(id=2, head_branch="main", event="workflow_dispatch", status="completed", conclusion="success")]
    jobs = [{"name": "refresh", "conclusion": "success", "steps": [
        {"name": "Deploy refreshed image paused", "conclusion": "success", "completed_at": completed.isoformat()}]}]

    def fetch(path):
        if fail:
            raise ValueError("private provider diagnostic")
        if path.endswith(WORKFLOW):
            return {"path": f".github/workflows/{WORKFLOW}", "state": "active" if active else "disabled_manually"}
        if path.startswith("actions/variables"):
            return {"total_count": 1, "variables": [{"name": "SCHOLARABLE_SCANNER_REFRESH_ENABLED", "value": str(enabled).lower()}]}
        if "/runs?" in path:
            return {"workflow_runs": runs}
        return {"total_count": 1, "jobs": jobs if "/2/" in path else [{"name": "refresh", "conclusion": "skipped"}]}

    assert collect(fetch, now)["state"] == "fresh"  # Recent skipped run never certifies deployment.
    jobs[0]["steps"][0]["completed_at"] = (now - timedelta(hours=30)).isoformat()
    assert collect(fetch, now)["state"] == "stale"  # Inclusive threshold; rerun update time is irrelevant.
    jobs[0]["name"] = "alert-test"
    assert collect(fetch, now)["state"] == "missing"
    jobs[0]["name"] = "refresh"
    runs[1]["head_branch"] = "codex/test"
    assert collect(fetch, now)["state"] == "missing"
    runs[1]["head_branch"] = "main"
    jobs[0]["steps"][0]["completed_at"] = (now + timedelta(seconds=1)).isoformat()
    assert collect(fetch, now)["state"] == "unavailable"
    active = False
    assert collect(fetch, now)["state"] == "workflow_disabled"
    enabled = False
    assert collect(fetch, now)["state"] == "paused"
    fail = True
    report = collect(fetch, now)
    assert report["state"] == "unavailable" and "private" not in json.dumps(report)
    print("Scanner refresh freshness checks passed")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif sys.argv[1:]:
        raise SystemExit("Usage: check_refresh.py [--self-test]")
    else:
        result = collect()
        print(json.dumps(result, sort_keys=True))
        raise SystemExit(0 if result["state"] in ("fresh", "paused") else 2 if result["state"] == "unavailable" else 1)
