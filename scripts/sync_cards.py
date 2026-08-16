#!/usr/bin/env python3
"""Fetch and normalize Euophrys' Global support-card + event data for the static site."""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_URL = "https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/src/cards/gl.js"
DEFAULT_EVENTS_URL = "https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/src/card-events.js"
DEFAULT_TITLES_URL = "https://api.umapyoi.net/api/v1/support"
FIELDS = (
    "id", "type", "rarity", "limit_break", "char_name", "specialty_rate",
    "unique_specialty", "fs_specialty", "tb", "mb", "fs_bonus",
    "unique_fs_bonus", "stat_bonus", "fs_stats", "fs_training",
    "fs_motivation", "fs_ramp", "crowd_bonus", "highlander_threshold",
    "highlander_training", "fan_bonus", "wisdom_recovery", "sb",
    "offstat_appearance_denominator",
)
DEFAULTS = {
    "specialty_rate": 0,
    "unique_specialty": 1,
    "fs_specialty": 1,
    "tb": 1,
    "mb": 1,
    "fs_bonus": 1,
    "unique_fs_bonus": 1,
    "stat_bonus": [0, 0, 0, 0, 0, 0],
    "fs_stats": [0, 0, 0, 0, 0, 0],
    "fs_training": 0,
    "fs_motivation": 0,
    "fs_ramp": [0, 0],
    "crowd_bonus": 0,
    "highlander_threshold": 99,
    "highlander_training": 0,
    "fan_bonus": 0,
    "wisdom_recovery": 0,
    "sb": 0,
    "offstat_appearance_denominator": 4,
}
EVENT_RE = re.compile(r"^\s*(\d+):\s*(\[[^\]\n]+\])", re.MULTILINE)


def extract_json_array(source: str):
    start, end = source.find("["), source.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("Could not locate the card array in upstream gl.js")
    data = json.loads(source[start : end + 1])
    if not isinstance(data, list):
        raise ValueError("Upstream card payload was not a list")
    return data


def extract_events(source: str):
    events = {}
    for card_id, raw_array in EVENT_RE.findall(source):
        values = json.loads(raw_array)
        if len(values) >= 8:
            events[int(card_id)] = values
    if len(events) < 100:
        raise ValueError(f"Refusing suspiciously small event dataset ({len(events)} rows)")
    return events


def clean_title(value):
    value = str(value or "").strip()
    if value.startswith("[") and "]" in value:
        value = value[1 : value.index("]")]
    return value.strip()


def rows_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("data", "supports", "support_cards", "supportData"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def title_from_row(row):
    if not isinstance(row, dict):
        return ""
    return clean_title(
        row.get("title_en")
        or row.get("titleEn")
        or row.get("name_en")
        or row.get("title")
    )


def id_from_row(row):
    if not isinstance(row, dict):
        return None
    value = row.get("id", row.get("support_id"))
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def chara_id_from_row(row):
    if not isinstance(row, dict):
        return None
    value = row.get("chara_id", row.get("char_id"))
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_text(url: str):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "UmaStatOutput/1.3 (+https://github.com/omni-/UmaStatOutput)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def fetch_json(url: str):
    return json.loads(fetch_text(url))


def extract_titles_from_file(source: str):
    """Accept a local fixture/cache in either list or {id:title} form."""
    payload = json.loads(source)
    if isinstance(payload, dict) and all(str(k).isdigit() for k in payload):
        return {int(k): clean_title(v) for k, v in payload.items() if clean_title(v)}
    titles = {}
    for row in rows_from_payload(payload):
        card_id = id_from_row(row)
        title = title_from_row(row)
        if card_id is not None and title:
            titles[card_id] = title
    return titles


def fetch_umapyoi_titles(list_url: str, target_ids: set[int]):
    """Enrich titles through Umapyoi without making metadata availability build-critical.

    The list endpoint supplies IDs and character IDs. If it also contains titles, use them
    immediately. Otherwise query per-character endpoints, which returns all support data for
    that character. Any still-unmatched cards fall back to the documented per-card endpoint.
    Requests are intentionally paced so the scheduled GitHub Action is polite to the API.
    """
    titles = {}
    try:
        list_payload = fetch_json(list_url)
        list_rows = rows_from_payload(list_payload)
        if not list_rows:
            raise ValueError("support list contained no rows")

        card_to_chara = {}
        for row in list_rows:
            card_id = id_from_row(row)
            if card_id is None or card_id not in target_ids:
                continue
            chara_id = chara_id_from_row(row)
            if chara_id is not None:
                card_to_chara[card_id] = chara_id
            title = title_from_row(row)
            if title:
                titles[card_id] = title

        base = list_url.rstrip("/")
        missing = target_ids - titles.keys()
        character_ids = sorted({card_to_chara[cid] for cid in missing if cid in card_to_chara})

        for chara_id in character_ids:
            try:
                payload = fetch_json(f"{base}/character/{chara_id}")
                for row in rows_from_payload(payload):
                    card_id = id_from_row(row)
                    title = title_from_row(row)
                    if card_id in target_ids and title:
                        titles[card_id] = title
            except Exception as exc:  # Metadata enrichment must never break deployment.
                print(f"WARN: Umapyoi character {chara_id} title lookup failed: {exc}", file=sys.stderr)
            time.sleep(0.13)

        for card_id in sorted(target_ids - titles.keys()):
            try:
                payload = fetch_json(f"{base}/{card_id}")
                rows = rows_from_payload(payload)
                candidates = rows if rows else [payload]
                for row in candidates:
                    if id_from_row(row) in (None, card_id):
                        title = title_from_row(row)
                        if title:
                            titles[card_id] = title
                            break
            except Exception as exc:
                print(f"WARN: Umapyoi support {card_id} title lookup failed: {exc}", file=sys.stderr)
            time.sleep(0.13)
    except Exception as exc:
        print(f"WARN: Umapyoi title enrichment unavailable; deploying without titles: {exc}", file=sys.stderr)

    return titles


def normalize(cards, events, titles):
    result = []
    seen = set()
    for raw in cards:
        if raw.get("group") or raw.get("type") not in range(5):
            continue
        item = {}
        for field in FIELDS:
            if field in raw:
                item[field] = raw[field]
            elif field in DEFAULTS:
                item[field] = DEFAULTS[field]
            else:
                raise ValueError(f"Missing required field {field!r} for card {raw.get('id')}")
        key = (int(item["id"]), int(item["limit_break"]))
        if key in seen:
            raise ValueError(f"Duplicate card/LB row: {key}")
        seen.add(key)
        item["title"] = titles.get(int(item["id"]), "")
        item["event_stats"] = events.get(int(item["id"]))
        result.append(item)
    if len(result) < 100:
        raise ValueError(f"Refusing suspiciously small dataset ({len(result)} rows)")
    result.sort(key=lambda c: (c["id"], c["limit_break"]))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--events-url", default=DEFAULT_EVENTS_URL)
    parser.add_argument("--titles-url", default=DEFAULT_TITLES_URL)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--events-input", type=Path)
    parser.add_argument("--titles-input", type=Path)
    parser.add_argument("--output", type=Path, default=Path("_site/data/cards.json"))
    args = parser.parse_args()

    source = args.input.read_text(encoding="utf-8") if args.input else fetch_text(args.url)
    event_source = (
        args.events_input.read_text(encoding="utf-8")
        if args.events_input
        else fetch_text(args.events_url)
    )
    raw_cards = extract_json_array(source)
    target_ids = {
        int(card["id"])
        for card in raw_cards
        if not card.get("group") and card.get("type") in range(5)
    }
    events = extract_events(event_source)

    if args.titles_input:
        titles = extract_titles_from_file(args.titles_input.read_text(encoding="utf-8"))
    else:
        titles = fetch_umapyoi_titles(args.titles_url, target_ids)

    cards = normalize(raw_cards, events, titles)
    unique_cards = len({c["id"] for c in cards})
    titled_cards = len({c["id"] for c in cards if c["title"]})
    if titled_cards < unique_cards:
        print(
            f"WARN: title metadata available for {titled_cards}/{unique_cards} Global supports; "
            "untitled cards will fall back to character/type/ID search.",
            file=sys.stderr,
        )

    payload = {
        "sources": {"cards": args.url, "events": args.events_url, "titles": args.titles_url},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "card_count": unique_cards,
        "row_count": len(cards),
        "event_count": len(events),
        "title_count": titled_cards,
        "cards": cards,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Wrote {len(cards)} card/LB rows ({unique_cards} unique supports; "
        f"{len(events)} event rows; {titled_cards} titled supports) to {args.output}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
