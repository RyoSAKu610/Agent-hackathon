from __future__ import annotations

from .models import Opportunity


def _contains(values: list[str], needles: tuple[str, ...]) -> bool:
    text = " ".join(values).casefold()
    return any(n.casefold() in text for n in needles)


def japan_match(op: Opportunity) -> bool:
    hay = op.countries + ([op.raw_text] if op.raw_text else [])
    return _contains(hay, ("japan", "日本", "jp"))


def japanese_match(op: Opportunity) -> bool:
    hay = op.languages + ([op.raw_text] if op.raw_text else [])
    return _contains(hay, ("japanese", "日本語", "ja-jp"))


def qa_fit(op: Opportunity) -> int:
    """Ordinal QA fit, not a payout/acceptance threshold."""
    text = " ".join(op.qa_types).casefold()
    preferred = ("functional", "exploratory", "localization", "payment", "regression", "qa", "test")
    return sum(1 for term in preferred if term in text)


def rank_key(op: Opportunity) -> tuple:
    return (
        japan_match(op),
        japanese_match(op),
        qa_fit(op),
        op.payout_usd is not None,
        op.payout_usd if op.payout_usd is not None else 0.0,
    )


def rank(opportunities: list[Opportunity]) -> list[Opportunity]:
    return sorted(opportunities, key=rank_key, reverse=True)
