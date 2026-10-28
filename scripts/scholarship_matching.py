#!/usr/bin/env python3
"""Pure, deterministic matching for trusted scholarship-call inputs.

The database adapter is intentionally separate: it must supply atomic rules in
the contract documented in docs/matching-contract.md. Free-form or manual rules
fail closed as ``needs_confirmation``.
"""

from __future__ import annotations

from collections.abc import Iterable
from math import isfinite
from typing import Any


MATCH = "match"
MISMATCH = "mismatch"
UNKNOWN = "needs_confirmation"
RULE_KINDS = {"required", "preferred", "exclusion", "manual_review"}
WINDOWS_OPEN_FOR_ACTION = {"open", "open_ended"}


def _combine(statuses: list[str], logic: str) -> str:
    if not statuses:
        return UNKNOWN
    if logic == "all":
        return MISMATCH if MISMATCH in statuses else UNKNOWN if UNKNOWN in statuses else MATCH
    if logic == "any":
        return MATCH if MATCH in statuses else UNKNOWN if UNKNOWN in statuses else MISMATCH
    if logic == "none":
        return MISMATCH if MATCH in statuses else UNKNOWN if UNKNOWN in statuses else MATCH
    return UNKNOWN


def _numeric(value: Any) -> bool:
    return type(value) in (int, float) and isfinite(value)


def _scalar_type(value: Any) -> str | None:
    if _numeric(value):
        return "number"
    return type(value).__name__ if type(value) in (str, bool) else None


def _compare(operator: str, actual: Any, expected: Any) -> bool:
    if operator in ("eq", "neq") and (
        _scalar_type(actual) is None or _scalar_type(actual) != _scalar_type(expected)
    ):
        raise TypeError("same-type scalars expected")
    if operator in ("in", "not_in") and (
        _scalar_type(actual) is None
        or not isinstance(expected, (list, tuple)) or not expected
        or any(_scalar_type(item) != _scalar_type(actual) for item in expected)
    ):
        raise TypeError("same-type scalar list expected")
    if operator in ("gte", "lte") and not (_numeric(actual) and _numeric(expected)):
        raise TypeError("finite numeric comparison expected")
    if operator == "eq":
        return actual == expected
    if operator == "neq":
        return actual != expected
    if operator == "in":
        if not isinstance(expected, (list, tuple)):
            raise TypeError("in expects a list")
        return actual in expected
    if operator == "not_in":
        if not isinstance(expected, (list, tuple)):
            raise TypeError("not_in expects a list")
        return actual not in expected
    if operator == "gte":
        return actual >= expected
    if operator == "lte":
        return actual <= expected
    if operator == "between":
        if not isinstance(expected, (list, tuple)) or len(expected) != 2:
            raise TypeError("between expects two bounds")
        if not _numeric(actual) or not all(_numeric(item) for item in expected) or expected[0] > expected[1]:
            raise TypeError("ordered finite numeric bounds expected")
        return expected[0] <= actual <= expected[1]
    if operator == "exists":
        if not isinstance(expected, bool):
            raise TypeError("exists expects a boolean")
        return (actual is not None) is expected
    raise ValueError(f"unsupported operator: {operator}")


def evaluate_requirement(requirement: dict, profile: dict) -> dict:
    """Evaluate one atomic requirement without exposing the profile value."""

    result = {
        "id": requirement["id"],
        "label": requirement["label"],
        "kind": requirement["kind"],
        "status": UNKNOWN,
        "reason": "unsupported_rule",
    }
    operator = requirement["operator"]
    kind = requirement["kind"]
    if kind not in RULE_KINDS:
        return result
    if operator == "manual" or kind == "manual_review":
        return result
    elif operator == "any":
        raw_match = True
    else:
        fact = profile.get("facts", {}).get(requirement["fact_key"])
        if not fact:
            result["reason"] = "missing_profile_fact"
            return result
        if fact.get("value_state") != "known":
            result["reason"] = fact.get("value_state", "unknown_profile_fact")
            return result
        if fact.get("confirmation_state") != "confirmed":
            result["reason"] = "unconfirmed_profile_fact"
            return result
        try:
            raw_match = _compare(operator, fact.get("value"), requirement.get("expected"))
        except (IndexError, KeyError, TypeError, ValueError):
            return result

    if kind == "exclusion":
        raw_match = not raw_match
    result["status"] = MATCH if raw_match else MISMATCH
    result["reason"] = "criterion_satisfied" if raw_match else "criterion_not_satisfied"
    return result


def _applies_to_track(item: dict, track_id: str | None) -> bool:
    return item.get("track_id") in (None, track_id)


def _is_hard(requirement: dict) -> bool:
    return requirement.get("kind") != "preferred"


def _evaluate_group(
    group_id: str,
    *,
    groups: dict[str, dict],
    requirements: list[dict],
    profile: dict,
    track_id: str | None,
    visiting: set[str],
) -> tuple[str, list[dict], int]:
    if group_id in visiting or group_id not in groups:
        return UNKNOWN, [{
            "id": f"group:{group_id}",
            "label": "Eligibility rule group is invalid",
            "kind": "manual_review",
            "status": UNKNOWN,
            "reason": "unsupported_group",
        }], 1
    visiting = visiting | {group_id}
    group = groups[group_id]
    criteria: list[dict] = []
    hard_statuses: list[str] = []
    hard_count = 0

    for requirement in requirements:
        if requirement.get("group_id") != group_id or not _applies_to_track(requirement, track_id):
            continue
        result = evaluate_requirement(requirement, profile)
        criteria.append(result)
        if _is_hard(requirement):
            hard_statuses.append(result["status"])
            hard_count += 1

    for child in groups.values():
        if child.get("parent_id") != group_id or not _applies_to_track(child, track_id):
            continue
        status, child_criteria, child_hard_count = _evaluate_group(
            child["id"],
            groups=groups,
            requirements=requirements,
            profile=profile,
            track_id=track_id,
            visiting=visiting,
        )
        criteria.extend(child_criteria)
        if child_hard_count:
            hard_statuses.append(status)
            hard_count += child_hard_count

    if not criteria:
        return UNKNOWN, [{
            "id": f"group:{group_id}",
            "label": "Eligibility rule group is empty",
            "kind": "manual_review",
            "status": UNKNOWN,
            "reason": "unsupported_group",
        }], 1
    status = _combine(hard_statuses, group.get("logic", "unknown"))
    if status == MISMATCH and not any(item["status"] == MISMATCH for item in criteria):
        criteria.append({
            "id": f"group:{group_id}:result",
            "label": "A grouped eligibility condition is not satisfied",
            "kind": "required",
            "status": MISMATCH,
            "reason": "group_not_satisfied",
        })
    return status, criteria, hard_count


def _variant_evaluation(call: dict, profile: dict, track: dict | None, route: dict | None) -> dict:
    track_id = track["id"] if track else None
    route_id = route["id"] if route else None
    all_groups = call.get("groups", [])
    excluded = {
        group["id"] for group in all_groups
        if group.get("applies_to", "application") != "application"
        or not _applies_to_track(group, track_id)
    }
    while True:
        children = {group["id"] for group in all_groups if group.get("parent_id") in excluded}
        if children <= excluded:
            break
        excluded.update(children)
    groups = {
        group["id"]: group
        for group in all_groups
        if group["id"] not in excluded
    }
    requirements = [
        requirement
        for requirement in call.get("requirements", [])
        if _applies_to_track(requirement, track_id)
        and requirement.get("group_id") not in excluded
    ]
    route_group_ids = {
        candidate.get("condition_group_id")
        for candidate in call.get("routes", [])
        if candidate.get("condition_group_id")
    }
    route_only_group_ids = set(route_group_ids)
    while True:
        children = {
            group["id"]
            for group in groups.values()
            if group.get("parent_id") in route_only_group_ids
        }
        if children <= route_only_group_ids:
            break
        route_only_group_ids.update(children)
    base_groups = {
        group_id: group
        for group_id, group in groups.items()
        if group_id not in route_only_group_ids
    }
    roots = [
        group
        for group in base_groups.values()
        if group.get("parent_id") is None
    ]
    criteria: list[dict] = []
    hard_statuses: list[str] = []
    hard_count = 0

    for group in roots:
        status, group_criteria, group_hard_count = _evaluate_group(
            group["id"],
            groups=base_groups,
            requirements=requirements,
            profile=profile,
            track_id=track_id,
            visiting=set(),
        )
        criteria.extend(group_criteria)
        if group_hard_count:
            hard_statuses.append(status)
            hard_count += group_hard_count

    for requirement in requirements:
        group_id = requirement.get("group_id")
        if group_id is not None:
            if group_id not in groups:
                criteria.append({
                    "id": requirement["id"],
                    "label": requirement["label"],
                    "kind": requirement["kind"],
                    "status": UNKNOWN,
                    "reason": "unsupported_group",
                })
                if _is_hard(requirement):
                    hard_statuses.append(UNKNOWN)
                    hard_count += 1
            continue
        result = evaluate_requirement(requirement, profile)
        criteria.append(result)
        if _is_hard(requirement):
            hard_statuses.append(result["status"])
            hard_count += 1

    condition_group_id = route.get("condition_group_id") if route else None
    if condition_group_id:
        status, route_criteria, route_hard_count = _evaluate_group(
            condition_group_id,
            groups=groups,
            requirements=requirements,
            profile=profile,
            track_id=track_id,
            visiting=set(),
        )
        criteria.extend(route_criteria)
        if route_hard_count:
            hard_statuses.append(status)
            hard_count += route_hard_count

    status = _combine(hard_statuses, "all")
    if not hard_count:
        criteria.append(
            {
                "id": "structured-eligibility",
                "label": "Machine-readable eligibility rules are unavailable",
                "kind": "manual_review",
                "status": UNKNOWN,
                "reason": "unsupported_call",
            }
        )
        status = UNKNOWN

    by_status = {MATCH: [], MISMATCH: [], UNKNOWN: []}
    for criterion in criteria:
        by_status[criterion["status"]].append(criterion)

    scoped_windows = [
        candidate
        for candidate in call.get("windows", [])
        if candidate.get("track_id") in (None, track_id)
        and candidate.get("route_id") in (None, route_id)
    ]
    def specificity(candidate):
        return (candidate.get("track_id") == track_id, candidate.get("route_id") == route_id)

    best_scope = max((specificity(candidate) for candidate in scoped_windows), default=None)
    candidates = [candidate for candidate in scoped_windows if specificity(candidate) == best_scope]
    # IDs and list order cannot choose between equally scoped audience windows.
    window = candidates[0] if len(candidates) == 1 else {}
    trusted = call.get("recommendation_ready") is True and call.get("serving_state") == "ready"
    route_available = route is not None and route.get("availability_status") == "available"
    actionable = (
        trusted
        and status == MATCH
        and route_available
        and window.get("state") in WINDOWS_OPEN_FOR_ACTION
    )
    preferences = [item for item in criteria if item["kind"] == "preferred"]
    return {
        "call_id": call["id"],
        "track_id": track_id,
        "route_id": route_id,
        "status": status,
        "visible": trusted,
        "actionable": actionable,
        "window_state": window.get("state", "unknown"),
        "criteria": {
            "matched": by_status[MATCH],
            "mismatched": by_status[MISMATCH],
            "unknown": by_status[UNKNOWN],
        },
        "preference_matches": sum(item["status"] == MATCH for item in preferences),
    }


def evaluate_call(call: dict, profile: dict) -> list[dict]:
    """Return auditable results for every correctly scoped call variant."""

    tracks = call.get("tracks") or [None]
    results = []
    for track in tracks:
        track_id = track["id"] if track else None
        routes = [
            route
            for route in call.get("routes", [])
            if route.get("track_id") in (None, track_id)
        ] or [None]
        results.extend(_variant_evaluation(call, profile, track, route) for route in routes)
    return results


def recommend(calls: Iterable[dict], profile: dict) -> list[dict]:
    """Return trusted variants in deterministic, student-facing order."""

    evaluated = [
        result
        for call in calls
        for result in evaluate_call(call, profile)
    ]
    potentially_matching = {
        result["call_id"] for result in evaluated if result["status"] != MISMATCH
    }
    results = [
        result for result in evaluated
        if result["visible"]
        and (result["status"] != MISMATCH or result["call_id"] not in potentially_matching)
    ]
    status_order = {MATCH: 0, UNKNOWN: 1, MISMATCH: 2}
    return sorted(
        results,
        key=lambda result: (
            not result["actionable"],
            status_order[result["status"]],
            -result["preference_matches"],
            result["call_id"],
            result["track_id"] or "",
            result["route_id"] or "",
        ),
    )
