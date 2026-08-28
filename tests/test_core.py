import pytest

from qa_bounty_agent.bounties import normalize_opire_reward
from qa_bounty_agent.models import Action, Opportunity
from qa_bounty_agent.policy import decide
from qa_bounty_agent.reporting import opportunity_markdown
from qa_bounty_agent.runner import run_authorized_smoke
from qa_bounty_agent.scoring import rank


def test_external_platforms_never_auto_accept():
    for platform in ("utest", "testio", "testlio", "testbirds", "testerwork", "opire", "algora", "unknown"):
        d = decide(Opportunity(platform=platform, title="x"), target_authorized=True)
        assert d.auto_accept_allowed is False


def test_authorized_generic_target_can_run():
    d = decide(Opportunity(platform="generic-authorized", title="x"), target_authorized=True)
    assert d.action == Action.RUN_AUTHORIZED_TEST
    assert d.auto_test_allowed is True


def test_confidential_generic_target_is_blocked():
    d = decide(Opportunity(platform="generic-authorized", title="x", confidential=True), target_authorized=True)
    assert d.auto_test_allowed is False


def test_japan_japanese_opportunity_ranks_first():
    global_op = Opportunity(platform="x", title="global", qa_types=["functional"], payout_usd=100)
    jp_op = Opportunity(platform="x", title="jp", countries=["Japan"], languages=["Japanese"], qa_types=["functional"], payout_usd=10)
    assert rank([global_op, jp_op])[0].title == "jp"


def test_report_shows_auto_accept_false():
    op = Opportunity(platform="utest", title="sample")
    text = opportunity_markdown(op, decide(op))
    assert "Auto-accept allowed: False" in text


def test_runner_blocks_crowd_platform_even_with_authorization(tmp_path):
    with pytest.raises(PermissionError):
        run_authorized_smoke("https://example.com", tmp_path, platform="utest", authorized=True)


def test_normalize_opire_article_shape():
    op = normalize_opire_reward({
        "issue_url": "https://github.com/acme/app/issues/42",
        "amount": "70",
        "currency": "USD",
        "issue_title": "Fix flaky test",
        "language": "Python",
    })
    assert op.platform == "opire"
    assert op.url.endswith("/issues/42")
    assert op.payout_usd == 70.0
    assert op.languages == ["Python"]


def test_normalize_opire_nested_shape():
    op = normalize_opire_reward({
        "issue": {"url": "https://github.com/acme/app/issues/7", "title": "Bug"},
        "reward": {"amount": 20},
        "repository": {"language": "TypeScript"},
    })
    assert op.title == "Bug"
    assert op.payout_usd == 20.0
