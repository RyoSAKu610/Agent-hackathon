from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .models import Decision, Opportunity


def opportunity_markdown(op: Opportunity, decision: Decision) -> str:
    payout = f"${op.payout_usd:.2f}" if op.payout_usd is not None else "unknown"
    reasons = "\n".join(f"- {r}" for r in decision.reasons)
    return f"""# QA Opportunity\n\n- Platform: {op.platform}\n- Title: {op.title}\n- URL: {op.url or 'unknown'}\n- Countries: {', '.join(op.countries) or 'unknown'}\n- Languages: {', '.join(op.languages) or 'unknown'}\n- QA types: {', '.join(op.qa_types) or 'unknown'}\n- Payout: {payout}\n- Confidential: {op.confidential}\n- Recommended action: {decision.action.value}\n- Auto-accept allowed: {decision.auto_accept_allowed}\n- Auto-test allowed: {decision.auto_test_allowed}\n\n## Policy reasons\n{reasons}\n"""


def write_text_report(output: str | Path, content: str) -> Path:
    p = Path(output)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def smoke_markdown(result: dict) -> str:
    timestamp = datetime.now(timezone.utc).isoformat()
    lines = [
        "# Authorized QA Smoke Report",
        "",
        f"- Generated: {timestamp}",
        f"- URL: {result['url']}",
        f"- Final URL: {result.get('final_url', '')}",
        f"- Title: {result.get('title', '')}",
        f"- HTTP status: {result.get('status')}",
        f"- Screenshot: {result.get('screenshot', '')}",
        "",
        "## Console errors",
    ]
    errors = result.get("console_errors", [])
    lines.extend([f"- {x}" for x in errors] or ["- None observed"])
    lines += ["", "## Failed requests"]
    failed = result.get("failed_requests", [])
    lines.extend([f"- {x}" for x in failed] or ["- None observed"])
    lines += ["", "## HTTP error responses"]
    responses = result.get("http_errors", [])
    lines.extend([f"- {x}" for x in responses] or ["- None observed"])
    return "\n".join(lines) + "\n"
