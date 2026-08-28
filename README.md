# QA Bounty Agent

A policy-gated local agent for discovering and triaging crowd-QA opportunities, with **read-only Playwright smoke testing only on targets you are explicitly authorized to test**.

The project deliberately does **not** auto-accept paid assignments, bypass CAPTCHAs, impersonate a human tester, or submit client/confidential data to an external AI service.

## What it automates

1. Parse normalized opportunity JSON or exported/forwarded `.eml` invitation emails.
2. Rank Japan/Japanese opportunities ahead of generic opportunities, then QA relevance and known payout.
3. Apply a per-platform policy gate before any action.
4. Generate human-review Markdown cards for opportunities.
5. For `generic-authorized` targets only, run a passive Chromium smoke test and collect page status, console errors, failed requests, HTTP errors, and a screenshot.
6. Watch a local mail-export folder continuously when the operator supplies the polling interval.
7. Fetch live rewarded GitHub issues from Opire's public rewards API.

## Why the policy gate exists

As of August 2026, the platforms have materially different rules:

- **uTest:** limited generic AI brainstorming is allowed, but confidential/client/personal data must not be entered into third-party AI tools. Source: https://www.utest.com/terms-and-conditions
- **Test IO:** its testing standards say not to use automated tools/scripts/VMs/emulators that compromise testing integrity. Source: https://academy.test.io/en/articles/11939982-test-io-testing-standards
- **Testlio:** external/public AI use while performing services is restricted unless expressly authorized; client opt-in and internal policy controls apply. Source: https://www.testlio.com/ai-use-policy
- **Testbirds / Tester Work:** this project does not assume autonomous acceptance/execution is permitted without explicit platform/project authorization.

Because these rules can change, `src/qa_bounty_agent/platform_policies.json` is intentionally explicit and conservative.

## Tool research / architecture choice

- **Playwright Python** is the execution layer because it supports Chromium, Firefox, and WebKit with a deterministic browser API. Current PyPI releases require Python 3.10+. https://github.com/microsoft/playwright-python
- **Playwright MCP** is a strong future adapter for agentic exploratory testing because it exposes browser state through structured accessibility snapshots. https://github.com/microsoft/playwright-mcp
- **Browser Use** is useful when pages are unfamiliar and a natural-language browser agent is justified, but it introduces an LLM/cloud boundary unless configured carefully. https://github.com/browser-use/browser-use
- **Stagehand** is a strong TypeScript alternative that mixes deterministic Playwright actions with natural-language actions and caching. https://github.com/browserbase/stagehand
- **qa-use** demonstrates an AI-powered E2E QA agent architecture on Browser Use. https://github.com/browser-use/qa-use

For paid crowd-testing, deterministic local Playwright plus a hard policy gate is the safer base. Agentic browser frameworks can be added only for projects that expressly permit them.

## Install

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -e '.[dev]'
```

For authorized browser testing:

```bash
python -m pip install -e '.[browser,dev]'
playwright install chromium
```

## Use

Rank normalized opportunities:

```bash
qa-agent rank examples/opportunities.json
```

Generate review cards:

```bash
qa-agent prepare examples/opportunities.json --output-dir reports/opportunities
```

Inspect a platform gate:

```bash
qa-agent policy utest
qa-agent policy testio
qa-agent policy testlio
```

Parse an exported invitation email:

```bash
qa-agent eml inbox/invite.eml
```

Watch a folder once:

```bash
qa-agent watch-folder inbox --once
```

For continuous watching, **you choose the cadence**:

```bash
qa-agent watch-folder inbox --interval-seconds <YOUR_INTERVAL>
```

Run a passive smoke test on a site you own or are explicitly authorized to test:

```bash
qa-agent test \
  --url https://your-staging.example \
  --output-dir reports/staging \
  --platform generic-authorized \
  --authorized
```

Trying the same command with `--platform utest`, `testio`, or `testlio` is blocked by the policy gate.

## Autonomous-friendly bounty lane: Opire / Algora

Crowd-testing sites often require human participation and restrict automation. Public GitHub bounties are structurally different: the work product is code, tests, review comments, or a PR that can be verified in a repository.

### Opire

Opire documents a developer flow of finding a rewarded GitHub issue, trying to solve it, creating a PR, and claiming the reward. A public unauthenticated rewards endpoint is available at `https://api.opire.dev/rewards` and has been used by independent bounty watchers.

```bash
qa-agent opire
qa-agent opire --language Python --language TypeScript
qa-agent opire --verify-github
```

The scanner still does **not** post `/try`, `/claim`, or open a PR automatically. Those are external commitment/submission actions and remain explicit. After approval, a coding agent can work on the public repository, run its tests, and prepare a PR.

### Algora

Algora funds GitHub issues and pays when work is accepted/merged. Public 2026 claim pages include submissions explicitly labeled as OpenAI Codex / autonomous-agent work, which makes it a much better target for agent-assisted earning than pretending a bot is a human crowd tester. Discovery support for Algora is kept as a future adapter until a stable public listing API is verified.

## Opportunity JSON schema

```json
{
  "platform": "testerwork",
  "title": "Japanese localization test",
  "url": "https://...",
  "countries": ["Japan"],
  "languages": ["Japanese"],
  "qa_types": ["localization", "exploratory"],
  "payout_usd": 24,
  "confidential": false,
  "requires_login": true,
  "source": "email"
}
```

## Next integrations

- Gmail label/export adapter for QA invitation emails.
- A local desktop notification adapter.
- Platform adapters only where the platform publishes an API or explicitly permits automated access.
- Optional local-model enrichment (for example via Ollama) **only for non-confidential inputs**.

No integration should silently expand the policy permissions in `platform_policies.json`.
