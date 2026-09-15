#!/usr/bin/env python3
"""Validate and optionally append a VidMoly catalogue record."""
from __future__ import annotations
import argparse, copy, json, re, sys
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

TYPES = {"episode", "movie", "ova", "ona", "extra", "other"}
CATEGORIES = {"main", "special", "movie", "ova", "ona", "extra", "other"}
VIDMOLY_HOSTS = {"vidmoly.org", "www.vidmoly.org", "vidmoly.net", "www.vidmoly.net", "vidmoly.me", "www.vidmoly.me", "vidmoly.to", "www.vidmoly.to", "vidmoly.biz", "www.vidmoly.biz", "vidmoly.cam", "www.vidmoly.cam"}

def fail(message: str) -> None:
    raise ValueError(message)

def clean(value) -> str:
    return str(value or "").strip()

def key(value) -> str:
    return " ".join(clean(value).split()).casefold()

def normalized_url(value: str) -> str:
    parsed = urlsplit(clean(value))
    return urlunsplit((parsed.scheme.casefold(), parsed.netloc.casefold(), parsed.path, "", ""))

def media_type(record: dict) -> str:
    value = clean(record.get("type")).casefold() or "episode"
    if value not in TYPES: fail(f"Invalid type: {value}")
    return value

def category(record: dict) -> str:
    value = clean(record.get("category")).casefold()
    if not value: value = "main" if media_type(record) == "episode" else media_type(record)
    if value not in CATEGORIES: fail(f"Invalid category: {value}")
    return value

def number(record: dict, name: str):
    value = record.get(name)
    if value in (None, ""): return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1: fail(f"Invalid {name}: {value!r}")
    return value

def validate_record(record: dict, index: int) -> dict:
    if not isinstance(record, dict): fail(f"Entry {index} is not an object")
    item = copy.deepcopy(record)
    item["type"] = media_type(item)
    item["category"] = category(item)
    if not clean(item.get("id")): fail(f"Entry {index} has an empty id")
    url = clean(item.get("embed") or item.get("url") or item.get("videoUrl"))
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in VIDMOLY_HOSTS or not re.fullmatch(r"/embed-[A-Za-z0-9_-]+\.html", parsed.path or "", re.I):
        fail(f"Entry {index} has an invalid VidMoly URL: {url!r}")
    item["embed"] = url
    typ, cat = item["type"], item["category"]
    season = number(item, "season")
    episode = number(item, "episode")
    special_date = clean(item.get("special_date"))
    if special_date:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", special_date): fail(f"Entry {index} has an invalid special_date")
        try: date.fromisoformat(special_date)
        except ValueError: fail(f"Entry {index} has an invalid special_date")
    if typ == "episode" and cat == "main" and episode is None and season is None: fail(f"Entry {index} needs episode or a special category")
    if typ != "episode" and episode is not None: fail(f"Entry {index} has episode on non-episode media")
    if typ != "episode" and cat == "main": fail(f"Entry {index} has main category on non-episode media")
    if special_date and (typ != "episode" or cat != "special" or episode is not None or season is not None): fail(f"Entry {index} has invalid date-special fields")
    if season is not None and (typ != "episode" or cat != "main"): fail(f"Entry {index} has season on non-seasonal media")
    if not isinstance(item.get("genres", []), list): fail(f"Entry {index} genres must be an array")
    return item

def validate_catalogue(videos: list[dict]) -> list[dict]:
    if not isinstance(videos, list): fail("videos.json must contain an array")
    normalized, ids, urls = [], set(), set()
    for index, record in enumerate(videos):
        item = validate_record(record, index)
        if item["id"] in ids: fail(f"Duplicate id: {item['id']}")
        url = normalized_url(item["embed"])
        if url in urls: fail(f"Duplicate URL: {item['embed']}")
        ids.add(item["id"]); urls.add(url); normalized.append(item)
    return normalized

def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-") or "media"

def update_episode_title(videos: list[dict], series_name: str, season: int | None, episode: int, episode_title: str) -> list[dict]:
    if not clean(episode_title):
        fail("--episode-title is required when updating a title")
    matches = [
        item for item in videos
        if key(item.get("series")) == key(series_name)
        and media_type(item) == "episode"
        and (season is None or item.get("season") == season)
        and item.get("episode") == episode
    ]
    if len(matches) != 1:
        fail(f"Expected exactly one matching episode, found {len(matches)}")
    updated = copy.deepcopy(videos)
    for item in updated:
        if item["id"] == matches[0]["id"]:
            item["episode_title"] = clean(episode_title)
            if not clean(item.get("description")) or item["description"].endswith("."):
                item["description"] = f"{item.get('title') or item['id']} — {clean(episode_title)}."
    return validate_catalogue(updated)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalogue", default="data/videos.json")
    parser.add_argument("--series-file", default="data/series.json")
    parser.add_argument("--series")
    parser.add_argument("--update-episode-title", action="store_true")
    parser.add_argument("--type", default="episode")
    parser.add_argument("--category")
    parser.add_argument("--season", type=int)
    parser.add_argument("--episode", default="AUTO")
    parser.add_argument("--episode-title", default="")
    parser.add_argument("--special-date", default="")
    parser.add_argument("--title", default="")
    parser.add_argument("--quality", default="1080p")
    parser.add_argument("--source-filename", default="")
    parser.add_argument("--vidmoly-url")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    catalogue_path = Path(args.catalogue)
    videos = json.loads(catalogue_path.read_text(encoding="utf-8"))
    normalized = validate_catalogue(videos)
    if args.validate_only:
        print(f"Validated {len(normalized)} catalogue records.")
        return 0
    if args.update_episode_title:
        if not args.series or args.episode in (None, "AUTO"):
            fail("Title updates require --series and a numeric --episode")
        updated = update_episode_title(normalized, args.series, args.season, int(args.episode), args.episode_title)
        catalogue_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        season_label = f"S{args.season:02d}" if args.season is not None else ""
        print(f"Updated episode title for {args.series} {season_label}E{int(args.episode):03d}".strip())
        return 0
    if not args.series or not args.vidmoly_url: fail("--series and --vidmoly-url are required")
    series_data = json.loads(Path(args.series_file).read_text(encoding="utf-8"))
    series_list = series_data.get("series", []) if isinstance(series_data, dict) else series_data
    matches = [item for item in series_list if key(item.get("name")) == key(args.series)]
    if len(matches) != 1: fail(f"Expected exactly one matching series, found {len(matches)}")
    meta = matches[0]; typ = clean(args.type).casefold() or "episode"; cat = clean(args.category).casefold() or ("main" if typ == "episode" else typ)
    if typ not in TYPES or cat not in CATEGORIES: fail("Invalid type/category")
    candidate_url = normalized_url(args.vidmoly_url)
    if candidate_url in {normalized_url(item["embed"]) for item in normalized}: fail("Duplicate normalized VidMoly URL")
    selected = [item for item in normalized if key(item.get("series")) == key(meta["name"]) and item["type"] == typ and item["category"] == cat and item.get("season") == args.season]
    numbered = [item.get("episode") for item in selected if isinstance(item.get("episode"), int)]
    if args.special_date:
        episode = None
    elif typ not in {"episode"} or cat in {"movie", "ova", "ona", "extra", "other"}:
        episode = None
    elif args.episode.upper() == "AUTO":
        episode = max(numbered, default=0) + 1
    else:
        episode = int(args.episode)
    if episode is not None and episode in numbered: fail(f"Duplicate episode identity: {episode}")
    if args.special_date:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.special_date): fail("special_date must use YYYY-MM-DD")
        try: date.fromisoformat(args.special_date)
        except ValueError: fail("special_date is not a valid ISO date")
        if any(item.get("special_date") == args.special_date for item in selected): fail("Duplicate special date")
    if typ != "episode" and any(item.get("type") == typ and item.get("category") == cat and key(item.get("title")) == key(args.title) and key(args.title) for item in selected): fail("Duplicate media identity")
    prefix = slug(meta.get("id") or meta.get("name")); suffix = f"-{episode:03d}" if episode is not None else (f"-{slug(args.special_date)}" if args.special_date else f"-{typ}")
    new_id = prefix + suffix
    if new_id in {item["id"] for item in normalized}: fail(f"Duplicate generated id: {new_id}")
    title = args.title.strip() or (f"{meta['name']} - Episode {episode:03d}" if episode is not None else f"{meta['name']} - {typ.upper()}")
    record = {"id": new_id, "title": title, "series": meta["name"], "type": typ, "category": cat, "year": meta.get("year"), "genres": meta.get("genres", []), "quality": args.quality, "description": args.episode_title or f"{title}.", "embed": args.vidmoly_url.strip(), "thumbnail": ""}
    if episode is not None: record["episode"] = episode
    if args.season is not None: record["season"] = args.season
    if args.episode_title: record["episode_title"] = args.episode_title
    if args.special_date: record["special_date"] = args.special_date
    if args.source_filename: record["source_filename"] = args.source_filename
    updated = validate_catalogue(normalized + [record])
    if updated[:-1] != normalized: fail("Data-loss safeguard failed")
    catalogue_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Added {new_id} to {catalogue_path}")
    return 0

if __name__ == "__main__":
    try: raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error: print(f"::error::{error}"); raise SystemExit(1)
