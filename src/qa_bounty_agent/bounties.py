from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .models import Opportunity

OPIRE_REWARDS_URL = "https://api.opire.dev/rewards"
GH_ISSUE_RE = re.compile(r"https?://github\.com/([^/]+)/([^/]+)/issues/(\d+)")


@dataclass(slots=True)
class GithubIssueState:
    state: str
    title: str | None = None
    html_url: str | None = None


def _nested(data: dict[str, Any], *paths: str) -> Any:
    for path in paths:
        cur: Any = data
        ok = True
        for part in path.split("."):
            if not isinstance(cur, dict) or part not in cur:
                ok = False
                break
            cur = cur[part]
        if ok and cur not in (None, "", []):
            return cur
    return None


def _amount(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(match.group(0)) if match else None


def normalize_opire_reward(raw: dict[str, Any]) -> Opportunity:
    issue_url = _nested(raw, "issue_url", "issueUrl", "issue.url", "issue.html_url", "githubIssueUrl")
    title = _nested(raw, "issue_title", "issueTitle", "title", "issue.title") or "Opire rewarded issue"
    amount = _amount(_nested(raw, "amount", "reward", "value", "reward.amount"))

    languages_value = _nested(raw, "languages", "language", "repository.language", "issue.repository.language")
    if isinstance(languages_value, list):
        languages = [str(x) for x in languages_value]
    elif languages_value:
        languages = [str(languages_value)]
    else:
        languages = []

    return Opportunity(
        platform="opire",
        title=str(title),
        url=str(issue_url) if issue_url else None,
        countries=[],
        languages=languages,
        qa_types=["github-bounty"],
        payout_usd=amount,
        confidential=False,
        requires_login=False,
        source=OPIRE_REWARDS_URL,
        raw_text=json.dumps(raw, ensure_ascii=False, sort_keys=True),
    )


def _get_json(url: str, *, github: bool = False) -> Any:
    headers = {"User-Agent": "qa-bounty-agent/0.1", "Accept": "application/json"}
    if github:
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
            headers["Accept"] = "application/vnd.github+json"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        remaining = exc.headers.get("X-RateLimit-Remaining")
        suffix = f" GitHub rate-limit remaining={remaining}." if github and remaining is not None else ""
        raise RuntimeError(f"HTTP {exc.code} while fetching {url}.{suffix}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error while fetching {url}: {exc.reason}") from exc


def fetch_opire_rewards() -> list[Opportunity]:
    payload = _get_json(OPIRE_REWARDS_URL)
    if isinstance(payload, dict):
        records = payload.get("rewards") or payload.get("data") or payload.get("items") or []
    elif isinstance(payload, list):
        records = payload
    else:
        raise RuntimeError("Unexpected Opire API response shape")
    return [normalize_opire_reward(x) for x in records if isinstance(x, dict)]


def github_issue_state(issue_url: str) -> GithubIssueState:
    match = GH_ISSUE_RE.fullmatch(issue_url.rstrip("/"))
    if not match:
        raise ValueError(f"Not a GitHub issue URL: {issue_url}")
    owner, repo, number = match.groups()
    payload = _get_json(f"https://api.github.com/repos/{owner}/{repo}/issues/{number}", github=True)
    return GithubIssueState(
        state=str(payload.get("state", "unknown")),
        title=payload.get("title"),
        html_url=payload.get("html_url"),
    )
