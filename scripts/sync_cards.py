#!/usr/bin/env python3
"""Fetch and normalize Euophrys support-card + event data for the static site."""
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
DEFAULT_JP_URL = "https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/src/cards/jp.js"
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
UNQUOTED_KEY_RE = re.compile(r'([,{]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)', re.MULTILINE)
TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def extract_json_array(source: str):
    """Read Euophrys card modules without executing upstream JavaScript.

    Older/generated card files contain strict JSON objects, while newer files may
    be formatter-normalized JavaScript object literals with bare property names
    and trailing commas. Both still contain a single exported array, so convert
    only those two JS syntax differences and then let json.loads validate data.
    """
    start, end = source.find("["), source.rfind("]")
    if start < 0 or end <= start:
        raise ValueError("Could not locate the card array in upstream card module")
    literal = source[start : end + 1]
    try:
        data = json.loads(literal)
    except json.JSONDecodeError as original_error:
        normalized = UNQUOTED_KEY_RE.sub(r'\1"\2"\3', literal)
        normalized = TRAILING_COMMA_RE.sub(r"\1", normalized)
        try:
            data = json.loads(normalized)
        except json.JSONDecodeError:
            raise original_error
    if not isinstance(data, list):
        raise ValueError("Upstream card payload was not a list")
    return data


def extract_events(source: str, minimum_rows: int = 100):
    events = {}
    for card_id, raw_array in EVENT_RE.findall(source):
        values = json.loads(raw_array)
        if len(values) >= 8:
            events[int(card_id)] = values
    if len(events) < minimum_rows:
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
        headers={"User-Agent": "UmaStatOutput/1.5 (+https://github.com/omni-/UmaStatOutput)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def fetch_json(url: str):
    return json.loads(fetch_text(url))


def extract_metadata_from_file(source: str):
    payload = json.loads(source)
    if isinstance(payload, dict) and all(str(k).isdigit() for k in payload):
        titles = {int(k): clean_title(v) for k, v in payload.items() if clean_title(v)}
        return titles, {}
    titles = {}
    portraits = {}
    for row in rows_from_payload(payload):
        card_id = id_from_row(row)
        title = title_from_row(row)
        if card_id is not None and title:
            titles[card_id] = title
        portrait = str(row.get("portrait_url") or row.get("thumb_img") or "").strip() if isinstance(row, dict) else ""
        if card_id is not None and portrait:
            portraits[card_id] = portrait
    return titles, portraits


def fetch_umapyoi_metadata(list_url: str, target_ids: set[int]):
    titles = {}
    portraits = {}
    card_to_chara = {}
    try:
        list_payload = fetch_json(list_url)
        list_rows = rows_from_payload(list_payload)
        if not list_rows:
            raise ValueError("support list contained no rows")

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

        api_root = list_url.rsplit("/support", 1)[0]
        try:
            character_rows = rows_from_payload(fetch_json(f"{api_root}/character/list"))
            portraits_by_chara = {}
            for row in character_rows:
                chara_id = id_from_row(row)
                if chara_id is None or not isinstance(row, dict):
                    continue
                portrait = str(row.get("thumb_img") or row.get("thumbImg") or "").strip()
                if portrait:
                    portraits_by_chara[chara_id] = portrait
            for card_id, chara_id in card_to_chara.items():
                if chara_id in portraits_by_chara:
                    portraits[card_id] = portraits_by_chara[chara_id]
        except Exception as exc:
            print(f"WARN: Umapyoi portrait enrichment unavailable: {exc}", file=sys.stderr)

        base = list_url.rstrip("/")
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
        print(f"WARN: Umapyoi metadata enrichment unavailable; deploying without it: {exc}", file=sys.stderr)

    return titles, portraits


def valid_training_card(raw):
    return (
        isinstance(raw, dict)
        and not raw.get("group")
        and raw.get("type") in range(5)
        and id_from_row(raw) is not None
    )


def normalize(cards, events, titles, portraits, minimum_rows: int = 100, *, is_future=False):
    result = []
    seen = set()
    for raw in cards:
        if not valid_training_card(raw):
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
        card_id = int(item["id"])
        item["title"] = titles.get(card_id, "")
        item["portrait_url"] = portraits.get(card_id, "")
        item["event_stats"] = events.get(card_id)
        item["is_future"] = bool(is_future)
        result.append(item)
    if len(result) < minimum_rows:
        raise ValueError(f"Refusing suspiciously small dataset ({len(result)} rows)")
    result.sort(key=lambda c: (c["id"], c["limit_break"]))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--jp-url", default=DEFAULT_JP_URL)
    parser.add_argument("--events-url", default=DEFAULT_EVENTS_URL)
    parser.add_argument("--titles-url", default=DEFAULT_TITLES_URL)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--jp-input", type=Path)
    parser.add_argument("--events-input", type=Path)
    parser.add_argument("--titles-input", type=Path)
    parser.add_argument("--output", type=Path, default=Path("_site/data/cards.json"))
    args = parser.parse_args()

    source = args.input.read_text(encoding="utf-8") if args.input else fetch_text(args.url)
    event_source = args.events_input.read_text(encoding="utf-8") if args.events_input else fetch_text(args.events_url)
    raw_global = extract_json_array(source)
    global_ids = {int(card["id"]) for card in raw_global if valid_training_card(card)}
    events = extract_events(event_source)

    raw_future = []
    try:
        jp_source = args.jp_input.read_text(encoding="utf-8") if args.jp_input else fetch_text(args.jp_url)
        raw_jp = extract_json_array(jp_source)
        raw_future = [
            card for card in raw_jp
            if valid_training_card(card) and int(card["id"]) not in global_ids
        ]
    except Exception as exc:
        print(f"WARN: JP future-card dataset unavailable; deploying Global cards only: {exc}", file=sys.stderr)

    future_ids = {int(card["id"]) for card in raw_future}
    target_ids = global_ids | future_ids
    if args.titles_input:
        titles, portraits = extract_metadata_from_file(args.titles_input.read_text(encoding="utf-8"))
    else:
        titles, portraits = fetch_umapyoi_metadata(args.titles_url, target_ids)

    global_cards = normalize(raw_global, events, titles, portraits, is_future=False)
    future_cards = normalize(raw_future, events, titles, portraits, minimum_rows=0, is_future=True)
    cards = sorted(global_cards + future_cards, key=lambda c: (c["id"], c["limit_break"]))

    global_count = len({c["id"] for c in global_cards})
    future_count = len({c["id"] for c in future_cards})
    unique_cards = global_count + future_count
    titled_cards = len({c["id"] for c in cards if c["title"]})
    portrait_cards = len({c["id"] for c in cards if c["portrait_url"]})
    if titled_cards < unique_cards:
        print(f"WARN: title metadata available for {titled_cards}/{unique_cards} supports.", file=sys.stderr)
    if portrait_cards < unique_cards:
        print(f"WARN: portrait metadata available for {portrait_cards}/{unique_cards} supports; missing portraits fall back to card art.", file=sys.stderr)

    payload = {
        "sources": {
            "global_cards": args.url,
            "jp_cards": args.jp_url,
            "events": args.events_url,
            "metadata": args.titles_url,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "card_count": unique_cards,
        "global_card_count": global_count,
        "future_card_count": future_count,
        "row_count": len(cards),
        "event_count": len(events),
        "title_count": titled_cards,
        "portrait_count": portrait_cards,
        "cards": cards,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {len(cards)} card/LB rows ({global_count} Global + {future_count} future supports; "
        f"{len(events)} event rows; {titled_cards} titles; {portrait_cards} portraits) to {args.output}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
