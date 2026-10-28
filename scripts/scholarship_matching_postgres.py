#!/usr/bin/env python3
"""Read matching inputs only from the fail-closed serving projection."""

from __future__ import annotations

from typing import Any

from scholarship_matching import recommend


MATCHING_CALLS_QUERY = """
    select matching_payload
    from matching_ready_calls
    order by call_id
"""


def _expected(value: Any, operator: str) -> tuple[Any, str]:
    """Accept only the documented atomic value envelope; otherwise fail closed."""

    if operator == "any":
        return None, operator
    if isinstance(value, dict) and set(value) == {"expected"}:
        return value["expected"], operator
    return None, "manual"


def _call_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    requirements = []
    for row in payload.get("requirements", []):
        expected, operator = _expected(row.get("value"), row.get("operator", "manual"))
        requirements.append(
            {
                "id": str(row.get("id", "invalid-requirement")),
                "group_id": row.get("group_id"),
                "track_id": row.get("track_id"),
                "fact_key": row.get("criterion_key", "other"),
                "kind": row.get("kind", "manual_review"),
                "operator": operator,
                "expected": expected,
                "label": row.get("label", "Eligibility needs confirmation"),
            }
        )
    return {
        "id": str(payload["id"]),
        "recommendation_ready": payload.get("recommendation_ready") is True,
        "serving_state": payload.get("serving_state"),
        "tracks": payload.get("tracks") if isinstance(payload.get("tracks"), list) else [],
        "groups": payload.get("groups") if isinstance(payload.get("groups"), list) else [],
        "requirements": requirements,
        "routes": payload.get("routes") if isinstance(payload.get("routes"), list) else [],
        "windows": payload.get("windows") if isinstance(payload.get("windows"), list) else [],
    }


def read_matching_calls(connection: Any) -> list[dict[str, Any]]:
    """Map the projection's JSON payload without reading canonical tables."""

    with connection.cursor() as cursor:
        cursor.execute(MATCHING_CALLS_QUERY)
        rows = cursor.fetchall()
    payloads = [row["matching_payload"] if isinstance(row, dict) else row[0] for row in rows]
    return [_call_from_payload(payload) for payload in payloads if isinstance(payload, dict)]


def recommend_from_postgres(connection: Any, profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Return deterministic results from the serving role's only matching read."""

    return recommend(read_matching_calls(connection), profile)
