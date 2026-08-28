from __future__ import annotations

import json
from importlib.resources import files

from .models import Action, Decision, Opportunity


def load_policies() -> dict[str, dict]:
    path = files("qa_bounty_agent").joinpath("platform_policies.json")
    return json.loads(path.read_text(encoding="utf-8"))


def policy_for(platform: str) -> dict:
    policies = load_policies()
    return policies.get(platform.lower(), {
        "auto_accept": False,
        "auto_test": False,
        "external_ai_project_data": False,
        "mode": "manual_review",
        "reason": "Unknown platform: no automation permission is assumed.",
        "source": None,
    })


def decide(opportunity: Opportunity, *, target_authorized: bool = False) -> Decision:
    policy = policy_for(opportunity.platform)
    reasons = [policy["reason"]]

    if opportunity.confidential:
        reasons.append("Opportunity is marked confidential; external AI/project-data processing is blocked.")

    if policy.get("auto_test") and target_authorized and not opportunity.confidential:
        return Decision(
            action=Action.RUN_AUTHORIZED_TEST,
            auto_accept_allowed=False,
            auto_test_allowed=True,
            reasons=reasons + ["Operator explicitly confirmed authorization for this target."],
        )

    if policy.get("mode") in {"manual_review", "repo_bounty"}:
        return Decision(
            action=Action.PREPARE_MANUAL,
            auto_accept_allowed=False,
            auto_test_allowed=False,
            reasons=reasons,
        )

    return Decision(
        action=Action.NOTIFY_ONLY,
        auto_accept_allowed=False,
        auto_test_allowed=False,
        reasons=reasons,
    )
