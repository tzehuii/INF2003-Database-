# Active company map and address resolution.
# Keep source addresses unchanged; only exact, unambiguous OneMap matches become pins.
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError

MATCH_VERSION = 2
CACHE_PATH = Path(__file__).resolve().parents[2] / '.cache' / 'address-map.sqlite3'
_token_lock = threading.Lock()
_token = None
_token_expiry = 0

# Treat imported placeholder words as missing, preserving real postal-code leading zeros.
def clean(value):
    text = str(value or '').strip()
    return '' if text.lower() in ('na', 'n/a', 'nil', 'null', 'none', '-') else text

def normal(value):
    return ' '.join(re.sub(r'[^A-Z0-9 ]', ' ', clean(value).upper()).split())

def street_key(value):
    abbreviations = {'ST':'STREET', 'RD':'ROAD', 'AVE':'AVENUE', 'DR':'DRIVE', 'CRES':'CRESCENT', 'JLN':'JALAN', 'LOR':'LORONG', 'UPP':'UPPER', 'BT':'BUKIT'}
    return ' '.join(abbreviations.get(word, word) for word in normal(value).split())

# No credential is returned to the browser; optional account credentials can refresh a token.
def configured():
    return bool(os.getenv('ONEMAP_ACCESS_TOKEN') or (os.getenv('ONEMAP_EMAIL') and os.getenv('ONEMAP_PASSWORD')))

def access_token():
    global _token, _token_expiry
    if os.getenv('ONEMAP_ACCESS_TOKEN'):
        return os.environ['ONEMAP_ACCESS_TOKEN']
    with _token_lock:
        if _token and _token_expiry > time.time() + 120:
            return _token
        payload = json.dumps({'email':os.environ['ONEMAP_EMAIL'], 'password':os.environ['ONEMAP_PASSWORD']}).encode()
        req = Request('https://www.onemap.gov.sg/api/auth/post/getToken', data=payload, headers={'Content-Type':'application/json'})
        with urlopen(req, timeout=8) as response:
            body = json.load(response)
        _token, _token_expiry = body['access_token'], int(body['expiry_timestamp'])
        return _token

# Cache by the full source address, never by a shared historical postal code alone.
def cache_key(address):
    return hashlib.sha256(json.dumps({k:clean(address.get(k)) for k in ('type','block','street_name','building_name','postal_code')},sort_keys=True).encode()).hexdigest()

def cached(key):
    CACHE_PATH.parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(CACHE_PATH,timeout=10) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS locations (key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires REAL NOT NULL)')
        row = conn.execute('SELECT payload FROM locations WHERE key=? AND expires>?',(key,time.time())).fetchone()
    return json.loads(row[0]) if row else None

def save_cache(key, result):
    ttl = 30*86400 if result['status']=='matched' else 86400
    with sqlite3.connect(CACHE_PATH,timeout=10) as conn:
        conn.execute('INSERT OR REPLACE INTO locations VALUES (?,?,?)',(key,json.dumps(result),time.time()+ttl))

# Confirm source block/street (or a supplied modern postal code), not the first search hit.
def select_candidate(address, results):
    postal=clean(address.get('postal_code')); block=normal(address.get('block')); street=street_key(address.get('street_name'))
    matches={}
    for item in results:
        if not re.fullmatch(r'[0-9]{6}', clean(item.get('POSTAL'))):
            continue
        if block and street:
            if normal(item.get('BLK_NO'))!=block or street_key(item.get('ROAD_NAME'))!=street:
                continue
        elif re.fullmatch(r'[0-9]{6}',postal):
            if item.get('POSTAL')!=postal or (street and street_key(item.get('ROAD_NAME'))!=street):
                continue
        else:
            continue
        try:
            lat,lon=float(item['LATITUDE']),float(item['LONGITUDE'])
        except (KeyError,ValueError,TypeError):
            continue
        if not (1 <= lat <= 1.6 and 103.4 <= lon <= 104.5):
            continue
        matches[(lat,lon,item['POSTAL'])]=item
    if not matches:
        return {'status':'not_found','reason':'No matching building or postal address was found. The source address may be historical, incomplete or changed.'}
    # Prefer the supplied modern postal code and then the recorded building name.
    if re.fullmatch(r'[0-9]{6}',postal):
        exact={key:item for key,item in matches.items() if key[2]==postal}
        if exact:matches=exact
    building=normal(address.get('building_name'))
    if building:
        named={key:item for key,item in matches.items() if normal(item.get('BUILDING'))==building}
        if named:matches=named
    approximate=False
    if len(matches)>1:
        # Several OneMap points can represent the same full address (entrance/estate/building).
        identities={(normal(item.get('BLK_NO')),street_key(item.get('ROAD_NAME')),key[2]) for key,item in matches.items()}
        keys=list(matches)
        def distance(a,b):
            lat1,lat2=math.radians(a[0]),math.radians(b[0])
            dlat=lat2-lat1;dlng=math.radians(b[1]-a[1])
            h=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlng/2)**2
            return 6371000*2*math.asin(min(1,math.sqrt(h)))
        if len(identities)!=1 or any(distance(a,b)>150 for i,a in enumerate(keys) for b in keys[i+1:]):
            return {'status':'ambiguous','reason':'The remaining map results disagree on the postal address or are too far apart to choose a reliable location. No pin is shown.'}
        approximate=True
    # Prefer the address point over broad estate aliases when no building was supplied.
    ranked=sorted(matches.items(),key=lambda pair:(bool(re.search(r'\b(ESTATE|DISTRICT|PRECINCT)\b',normal(pair[1].get('BUILDING')))),pair[0]))
    (lat,lon,postal),item=ranked[0]
    result={'status':'matched','latitude':lat,'longitude':lon,'resolved_postal_code':postal,'matched_address':item.get('ADDRESS'),'source':'SLA OneMap','approximate':approximate,'matcher_version':MATCH_VERSION,'resolved_at':datetime.now(timezone.utc).isoformat()}
    if approximate:result['reason']='Approximate address location: OneMap lists nearby points for the same building/street and postal code.'
    return result

# Called only for a loaded page of active companies; unavailable locations are never guessed.
def resolve_address(address):
    if clean(address.get('type')).upper()!='LOCAL':
        return {'status':'unavailable','reason':'The Singapore overview map does not include foreign or unclassified addresses.'}
    postal=clean(address.get('postal_code'))
    full_street=bool(clean(address.get('block')) and clean(address.get('street_name')))
    if not full_street and not re.fullmatch(r'[0-9]{6}',postal):
        return {'status':'unavailable','reason':'There is no complete building/street address or six-digit postal code. A historical four-digit code alone cannot identify a building.'}
    key=cache_key(address); found=cached(key)
    if found and not (found.get('status')=='ambiguous' and found.get('matcher_version',0)<MATCH_VERSION):
        return found
    if not configured():
        return {'status':'not_configured','reason':'Exact map locations are not available yet: OneMap access has not been configured. The company list and individual address-search links still work.'}
    queries=[]
    if re.fullmatch(r'[0-9]{6}',postal):queries.append(postal)
    if full_street:queries.append(clean(address.get('block'))+' '+clean(address.get('street_name')))
    result=None
    try:
        token=access_token()
        for query in queries:
            candidates=[]
            for page in range(1,6):
                url='https://www.onemap.gov.sg/api/common/elastic/search?'+urlencode({'searchVal':query,'returnGeom':'Y','getAddrDetails':'Y','pageNum':page})
                with urlopen(Request(url,headers={'Authorization':token}),timeout=8) as response:
                    body=json.load(response)
                candidates.extend(body.get('results',[]))
                if page>=int(body.get('totalNumPages',0)):break
                if page==5:return {'status':'ambiguous','reason':'The address search is too broad to confirm a unique building.'}
            result=select_candidate(address,candidates)
            if result['status'] in ('matched','ambiguous'):break
    except HTTPError as error:
        reason='OneMap access has expired or is invalid. Refresh the server-side OneMap credentials.' if error.code in (401,403) else 'The map lookup service could not complete this request. Please try again later.'
        return {'status':'service_unavailable','reason':reason}
    except (URLError,TimeoutError,ValueError,KeyError,OSError):
        return {'status':'service_unavailable','reason':'The map lookup service is temporarily unavailable. No location has been guessed.'}
    result['matcher_version']=MATCH_VERSION
    save_cache(key,result)
    return result
