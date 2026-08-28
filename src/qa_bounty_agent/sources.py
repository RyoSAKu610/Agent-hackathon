from __future__ import annotations

import email
import json
import re
from email import policy
from pathlib import Path
from urllib.parse import urlparse

from .models import Opportunity

URL_RE = re.compile(r"https?://[^\s<>\"]+")
MONEY_RE = re.compile(r"(?:USD\s*|\$)\s*(\d+(?:\.\d+)?)", re.I)

PLATFORM_HINTS = {
    "utest": ("utest", "applause"),
    "testio": ("test.io", "test io"),
    "testlio": ("testlio",),
    "testbirds": ("testbirds", "testbirds.com"),
    "testerwork": ("tester work", "testerwork", "global app testing"),
}


def load_json(path: str | Path) -> list[Opportunity]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        payload = payload.get("opportunities", [])
    return [Opportunity.from_dict(item) for item in payload]


def detect_platform(text: str) -> str:
    folded = text.casefold()
    for platform, hints in PLATFORM_HINTS.items():
        if any(h.casefold() in folded for h in hints):
            return platform
    return "unknown"


def _plain_body(msg: email.message.EmailMessage) -> str:
    if msg.is_multipart():
        chunks: list[str] = []
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and part.get_content_disposition() != "attachment":
                try:
                    chunks.append(part.get_content())
                except Exception:
                    continue
        return "\n".join(chunks)
    try:
        return str(msg.get_content())
    except Exception:
        return ""


def parse_eml(path: str | Path) -> Opportunity:
    p = Path(path)
    with p.open("rb") as f:
        msg = email.message_from_binary_file(f, policy=policy.default)
    subject = str(msg.get("subject", "QA opportunity"))
    sender = str(msg.get("from", ""))
    body = _plain_body(msg)
    combined = f"{subject}\n{sender}\n{body}"
    urls = URL_RE.findall(combined)
    payout = None
    match = MONEY_RE.search(combined)
    if match:
        payout = float(match.group(1))

    countries = ["Japan"] if re.search(r"\bJapan\b|日本", combined, re.I) else []
    languages = ["Japanese"] if re.search(r"\bJapanese\b|日本語", combined, re.I) else []
    qa_types = [term for term in ("functional", "exploratory", "localization", "payment", "regression", "qa", "testing") if term in combined.casefold()]

    project_url = None
    for u in urls:
        host = urlparse(u).netloc.casefold()
        if any(domain in host for domain in ("utest", "test.io", "testlio", "testbirds", "testerwork")):
            project_url = u.rstrip(".,)")
            break
    if project_url is None and urls:
        project_url = urls[0].rstrip(".,)")

    return Opportunity(
        platform=detect_platform(combined),
        title=subject,
        url=project_url,
        countries=countries,
        languages=languages,
        qa_types=qa_types,
        payout_usd=payout,
        confidential=bool(re.search(r"confidential|nda|機密", combined, re.I)),
        requires_login=True,
        source=str(p),
        raw_text=combined,
    )
