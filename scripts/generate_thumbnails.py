#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests


USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0.0.0 Safari/537.36"
)

REQUEST_TIMEOUT = 30
RETRIES = 3

VIDMOLY_HOSTS = {
    "vidmoly.org",
    "www.vidmoly.org",
    "vidmoly.net",
    "www.vidmoly.net",
    "vidmoly.me",
    "www.vidmoly.me",
    "vidmoly.to",
    "www.vidmoly.to",
    "vidmoly.biz",
    "www.vidmoly.biz",
    "vidmoly.cam",
    "www.vidmoly.cam",
}

EMBED_PATH_RE = re.compile(
    r"^/embed-[A-Za-z0-9_-]+\.html$",
    re.IGNORECASE,
)

PLAYER_VALUE_RE = re.compile(
    r"""
    (?:
        \bimage\b |
        \bposter\b |
        \bthumbnail(?:Url|URL)?\b
    )
    \s*[:=]\s*
    ["']([^"'<>]+)["']
    """,
    re.IGNORECASE | re.VERBOSE,
)

META_IMAGE_RE = re.compile(
    r"""
    <meta\b
    [^>]*?
    (?:property|name)
    \s*=\s*
    ["']
    (?:og:image|og:image:url|twitter:image|twitter:image:src)
    ["']
    [^>]*?
    content
    \s*=\s*
    ["']([^"']+)["']
    [^>]*>
    """,
    re.IGNORECASE | re.VERBOSE,
)

META_IMAGE_RE_REVERSED = re.compile(
    r"""
    <meta\b
    [^>]*?
    content
    \s*=\s*
    ["']([^"']+)["']
    [^>]*?
    (?:property|name)
    \s*=\s*
    ["']
    (?:og:image|og:image:url|twitter:image|twitter:image:src)
    ["']
    [^>]*>
    """,
    re.IGNORECASE | re.VERBOSE,
)

HTML_IMAGE_RE = re.compile(
    r"""
    <
    (?:img|video|source|link)
    \b
    [^>]*?
    (?:
        poster |
        src |
        href
    )
    \s*=\s*
    ["']([^"']+)["']
    [^>]*>
    """,
    re.IGNORECASE | re.VERBOSE,
)

IMAGE_EXTENSION_RE = re.compile(
    r"\.(?:jpe?g|png|webp|avif)(?:[?#].*)?$",
    re.IGNORECASE,
)


def log(message: str) -> None:
    print(
        f"[vidmoly-thumbnail] {message}",
        flush=True,
    )


def is_vidmoly_embed(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False

    return (
        parsed.scheme in {"http", "https"}
        and (parsed.hostname or "").lower()
        in VIDMOLY_HOSTS
        and EMBED_PATH_RE.fullmatch(
            parsed.path or ""
        )
        is not None
    )


def normalise_url(
    value: str,
    base_url: str,
) -> str:
    if not value:
        return ""

    value = html.unescape(str(value))
    value = value.replace("\\/", "/")
    value = value.replace("\\u0026", "&")
    value = value.replace("\\u003f", "?")
    value = value.strip()

    if value.startswith(
        (
            "data:",
            "blob:",
            "javascript:",
        )
    ):
        return ""

    try:
        absolute = urljoin(
            base_url,
            value,
        )

        parsed = urlparse(
            absolute
        )

    except ValueError:
        return ""

    if parsed.scheme not in {
        "http",
        "https",
    }:
        return ""

    if not parsed.netloc:
        return ""

    return absolute


def deduplicate(
    values: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    seen: set[str] = set()
    result: list[tuple[str, str]] = []

    for source, value in values:
        if not value:
            continue

        if value in seen:
            continue

        seen.add(value)

        result.append(
            (
                source,
                value,
            )
        )

    return result


def extract_html_candidates(
    page_html: str,
    embed_url: str,
) -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []

    scripts = "\n".join(
        re.findall(
            r"<script\b[^>]*>.*?</script>",
            page_html,
            re.IGNORECASE | re.DOTALL,
        )
    )

    for match in PLAYER_VALUE_RE.finditer(
        scripts
    ):
        value = normalise_url(
            match.group(1),
            embed_url,
        )

        if value:
            candidates.append(
                (
                    "player",
                    value,
                )
            )

    for match in PLAYER_VALUE_RE.finditer(
        page_html
    ):
        value = normalise_url(
            match.group(1),
            embed_url,
        )

        if value:
            candidates.append(
                (
                    "page-config",
                    value,
                )
            )

    for regex in (
        META_IMAGE_RE,
        META_IMAGE_RE_REVERSED,
    ):
        for match in regex.finditer(
            page_html
        ):
            value = normalise_url(
                match.group(1),
                embed_url,
            )

            if value:
                candidates.append(
                    (
                        "metadata",
                        value,
                    )
                )

    for match in HTML_IMAGE_RE.finditer(
        page_html
    ):
        value = normalise_url(
            match.group(1),
            embed_url,
        )

        if not value:
            continue

        path = urlparse(
            value
        ).path or ""

        if IMAGE_EXTENSION_RE.search(
            path
        ):
            candidates.append(
                (
                    "html-image",
                    value,
                )
            )

    return deduplicate(
        candidates
    )


def request_embed(
    session: requests.Session,
    embed_url: str,
) -> str | None:

    parsed = urlparse(
        embed_url
    )

    referer = (
        f"{parsed.scheme}://"
        f"{parsed.netloc}/"
    )

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": (
            "text/html,application/xhtml+xml,"
            "application/xml;q=0.9,*/*;q=0.8"
        ),
        "Accept-Language": (
            "en-US,en;q=0.9"
        ),
        "Referer": referer,
    }

    for attempt in range(
        1,
        RETRIES + 1,
    ):
        try:
            response = session.get(
                embed_url,
                timeout=REQUEST_TIMEOUT,
                headers=headers,
                allow_redirects=True,
            )

            response.raise_for_status()

            final_host = (
                urlparse(
                    response.url
                ).hostname
                or ""
            ).lower()

            if final_host not in VIDMOLY_HOSTS:
                log(
                    "refusing redirected embed host "
                    f"{final_host or '<unknown>'}"
                )

                return None

            return response.text

        except requests.RequestException as exc:
            log(
                f"embed request attempt "
                f"{attempt}/{RETRIES} failed: {exc}"
            )

            if attempt < RETRIES:
                time.sleep(
                    attempt * 2
                )

    return None


def verify_image_url(
    session: requests.Session,
    image_url: str,
    referer_url: str,
) -> bool:

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": (
            "image/avif,image/webp,"
            "image/apng,image/*,"
            "*/*;q=0.8"
        ),
        "Referer": referer_url,
    }

    try:
        response = session.head(
            image_url,
            timeout=REQUEST_TIMEOUT,
            headers=headers,
            allow_redirects=True,
        )

        if (
            response.ok
            and response.headers.get(
                "content-type",
                "",
            ).lower().startswith(
                "image/"
            )
        ):
            return True

    except requests.RequestException:
        pass

    try:
        response = session.get(
            image_url,
            timeout=REQUEST_TIMEOUT,
            headers={
                **headers,
                "Range": "bytes=0-4095",
            },
            allow_redirects=True,
            stream=True,
        )

        try:
            return (
                response.ok
                and response.headers.get(
                    "content-type",
                    "",
                ).lower().startswith(
                    "image/"
                )
            )

        finally:
            response.close()

    except requests.RequestException:
        return False


def browser_candidates(
    embed_url: str,
) -> list[tuple[str, str]]:

    try:
        from playwright.sync_api import (
            sync_playwright,
        )

    except ImportError:
        log(
            "Playwright unavailable; "
            "browser fallback skipped"
        )

        return []

    candidates: list[
        tuple[str, str]
    ] = []

    try:
        with sync_playwright() as playwright:

            browser = (
                playwright.chromium.launch(
                    headless=True
                )
            )

            context = (
                browser.new_context(
                    user_agent=USER_AGENT,
                    viewport={
                        "width": 1280,
                        "height": 720,
                    },
                    locale="en-US",
                )
            )

            try:
                page = context.new_page()

                page.goto(
                    embed_url,
                    wait_until="domcontentloaded",
                    timeout=45000,
                )

                page.wait_for_timeout(
                    4000
                )

                jw_values = page.evaluate(
                    """
                    () => {
                        const output = [];

                        try {
                            if (
                                typeof window.jwplayer ===
                                "function"
                            ) {
                                const player =
                                    window.jwplayer();

                                const items = [
                                    player?.getPlaylistItem?.(),
                                    ...(player?.getPlaylist?.() || [])
                                ];

                                for (
                                    const item of items
                                ) {
                                    if (!item) continue;

                                    for (
                                        const key of [
                                            "image",
                                            "poster",
                                            "thumbnail"
                                        ]
                                    ) {
                                        if (item[key]) {
                                            output.push(
                                                item[key]
                                            );
                                        }
                                    }
                                }
                            }
                        } catch (_) {}

                        return output;
                    }
                    """
                )

                for value in (
                    jw_values or []
                ):
                    candidate = normalise_url(
                        str(value),
                        embed_url,
                    )

                    if candidate:
                        candidates.append(
                            (
                                "jwplayer",
                                candidate,
                            )
                        )

                candidates.extend(
                    extract_html_candidates(
                        page.content(),
                        embed_url,
                    )
                )

                dom_values = page.evaluate(
                    """
                    () => Array.from(
                        document.querySelectorAll(
                            'video[poster],' +
                            '[data-poster],' +
                            '[poster],' +
                            'meta[property="og:image"],' +
                            'meta[name="twitter:image"]'
                        )
                    )
                    .map(
                        n =>
                            n.getAttribute("poster") ||
                            n.getAttribute("data-poster") ||
                            n.getAttribute("content") ||
                            ""
                    )
                    .filter(Boolean)
                    """
                )

                for value in (
                    dom_values or []
                ):
                    candidate = normalise_url(
                        str(value),
                        embed_url,
                    )

                    if candidate:
                        candidates.append(
                            (
                                "rendered-dom",
                                candidate,
                            )
                        )

            finally:
                context.close()
                browser.close()

    except Exception as exc:
        log(
            f"browser fallback failed: {exc}"
        )

    return deduplicate(
        candidates
    )


def choose_thumbnail(
    session: requests.Session,
    embed_url: str,
) -> tuple[str, str] | None:

    page_html = request_embed(
        session,
        embed_url,
    )

    if page_html:
        for source, candidate in (
            extract_html_candidates(
                page_html,
                embed_url,
            )
        ):
            if verify_image_url(
                session,
                candidate,
                embed_url,
            ):
                return (
                    source,
                    candidate,
                )

    for source, candidate in (
        browser_candidates(
            embed_url
        )
    ):
        if verify_image_url(
            session,
            candidate,
            embed_url,
        ):
            return (
                source,
                candidate,
            )

    return None


def put_thumbnail_after_embed(
    video: dict,
    thumbnail_url: str,
) -> None:

    rebuilt: dict = {}
    inserted = False

    for key, value in video.items():

        if key == "thumbnail":
            continue

        rebuilt[key] = value

        if key == "embed":
            rebuilt[
                "thumbnail"
            ] = thumbnail_url

            inserted = True

    if not inserted:
        rebuilt[
            "thumbnail"
        ] = thumbnail_url

    video.clear()
    video.update(
        rebuilt
    )


def process_catalogue(
    catalogue_path: Path,
    *,
    force: bool,
) -> tuple[int, int, int]:

    try:
        data = json.loads(
            catalogue_path.read_text(
                encoding="utf-8"
            )
        )

    except Exception as exc:
        raise RuntimeError(
            f"Could not parse "
            f"{catalogue_path}: {exc}"
        ) from exc

    if not isinstance(
        data,
        list,
    ):
        raise RuntimeError(
            f"{catalogue_path} must contain "
            "a top-level JSON array"
        )

    session = requests.Session()

    session.headers.update(
        {
            "User-Agent": USER_AGENT
        }
    )

    updated = 0
    unchanged = 0
    failed = 0

    try:

        for index, video in enumerate(
            data,
            start=1,
        ):

            if not isinstance(
                video,
                dict,
            ):
                failed += 1

                log(
                    f"item {index}: "
                    "invalid object"
                )

                continue

            video_id = str(
                video.get(
                    "id",
                    f"item-{index}",
                )
            ).strip()

            embed = str(
                video.get(
                    "embed",
                    video.get(
                        "url",
                        "",
                    ),
                )
            ).strip()

            if not is_vidmoly_embed(
                embed
            ):
                unchanged += 1

                log(
                    f"{video_id}: "
                    "not a supported VidMoly embed"
                )

                continue

            existing = str(
                video.get(
                    "thumbnail",
                    "",
                )
            ).strip()

            if (
                existing
                and not force
            ):
                unchanged += 1

                log(
                    f"{video_id}: "
                    "thumbnail already present"
                )

                continue

            log(
                f"{video_id}: extracting from "
                f"{embed}"
            )

            result = choose_thumbnail(
                session,
                embed,
            )

            if result is None:
                failed += 1

                log(
                    f"{video_id}: no usable "
                    "thumbnail found; "
                    "existing value preserved"
                )

                continue

            source, thumbnail_url = result

            if thumbnail_url == existing:
                unchanged += 1

                log(
                    f"{video_id}: "
                    "thumbnail unchanged"
                )

                continue

            put_thumbnail_after_embed(
                video,
                thumbnail_url,
            )

            updated += 1

            log(
                f"{video_id}: thumbnail added "
                f"via {source}"
            )

    finally:
        session.close()

    catalogue_path.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    return (
        updated,
        unchanged,
        failed,
    )


def main() -> int:

    parser = argparse.ArgumentParser(
        description=(
            "Extract VidMoly thumbnails "
            "into videos.json"
        )
    )

    parser.add_argument(
        "--catalogue",
        default="data/videos.json",
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "refresh thumbnails even when "
            "one already exists"
        ),
    )

    args = parser.parse_args()

    updated, unchanged, failed = (
        process_catalogue(
            Path(
                args.catalogue
            ),
            force=args.force,
        )
    )

    log(
        f"complete: "
        f"updated={updated}, "
        f"unchanged={unchanged}, "
        f"failed={failed}"
    )

    return 0


if __name__ == "__main__":
    sys.exit(
        main()
        )
