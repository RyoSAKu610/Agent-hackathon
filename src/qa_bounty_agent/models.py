from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Action(str, Enum):
    NOTIFY_ONLY = "notify_only"
    PREPARE_MANUAL = "prepare_manual"
    RUN_AUTHORIZED_TEST = "run_authorized_test"


@dataclass(slots=True)
class Opportunity:
    platform: str
    title: str
    url: str | None = None
    countries: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    qa_types: list[str] = field(default_factory=list)
    payout_usd: float | None = None
    confidential: bool = False
    requires_login: bool = True
    source: str | None = None
    raw_text: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Opportunity":
        return cls(
            platform=str(data.get("platform", "unknown")).strip().lower(),
            title=str(data.get("title", "Untitled opportunity")).strip(),
            url=data.get("url"),
            countries=[str(x) for x in data.get("countries", [])],
            languages=[str(x) for x in data.get("languages", [])],
            qa_types=[str(x) for x in data.get("qa_types", [])],
            payout_usd=(float(data["payout_usd"]) if data.get("payout_usd") is not None else None),
            confidential=bool(data.get("confidential", False)),
            requires_login=bool(data.get("requires_login", True)),
            source=data.get("source"),
            raw_text=data.get("raw_text"),
        )


@dataclass(slots=True)
class Decision:
    action: Action
    auto_accept_allowed: bool
    auto_test_allowed: bool
    reasons: list[str]
