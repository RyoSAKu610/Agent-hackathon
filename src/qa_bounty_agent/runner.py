from __future__ import annotations

import os
import shutil
from pathlib import Path
from urllib.parse import urlparse

from .models import Opportunity
from .policy import decide


def run_authorized_smoke(url: str, output_dir: str | Path, *, platform: str = "generic-authorized", authorized: bool = False) -> dict:
    op = Opportunity(platform=platform, title=f"Authorized test: {url}", url=url, requires_login=False)
    decision = decide(op, target_authorized=authorized)
    if not decision.auto_test_allowed:
        raise PermissionError("Policy gate blocked browser execution. Use only an explicitly authorized target and an automation-permitted policy.")

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only http/https targets are supported.")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Browser extra is not installed. Run: pip install -e '.[browser]' && playwright install chromium") from exc

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    screenshot = out / "page.png"
    console_errors: list[str] = []
    failed_requests: list[str] = []
    http_errors: list[str] = []

    with sync_playwright() as p:
        launch_kwargs = {"headless": True}
        configured = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
        system_chromium = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
        if configured:
            launch_kwargs["executable_path"] = configured
        elif system_chromium:
            launch_kwargs["executable_path"] = system_chromium
        try:
            browser = p.chromium.launch(**launch_kwargs)
        except Exception as exc:
            raise RuntimeError(
                "Chromium could not be launched. Run 'playwright install chromium' or set "
                "PLAYWRIGHT_CHROMIUM_EXECUTABLE to an installed Chromium/Chrome binary."
            ) from exc
        page = browser.new_page()
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("requestfailed", lambda req: failed_requests.append(f"{req.method} {req.url}: {req.failure}"))
        page.on("response", lambda resp: http_errors.append(f"{resp.status} {resp.url}") if resp.status >= 400 else None)
        try:
            response = page.goto(url, wait_until="domcontentloaded")
            page.screenshot(path=str(screenshot), full_page=True)
        except Exception as exc:
            browser.close()
            raise RuntimeError(f"Browser navigation failed for {url}: {exc}") from exc
        result = {
            "url": url,
            "final_url": page.url,
            "title": page.title(),
            "status": response.status if response else None,
            "screenshot": str(screenshot),
            "console_errors": console_errors,
            "failed_requests": failed_requests,
            "http_errors": http_errors,
        }
        browser.close()
    return result
