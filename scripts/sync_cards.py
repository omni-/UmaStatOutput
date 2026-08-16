#!/usr/bin/env python3
"""Fetch and normalize Euophrys' Global support-card + event data for the static site."""
from __future__ import annotations
import argparse,json,re,sys,urllib.parse,urllib.request
from datetime import datetime,timezone
from pathlib import Path

DEFAULT_URL="https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/src/cards/gl.js"
DEFAULT_EVENTS_URL="https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/src/card-events.js"
DEFAULT_TITLES_URL="https://umamusu.wiki/api.php?"+urllib.parse.urlencode({
    "action":"cargoquery",
    "format":"json",
    "tables":"Game_Supports",
    "fields":"support_id,name_ww,name_ro",
    "limit":"500",
})
FIELDS=("id","type","rarity","limit_break","char_name","specialty_rate","unique_specialty","fs_specialty","tb","mb","fs_bonus","unique_fs_bonus","stat_bonus","fs_stats","fs_training","fs_motivation","fs_ramp","crowd_bonus","highlander_threshold","highlander_training","fan_bonus","wisdom_recovery","sb","offstat_appearance_denominator")
DEFAULTS={"specialty_rate":0,"unique_specialty":1,"fs_specialty":1,"tb":1,"mb":1,"fs_bonus":1,"unique_fs_bonus":1,"stat_bonus":[0,0,0,0,0,0],"fs_stats":[0,0,0,0,0,0],"fs_training":0,"fs_motivation":0,"fs_ramp":[0,0],"crowd_bonus":0,"highlander_threshold":99,"highlander_training":0,"fan_bonus":0,"wisdom_recovery":0,"sb":0,"offstat_appearance_denominator":4}
EVENT_RE=re.compile(r"^\s*(\d+):\s*(\[[^\]\n]+\])",re.MULTILINE)

def extract_json_array(source):
    start,end=source.find("["),source.rfind("]")
    if start<0 or end<=start: raise ValueError("Could not locate the card array in upstream gl.js")
    data=json.loads(source[start:end+1])
    if not isinstance(data,list): raise ValueError("Upstream card payload was not a list")
    return data

def extract_events(source):
    events={}
    for card_id,raw_array in EVENT_RE.findall(source):
        values=json.loads(raw_array)
        if len(values)>=8: events[int(card_id)]=values
    if len(events)<100: raise ValueError(f"Refusing suspiciously small event dataset ({len(events)} rows)")
    return events

def clean_title(value):
    value=(value or "").strip()
    if value.startswith("[") and "]" in value:
        value=value[1:value.index("]")]
    return value.strip()

def extract_titles(source):
    payload=json.loads(source)
    rows=payload.get("cargoquery",[])
    titles={}
    for row in rows:
        data=row.get("title",row)
        try: card_id=int(data.get("support_id"))
        except (TypeError,ValueError): continue
        title=clean_title(data.get("name_ww")) or clean_title(data.get("name_ro"))
        if title: titles[card_id]=title
    return titles

def normalize(cards,events,titles):
    result=[];seen=set()
    for raw in cards:
        if raw.get("group") or raw.get("type") not in range(5): continue
        item={}
        for field in FIELDS:
            if field in raw:item[field]=raw[field]
            elif field in DEFAULTS:item[field]=DEFAULTS[field]
            else:raise ValueError(f"Missing required field {field!r} for card {raw.get('id')}")
        key=(int(item["id"]),int(item["limit_break"]))
        if key in seen:raise ValueError(f"Duplicate card/LB row: {key}")
        seen.add(key)
        item["title"]=titles.get(int(item["id"]),"")
        item["event_stats"]=events.get(int(item["id"]))
        result.append(item)
    if len(result)<100:raise ValueError(f"Refusing suspiciously small dataset ({len(result)} rows)")
    result.sort(key=lambda c:(c["id"],c["limit_break"]))
    return result

def fetch_text(url):
    request=urllib.request.Request(url,headers={"User-Agent":"UmaStatOutput/1.2 (+https://github.com/omni-/UmaStatOutput)"})
    with urllib.request.urlopen(request,timeout=30) as response:return response.read().decode("utf-8")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",default=DEFAULT_URL)
    parser.add_argument("--events-url",default=DEFAULT_EVENTS_URL)
    parser.add_argument("--titles-url",default=DEFAULT_TITLES_URL)
    parser.add_argument("--input",type=Path)
    parser.add_argument("--events-input",type=Path)
    parser.add_argument("--titles-input",type=Path)
    parser.add_argument("--output",type=Path,default=Path("_site/data/cards.json"))
    args=parser.parse_args()
    source=args.input.read_text(encoding="utf-8") if args.input else fetch_text(args.url)
    event_source=args.events_input.read_text(encoding="utf-8") if args.events_input else fetch_text(args.events_url)
    title_source=args.titles_input.read_text(encoding="utf-8") if args.titles_input else fetch_text(args.titles_url)
    events=extract_events(event_source)
    titles=extract_titles(title_source)
    if len(titles)<50: raise ValueError(f"Refusing suspiciously small title dataset ({len(titles)} rows)")
    cards=normalize(extract_json_array(source),events,titles)
    unique_cards=len({c["id"] for c in cards})
    titled_cards=len({c["id"] for c in cards if c["title"]})
    payload={"sources":{"cards":args.url,"events":args.events_url,"titles":args.titles_url},"generated_at":datetime.now(timezone.utc).isoformat(),"card_count":unique_cards,"row_count":len(cards),"event_count":len(events),"title_count":len(titles),"cards":cards}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"Wrote {len(cards)} card/LB rows ({unique_cards} unique supports; {len(events)} event rows; {titled_cards} titled supports) to {args.output}")
    return 0

if __name__=="__main__":sys.exit(main())
