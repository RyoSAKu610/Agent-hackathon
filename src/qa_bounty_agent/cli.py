from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .bounties import fetch_opire_rewards, github_issue_state
from .policy import decide, policy_for
from .reporting import opportunity_markdown, smoke_markdown, write_text_report
from .runner import run_authorized_smoke
from .scoring import rank
from .sources import load_json, parse_eml


def _print_ranked(ops):
    for idx, op in enumerate(rank(ops), 1):
        decision = decide(op)
        payout = f"${op.payout_usd:.2f}" if op.payout_usd is not None else "?"
        print(f"{idx}. [{op.platform}] {op.title} | {payout} | {decision.action.value} | {op.url or '-'}")


def cmd_rank(args):
    _print_ranked(load_json(args.path))


def cmd_eml(args):
    op = parse_eml(args.path)
    decision = decide(op)
    print(opportunity_markdown(op, decision))


def cmd_policy(args):
    print(json.dumps(policy_for(args.platform), ensure_ascii=False, indent=2))


def cmd_prepare(args):
    ops = load_json(args.path)
    ranked = rank(ops)
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    for idx, op in enumerate(ranked, 1):
        decision = decide(op)
        name = f"{idx:03d}-{op.platform}.md"
        write_text_report(out / name, opportunity_markdown(op, decision))
    print(f"Wrote {len(ranked)} report(s) to {out}")


def cmd_test(args):
    result = run_authorized_smoke(args.url, args.output_dir, platform=args.platform, authorized=args.authorized)
    report = smoke_markdown(result)
    report_path = Path(args.output_dir) / "report.md"
    write_text_report(report_path, report)
    print(report)
    print(f"Report: {report_path}")


def cmd_watch(args):
    folder = Path(args.folder)
    seen: set[str] = set()
    while True:
        files = sorted(folder.glob("*.eml"))
        fresh = [p for p in files if str(p.resolve()) not in seen]
        for p in fresh:
            op = parse_eml(p)
            _print_ranked([op])
            seen.add(str(p.resolve()))
        if args.once:
            return
        if args.interval_seconds is None:
            raise SystemExit("--interval-seconds is required unless --once is used")
        time.sleep(args.interval_seconds)


def cmd_opire(args):
    ops = fetch_opire_rewards()
    if args.language:
        needles = [x.casefold() for x in args.language]
        ops = [op for op in ops if any(n in ((op.raw_text or "") + " " + " ".join(op.languages)).casefold() for n in needles)]
    ops = sorted(ops, key=lambda op: (op.payout_usd is not None, op.payout_usd or 0.0), reverse=True)
    for idx, op in enumerate(ops, 1):
        issue_state = "unchecked"
        if args.verify_github and op.url:
            try:
                issue_state = github_issue_state(op.url).state
            except (RuntimeError, ValueError) as exc:
                issue_state = f"verify-error: {exc}"
        payout = f"${op.payout_usd:.2f}" if op.payout_usd is not None else "?"
        print(f"{idx}. {payout} | {issue_state} | {op.title} | {op.url or '-'}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="qa-agent", description="Policy-gated QA opportunity scout")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("rank", help="Rank normalized opportunities from JSON")
    p.add_argument("path")
    p.set_defaults(func=cmd_rank)

    p = sub.add_parser("eml", help="Parse and classify a QA invitation .eml")
    p.add_argument("path")
    p.set_defaults(func=cmd_eml)

    p = sub.add_parser("policy", help="Show the policy gate for a platform")
    p.add_argument("platform")
    p.set_defaults(func=cmd_policy)

    p = sub.add_parser("prepare", help="Generate human-review opportunity reports")
    p.add_argument("path")
    p.add_argument("--output-dir", required=True)
    p.set_defaults(func=cmd_prepare)

    p = sub.add_parser("test", help="Run a read-only smoke test on an explicitly authorized target")
    p.add_argument("--url", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--platform", default="generic-authorized")
    p.add_argument("--authorized", action="store_true", help="Explicitly confirm you are authorized to test this target")
    p.set_defaults(func=cmd_test)

    p = sub.add_parser("opire", help="Fetch live rewarded GitHub issues from Opire's public API")
    p.add_argument("--language", action="append", help="Keep records whose language/raw metadata contains this value; repeatable")
    p.add_argument("--verify-github", action="store_true", help="Cross-check each GitHub issue state; GITHUB_TOKEN is recommended for authenticated API limits")
    p.set_defaults(func=cmd_opire)

    p = sub.add_parser("watch-folder", help="Watch a local folder for exported/forwarded QA invitation .eml files")
    p.add_argument("folder")
    p.add_argument("--once", action="store_true")
    p.add_argument("--interval-seconds", type=float)
    p.set_defaults(func=cmd_watch)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except (PermissionError, ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
