#!/usr/bin/env python3
"""Fetch and normalize Euophrys Global cards plus JP-only future supports."""
from __future__ import annotations
import argparse,json,os,re,sys,time,urllib.parse,urllib.request
from datetime import datetime,timezone
from pathlib import Path
DEFAULT_URL="https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/src/cards/gl.js"
DEFAULT_JP_URL="https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/src/cards/jp.js"
DEFAULT_EVENTS_URL="https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/src/card-events.js"
DEFAULT_TITLES_URL="https://api.umapyoi.net/api/v1/support"
DEFAULT_UNIQUES_URL="https://raw.githubusercontent.com/niiyant/uma--guide/main/DB/SOPORTES/supports.json"
FIELDS=("id","type","group","rarity","limit_break","char_name","starting_stats","specialty_rate","unique_specialty","fs_specialty","tb","mb","fs_bonus","unique_fs_bonus","stat_bonus","fs_stats","fs_training","fs_motivation","fs_ramp","crowd_bonus","highlander_threshold","highlander_training","fan_bonus","wisdom_recovery","sb","offstat_appearance_denominator","effect_size_up","energy_up")
DEFAULTS={"group":False,"starting_stats":[0,0,0,0,0],"specialty_rate":0,"unique_specialty":1,"fs_specialty":1,"tb":1,"mb":1,"fs_bonus":1,"unique_fs_bonus":1,"stat_bonus":[0,0,0,0,0,0],"fs_stats":[0,0,0,0,0,0],"fs_training":0,"fs_motivation":0,"fs_ramp":[0,0],"crowd_bonus":0,"highlander_threshold":99,"highlander_training":0,"fan_bonus":0,"wisdom_recovery":0,"sb":0,"offstat_appearance_denominator":4,"effect_size_up":1,"energy_up":1}
# Types 0-4 are the five training specialties; type 6 covers friend and group
# supports, which have no specialty room but still appear on trainings.
PLAYABLE_TYPES=(0,1,2,3,4,6)
IMAGE_URL_TEMPLATE="https://raw.githubusercontent.com/Euophrys/umamusume-tierlist/main/public/cardImages/support_card_s_{card_id}.png"
# Where the page looks for the art that --images copies into the artifact.
IMAGE_WEB_PREFIX="./img/"
SUPPORT_IMAGE_NAME="support_card_s_{card_id}.png"
PORTRAIT_NAME="portrait_{card_id}"
# A run against a throttling or unreachable host should give up on images
# rather than spend hours timing out one file at a time; the page falls back to
# the upstream host for anything missing.
CONSECUTIVE_IMAGE_FAILURE_LIMIT=20
EVENT_RE=re.compile(r"^\s*(\d+):\s*(\[[^\]\n]+\])",re.MULTILINE)
def _jsonify_js_object_literal(text:str):
    out=[];i=0;in_string=False;escaped=False
    while i<len(text):
        ch=text[i]
        if in_string:
            out.append(ch)
            if escaped:escaped=False
            elif ch=="\\":escaped=True
            elif ch=='"':in_string=False
            i+=1;continue
        if ch=='"':
            in_string=True;out.append(ch);i+=1;continue
        if ch==",":
            j=i+1
            while j<len(text) and text[j].isspace():j+=1
            if j<len(text) and text[j] in "}]":
                i+=1;continue
        if ch in "{,":
            out.append(ch);i+=1
            while i<len(text) and text[i].isspace():out.append(text[i]);i+=1
            if i<len(text) and (text[i].isalpha() or text[i] in "_$"):
                key_start=i;i+=1
                while i<len(text) and (text[i].isalnum() or text[i] in "_$"):i+=1
                key=text[key_start:i];j=i
                while j<len(text) and text[j].isspace():j+=1
                if j<len(text) and text[j]==":":
                    out.append(json.dumps(key));out.append(text[i:j]);out.append(":");i=j+1;continue
                out.append(text[key_start:i]);continue
            continue
        out.append(ch);i+=1
    return "".join(out)
def extract_json_array(source:str):
    start,end=source.find("["),source.rfind("]")
    if start<0 or end<=start: raise ValueError("Could not locate the card array in upstream card data")
    payload=source[start:end+1]
    try:data=json.loads(payload)
    except json.JSONDecodeError:data=json.loads(_jsonify_js_object_literal(payload))
    if not isinstance(data,list): raise ValueError("Upstream card payload was not a list")
    return data
def extract_events(source:str,minimum_rows:int=100):
    events={}
    for card_id,raw in EVENT_RE.findall(source):
        values=json.loads(raw)
        if len(values)>=8: events[int(card_id)]=values
    if len(events)<minimum_rows: raise ValueError(f"Refusing suspiciously small event dataset ({len(events)} rows)")
    return events
def clean_title(value):
    value=str(value or "").strip()
    if value.startswith("[") and "]" in value:value=value[1:value.index("]")]
    return value.strip()
def rows_from_payload(payload):
    if isinstance(payload,list):return payload
    if not isinstance(payload,dict):return []
    for key in ("data","supports","support_cards","supportData","characters"):
        if isinstance(payload.get(key),list):return payload[key]
    return []
def support_detail_rows(payload):
    if isinstance(payload,list):return payload
    if not isinstance(payload,dict):return []
    page_props=payload.get("pageProps")
    if isinstance(page_props,dict):
        if isinstance(page_props.get("supportData"),list):return page_props["supportData"]
        if isinstance(page_props.get("itemData"),dict):return [page_props["itemData"]]
    return rows_from_payload(payload)
def title_from_row(row):
    if not isinstance(row,dict):return ""
    return clean_title(row.get("title_en") or row.get("titleEn") or row.get("name_en") or row.get("title"))
def id_from_row(row):
    if not isinstance(row,dict):return None
    try:return int(row.get("id",row.get("support_id")))
    except (TypeError,ValueError):return None
def chara_id_from_row(row):
    if not isinstance(row,dict):return None
    try:return int(row.get("chara_id",row.get("char_id")))
    except (TypeError,ValueError):return None
def game_id_from_row(row):
    if not isinstance(row,dict):return None
    try:return int(row.get("game_id",row.get("gameId")))
    except (TypeError,ValueError):return None
def fetch_text(url:str):
    request=urllib.request.Request(url,headers={"User-Agent":"UmaStatOutput/1.6 (+https://github.com/omni-/UmaStatOutput)"})
    with urllib.request.urlopen(request,timeout=30) as response:return response.read().decode("utf-8")
def fetch_bytes(url:str,timeout:int=15):
    request=urllib.request.Request(url,headers={"User-Agent":"UmaStatOutput/1.6 (+https://github.com/omni-/UmaStatOutput)"})
    with urllib.request.urlopen(request,timeout=timeout) as response:return response.read()
def fetch_with_retries(fetch,attempts:int=3,delay:float=2.0):
    """Retries a fetch a couple of times so one slow response does not decide
    whether a deploy happens."""
    for attempt in range(attempts):
        try:return fetch()
        except Exception:
            if attempt==attempts-1:raise
            time.sleep(delay*(attempt+1))
def write_file_atomically(target:Path,data:bytes):
    """Writes through a temporary name so a cancelled job cannot leave a
    truncated file behind for the next run to treat as already downloaded."""
    temporary=target.with_name(f"{target.name}.part")
    temporary.write_bytes(data);os.replace(temporary,target)
def fetch_json(url:str):return json.loads(fetch_text(url))
def extract_metadata_from_file(source:str):
    payload=json.loads(source)
    if isinstance(payload,dict) and all(str(k).isdigit() for k in payload):return {int(k):clean_title(v) for k,v in payload.items() if clean_title(v)},{}
    titles,portraits={},{}
    for row in rows_from_payload(payload):
        card_id=id_from_row(row);title=title_from_row(row)
        if card_id is not None and title:titles[card_id]=title
        portrait=str(row.get("portrait_url") or row.get("thumb_img") or "").strip() if isinstance(row,dict) else ""
        if card_id is not None and portrait:portraits[card_id]=portrait
    return titles,portraits
def extract_unique_metadata(payload):
    result={}
    for row in support_detail_rows(payload):
        card_id=id_from_row(row)
        if card_id is None:continue
        raw_unique=row.get("unique") if isinstance(row,dict) else None
        if not isinstance(raw_unique,dict):
            result[card_id]={"level":None,"effects":[]};continue
        level=raw_unique.get("level")
        try:level=int(level) if level is not None else None
        except (TypeError,ValueError):level=None
        normalized=[]
        for effect in raw_unique.get("effects") or []:
            if not isinstance(effect,dict):continue
            try:effect_type=int(effect.get("type"))
            except (TypeError,ValueError):continue
            clean={"type":effect_type}
            for key,value in effect.items():
                if key=="type" or not str(key).startswith("value"):continue
                try:clean[key]=int(value) if value is not None else None
                except (TypeError,ValueError):clean[key]=value
            normalized.append(clean)
        result[card_id]={"level":level,"effects":normalized}
    return result
def join_umapyoi_metadata(support_rows,character_rows,target_ids:set[int]):
    titles,names,portraits,card_to_chara={},{},{},{}
    for row in support_rows:
        card_id=id_from_row(row)
        if card_id is None or card_id not in target_ids:continue
        chara_id=chara_id_from_row(row)
        if chara_id is not None:card_to_chara[card_id]=chara_id
        title=title_from_row(row)
        if title:titles[card_id]=title
    characters={}
    for row in character_rows:
        game_id=game_id_from_row(row)
        if game_id is not None and isinstance(row,dict):characters[game_id]=row
    for card_id,chara_id in card_to_chara.items():
        row=characters.get(chara_id)
        if not row:continue
        name=str(row.get("name_en") or row.get("nameEn") or "").strip()
        portrait=str(row.get("thumb_img") or row.get("thumbImg") or "").strip()
        if name:names[card_id]=name
        if portrait:portraits[card_id]=portrait
    return titles,names,portraits
def fetch_umapyoi_metadata(list_url:str,target_ids:set[int]):
    titles,names,portraits={},{},{}
    try:
        support_rows=rows_from_payload(fetch_json(list_url))
        if not support_rows:raise ValueError("support list contained no rows")
        api_root=list_url.rsplit("/support",1)[0]
        try:
            character_rows=rows_from_payload(fetch_json(f"{api_root}/character/info"))
            titles,names,portraits=join_umapyoi_metadata(support_rows,character_rows,target_ids)
        except Exception as exc:
            print(f"WARN: Umapyoi character enrichment unavailable: {exc}",file=sys.stderr)
            titles,_,_=join_umapyoi_metadata(support_rows,[],target_ids)
        base=list_url.rstrip("/")
        for card_id in sorted(target_ids-titles.keys()):
            try:
                payload=fetch_json(f"{base}/{card_id}");candidates=rows_from_payload(payload) or [payload]
                for row in candidates:
                    if id_from_row(row) in (None,card_id):
                        title=title_from_row(row)
                        if title:titles[card_id]=title;break
            except Exception as exc:print(f"WARN: Umapyoi support {card_id} title lookup failed: {exc}",file=sys.stderr)
            time.sleep(.13)
    except Exception as exc:print(f"WARN: Umapyoi metadata enrichment unavailable; deploying without it: {exc}",file=sys.stderr)
    return titles,names,portraits
def playable(cards):return [c for c in cards if c.get("type") in PLAYABLE_TYPES]
def check_unique_coverage(unique_count:int,minimum:int,allow_degraded:bool=False):
    """Publishing without unique metadata silently downgrades every card, so a
    thin unique payload fails the build instead of shipping."""
    if unique_count>=minimum:return
    message=f"Only {unique_count} supports carry raw unique metadata (minimum {minimum})"
    if not allow_degraded:raise ValueError(f"{message}; refusing to publish a degraded dataset")
    print(f"WARN: {message}; publishing anyway because --allow-degraded-uniques was passed",file=sys.stderr)
def download_images(card_ids,directory:Path,template:str=IMAGE_URL_TEMPLATE):
    """Copies card art into the deploy artifact so the page is not hotlinking.

    A missing or unreachable image is not fatal: the page falls back to the
    upstream URL for any file that is not there."""
    directory.mkdir(parents=True,exist_ok=True);saved=skipped=failed=0;consecutive=0
    for card_id in sorted(card_ids):
        target=directory/SUPPORT_IMAGE_NAME.format(card_id=card_id)
        if target.exists() and target.stat().st_size>0:skipped+=1;continue
        if consecutive>=CONSECUTIVE_IMAGE_FAILURE_LIMIT:
            failed+=1;continue
        try:
            data=fetch_bytes(template.format(card_id=card_id))
            if not data:raise ValueError("empty response")
            write_file_atomically(target,data);saved+=1;consecutive=0
        except Exception as exc:
            failed+=1;consecutive+=1;print(f"WARN: card image {card_id} unavailable: {exc}",file=sys.stderr)
            if consecutive==CONSECUTIVE_IMAGE_FAILURE_LIMIT:print(f"WARN: {consecutive} card images failed in a row; skipping the rest and falling back to the upstream host for them",file=sys.stderr)
    return {"saved":saved,"skipped":skipped,"failed":failed}
def portrait_extension(url:str):
    suffix=Path(urllib.parse.urlparse(url).path).suffix.lower()
    return suffix if suffix in (".png",".jpg",".jpeg",".webp",".gif") else ".png"
def download_portraits(cards,directory:Path):
    """Copies character portraits alongside the card art and rewrites each row
    to point at the local copy, so the published page hotlinks nothing.

    Rows whose portrait could not be downloaded keep their upstream URL."""
    directory.mkdir(parents=True,exist_ok=True);saved={};failed=set();skipped=0;consecutive=0
    remote={}
    for card in cards:
        url=str(card.get("portrait_url") or "")
        if url.startswith("http"):remote.setdefault(int(card["id"]),url)
    for card_id,url in sorted(remote.items()):
        name=PORTRAIT_NAME.format(card_id=card_id)+portrait_extension(url);target=directory/name
        if target.exists() and target.stat().st_size>0:saved[card_id]=name;skipped+=1;continue
        if consecutive>=CONSECUTIVE_IMAGE_FAILURE_LIMIT:
            failed.add(card_id);continue
        try:
            data=fetch_bytes(url)
            if not data:raise ValueError("empty response")
            write_file_atomically(target,data);saved[card_id]=name;consecutive=0
        except Exception as exc:
            failed.add(card_id);consecutive+=1;print(f"WARN: portrait {card_id} unavailable: {exc}",file=sys.stderr)
            if consecutive==CONSECUTIVE_IMAGE_FAILURE_LIMIT:print(f"WARN: {consecutive} portraits failed in a row; skipping the rest",file=sys.stderr)
    # A run whose portrait metadata degraded still has the files a previous run
    # cached, so adopt those rather than shipping a portrait-less page.
    for card in cards:
        card_id=int(card["id"])
        if card_id in saved:continue
        existing=next((path for path in sorted(directory.glob(f"{PORTRAIT_NAME.format(card_id=card_id)}.*")) if path.suffix!=".part" and path.stat().st_size>0),None)
        if existing:saved[card_id]=existing.name;skipped+=1
    for card in cards:
        name=saved.get(int(card["id"]))
        if name:card["portrait_url"]=f"{IMAGE_WEB_PREFIX}{name}"
    return {"saved":len(saved)-skipped,"skipped":skipped,"failed":len(failed)}
def merge_global_and_future(global_cards,jp_cards):
    global_ids={int(c["id"]) for c in playable(global_cards)}
    merged=[(c,False) for c in playable(global_cards)]
    merged.extend((c,True) for c in playable(jp_cards) if int(c["id"]) not in global_ids)
    return merged
def normalize_tagged(tagged_cards,events,titles,portraits,minimum_rows:int=100,names=None,uniques=None):
    names=names or {};uniques=uniques or {};result=[];seen=set()
    for raw,future in tagged_cards:
        item={}
        for field in FIELDS:
            if field in raw:item[field]=raw[field]
            elif field in DEFAULTS:item[field]=DEFAULTS[field]
            else:raise ValueError(f"Missing required field {field!r} for card {raw.get('id')}")
        key=(int(item["id"]),int(item["limit_break"]))
        if key in seen:raise ValueError(f"Duplicate card/LB row: {key}")
        seen.add(key);card_id=int(item["id"])
        if future and names.get(card_id):item["char_name"]=names[card_id]
        unique=uniques.get(card_id)
        item["special_unique_level"]=unique.get("level") if unique is not None else None
        item["special_uniques"]=unique.get("effects",[]) if unique is not None else None
        item["title"]=titles.get(card_id,"");item["portrait_url"]=portraits.get(card_id,"");item["event_stats"]=events.get(card_id);item["future"]=bool(future)
        result.append(item)
    if len(result)<minimum_rows:raise ValueError(f"Refusing suspiciously small dataset ({len(result)} rows)")
    result.sort(key=lambda c:(c["id"],c["limit_break"]));return result
def normalize(cards,events,titles,portraits,minimum_rows:int=100,uniques=None):return normalize_tagged([(c,False) for c in playable(cards)],events,titles,portraits,minimum_rows,uniques=uniques)
def main():
    p=argparse.ArgumentParser();p.add_argument("--url",default=DEFAULT_URL);p.add_argument("--jp-url",default=DEFAULT_JP_URL);p.add_argument("--events-url",default=DEFAULT_EVENTS_URL);p.add_argument("--titles-url",default=DEFAULT_TITLES_URL);p.add_argument("--uniques-url",default=DEFAULT_UNIQUES_URL);p.add_argument("--input",type=Path);p.add_argument("--jp-input",type=Path);p.add_argument("--events-input",type=Path);p.add_argument("--titles-input",type=Path);p.add_argument("--uniques-input",type=Path);p.add_argument("--output",type=Path,default=Path("_site/data/cards.json"));p.add_argument("--images",type=Path);p.add_argument("--min-unique-rows",type=int,default=100);p.add_argument("--allow-degraded-uniques",action="store_true");args=p.parse_args()
    global_source=args.input.read_text(encoding="utf-8") if args.input else fetch_text(args.url)
    event_source=args.events_input.read_text(encoding="utf-8") if args.events_input else fetch_text(args.events_url)
    global_cards=extract_json_array(global_source);events=extract_events(event_source)
    try:
        jp_source=args.jp_input.read_text(encoding="utf-8") if args.jp_input else fetch_text(args.jp_url);jp_cards=extract_json_array(jp_source)
    except Exception as exc:print(f"WARN: JP future-card dataset unavailable; deploying Global cards only: {exc}",file=sys.stderr);jp_cards=[]
    tagged=merge_global_and_future(global_cards,jp_cards);target_ids={int(c["id"]) for c,_ in tagged}
    if args.titles_input:
        titles,portraits=extract_metadata_from_file(args.titles_input.read_text(encoding="utf-8"));names={}
    else:
        titles,names,portraits=fetch_umapyoi_metadata(args.titles_url,target_ids)
    try:
        unique_payload=json.loads(args.uniques_input.read_text(encoding="utf-8")) if args.uniques_input else fetch_with_retries(lambda:fetch_json(args.uniques_url))
        uniques=extract_unique_metadata(unique_payload)
    except Exception as exc:
        print(f"WARN: raw unique metadata unavailable; affected supports will be marked: {exc}",file=sys.stderr);uniques={}
    cards=normalize_tagged(tagged,events,titles,portraits,names=names,uniques=uniques);global_count=len({c["id"] for c in cards if not c["future"]});future_count=len({c["id"] for c in cards if c["future"]});titled=len({c["id"] for c in cards if c["title"]});portrait_count=len({c["id"] for c in cards if c["portrait_url"]});unique_count=len({c["id"] for c in cards if c["special_uniques"]})
    check_unique_coverage(unique_count,args.min_unique_rows,args.allow_degraded_uniques)
    image_report=download_images({c["id"] for c in cards},args.images) if args.images else None
    portrait_report=download_portraits(cards,args.images) if args.images else None
    payload={"sources":{"cards":args.url,"future_cards":args.jp_url,"events":args.events_url,"metadata":args.titles_url,"unique_metadata":args.uniques_url},"generated_at":datetime.now(timezone.utc).isoformat(),"card_count":global_count,"future_card_count":future_count,"row_count":len(cards),"event_count":len(events),"title_count":titled,"portrait_count":portrait_count,"unique_metadata_count":unique_count,"cards":cards}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"Wrote {len(cards)} card/LB rows ({global_count} Global supports; {future_count} future JP supports; {len(events)} event rows; {titled} titles; {portrait_count} portraits; {unique_count} raw unique records) to {args.output}")
    if image_report:print(f"Card art: {image_report['saved']} downloaded, {image_report['skipped']} already present, {image_report['failed']} unavailable in {args.images}")
    if portrait_report:print(f"Portraits: {portrait_report['saved']} downloaded, {portrait_report['skipped']} already present, {portrait_report['failed']} unavailable in {args.images}")
    return 0
if __name__=="__main__":sys.exit(main())
