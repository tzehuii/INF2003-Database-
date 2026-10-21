# OWNER: Tzehui - Persistent derived map index; source databases remain unchanged.
from contextlib import contextmanager
import json
import math
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .address_geocoding import resolve_address, MATCH_VERSION

INDEX_PATH = Path(__file__).resolve().parents[2] / '.cache' / 'company-map-index.sqlite3'
CACHE_SECONDS = 7 * 86400
ACTIVE = ['Live', 'Live Company', 'Live (Receiver or Receiver and Manager appointed)']
_lock = threading.Lock()
_running = {}

@contextmanager
def connection():
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(INDEX_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, db TEXT, industry TEXT, state TEXT, total INTEGER DEFAULT 0,
          checked INTEGER DEFAULT 0, matched INTEGER DEFAULT 0, unavailable INTEGER DEFAULT 0,
          updated REAL, message TEXT DEFAULT '', rate REAL DEFAULT 0, matcher_version INTEGER DEFAULT 2);
        CREATE INDEX IF NOT EXISTS job_target ON jobs(db,industry,updated);
        CREATE TABLE IF NOT EXISTS companies (
          job TEXT, uen TEXT, name TEXT, payload TEXT, status TEXT DEFAULT 'pending',
          location TEXT, lat REAL, lng REAL, PRIMARY KEY(job,uen));
        CREATE INDEX IF NOT EXISTS map_bounds ON companies(job,lat,lng);
        CREATE INDEX IF NOT EXISTS map_status ON companies(job,status,uen);
    ''')
    columns={row[1] for row in conn.execute('PRAGMA table_info(jobs)')}
    if 'rate' not in columns:
        try:conn.execute('ALTER TABLE jobs ADD COLUMN rate REAL DEFAULT 0')
        except sqlite3.OperationalError as error:
            if 'duplicate column' not in str(error).lower():raise
    if 'matcher_version' not in columns:
        try:conn.execute('ALTER TABLE jobs ADD COLUMN matcher_version INTEGER DEFAULT 1')
        except sqlite3.OperationalError as error:
            if 'duplicate column' not in str(error).lower():raise
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def status(job, database):
    with connection() as conn:
        row = conn.execute('SELECT * FROM jobs WHERE id=? AND db=?', (job, database)).fetchone()
    if not row:return None
    result=dict(row)
    result['checked']=result['matched']+result['unavailable']
    result['pending']=max(0,result['total']-result['checked'])
    result['progress_percent']=round(100*result['checked']/result['total'],1) if result['total'] else (100 if result['state']=='complete' else 0)
    result['eta_seconds']=round(result['pending']/result['rate']) if result['state']=='locating' and result['checked']>=100 and result['rate']>0 else None
    return result

def update(job, **values):
    values['updated'] = time.time()
    with connection() as conn:
        conn.execute('UPDATE jobs SET '+','.join(key+'=?' for key in values)+' WHERE id=?', (*values.values(),job))

# A complete source snapshot is collected before address resolution, independently of UI pages.
def build(job, source, cancel):
    try:
        info = status(job, source.database)
        if info['state'] == 'preparing':
            with connection() as conn:
                conn.execute('DELETE FROM companies WHERE job=?', (job,))
            total, batch = 0, []
            for company in source():
                if cancel.is_set():
                    update(job, state='paused', message='Source loading paused. Search again to restart this selection.')
                    return
                batch.append((job,company['uen'],company.get('name') or '',json.dumps(company)))
                total += 1
                if len(batch) >= 500:
                    with connection() as conn:
                        conn.executemany('INSERT OR REPLACE INTO companies(job,uen,name,payload) VALUES(?,?,?,?)',batch)
                    batch.clear(); update(job,total=total)
            with connection() as conn:
                conn.executemany('INSERT OR REPLACE INTO companies(job,uen,name,payload) VALUES(?,?,?,?)',batch)
            update(job,total=total,state='locating',message='All active companies loaded; confirming their addresses.')
        else:
            update(job,state='locating',message='Resuming stored address checks.')
        # Bounded batches avoid thousands of queued OneMap calls and support safe pauses.
        with ThreadPoolExecutor(max_workers=3) as pool:
            while not cancel.is_set():
                with connection() as conn:
                    rows = conn.execute("SELECT uen,payload FROM companies WHERE job=? AND status IN ('pending','service_unavailable','not_configured') ORDER BY uen LIMIT 50",(job,)).fetchall()
                if not rows: break
                def locate(row):
                    company = json.loads(row['payload']); addresses = company['addresses']
                    result = resolve_address(addresses[0]) if addresses else {'status':'unavailable','reason':'No registered address is recorded.'}
                    return row['uen'],result
                batch_started=time.monotonic()
                results = list(pool.map(locate, rows))
                with connection() as conn:
                    for uen,result in results:
                        conn.execute('UPDATE companies SET status=?,location=?,lat=?,lng=? WHERE job=? AND uen=?',
                          (result['status'],json.dumps(result),result.get('latitude'),result.get('longitude'),job,uen))
                    counts = dict(conn.execute('SELECT status,COUNT(*) FROM companies WHERE job=? GROUP BY status',(job,)).fetchall())
                pending = sum(counts.get(key,0) for key in ('pending','service_unavailable','not_configured'))
                checked=sum(counts.values())-pending
                current_rate=len(results)/max(time.monotonic()-batch_started,.01)
                previous_rate=status(job,source.database).get('rate',0)
                rate=.75*min(previous_rate,current_rate*2)+.25*current_rate if previous_rate else current_rate
                update(job,checked=checked,matched=counts.get('matched',0),unavailable=sum(value for key,value in counts.items() if key not in ('pending','matched','service_unavailable','not_configured')),rate=rate)
                failures = [result for _,result in results if result['status'] in ('service_unavailable','not_configured')]
                if failures:
                    update(job,state='paused',message=failures[0].get('reason','Map service unavailable. Search again to retry.'))
                    return
                if not pending: break
        if cancel.is_set(): update(job,state='paused',message='Address checks paused after changing selection. Search again to resume.')
        else: update(job,state='complete',message='All matching active company addresses checked. Unconfirmed addresses remain listed separately.')
    except Exception:
        update(job,state='error',message='The map index could not finish. Check the selected database and retry Search.')
    finally:
        with _lock:
            _running.pop(job,None)

def is_running(job):
    with _lock:return job in _running

def start(database, industry, source, refresh=False):
    with _lock:
        with connection() as conn:
            row = conn.execute('SELECT * FROM jobs WHERE db=? AND industry=? ORDER BY updated DESC LIMIT 1',(database,industry)).fetchone()
            if row and not refresh and row['matcher_version']<MATCH_VERSION:
                # Recheck only old ambiguous results; previously confirmed locations remain usable.
                retry=conn.execute("SELECT COUNT(*) FROM companies WHERE job=? AND status='ambiguous'",(row['id'],)).fetchone()[0]
                conn.execute("UPDATE companies SET status='pending',location=NULL WHERE job=? AND status='ambiguous'",(row['id'],))
                conn.execute("UPDATE jobs SET matcher_version=?,checked=MAX(0,checked-?),unavailable=MAX(0,unavailable-?),state=CASE WHEN ? > 0 AND state='complete' THEN 'paused' ELSE state END WHERE id=?",(MATCH_VERSION,retry,retry,retry,row['id']))
                row=conn.execute('SELECT * FROM jobs WHERE id=?',(row['id'],)).fetchone()
            if row and not refresh and time.time()-row['updated'] < CACHE_SECONDS:
                job = row['id']
                if job in _running or row['state']=='complete': return job
                # A cancelled source scan needs a full restart; completed source scans can resume.
                if row['state'] in ('preparing','error') or row['message'].startswith('Source loading'):
                    conn.execute("UPDATE jobs SET state='preparing',total=0,checked=0,matched=0,unavailable=0 WHERE id=?",(job,))
            else:
                # A prepared parent industry can serve its subcategories without new OneMap calls.
                if not refresh:
                    ancestors={''};node=getattr(source,'nodes',{}).get(industry)
                    while node:
                        ancestors.add(node['code']);node=getattr(source,'nodes',{}).get(node.get('parent'))
                    parents=conn.execute("SELECT * FROM jobs WHERE db=? AND state='complete' AND matcher_version>=2 AND updated>? ORDER BY updated DESC",(database,time.time()-CACHE_SECONDS)).fetchall()
                    parent=next((candidate for candidate in parents if candidate['industry'] in ancestors),None)
                    if parent:
                        job=uuid.uuid4().hex
                        conn.execute("INSERT INTO jobs(id,db,industry,state,updated) VALUES(?,?,?,'complete',?)",(job,database,industry,parent['updated']))
                        codes=getattr(source,'codes',[])
                        where='job=?';args=[parent['id']]
                        if codes:
                            where+=" AND json_extract(payload,'$.primary_activity.code') IN ("+','.join('?' for _ in codes)+')';args.extend(codes)
                        conn.execute('INSERT INTO companies(job,uen,name,payload,status,location,lat,lng) SELECT ?,uen,name,payload,status,location,lat,lng FROM companies WHERE '+where,(job,*args))
                        counts=dict(conn.execute('SELECT status,COUNT(*) FROM companies WHERE job=? GROUP BY status',(job,)).fetchall())
                        total=sum(counts.values());matched=counts.get('matched',0)
                        conn.execute("UPDATE jobs SET total=?,checked=?,matched=?,unavailable=?,message='Loaded from a prepared industry map.' WHERE id=?",(total,total,matched,total-matched,job))
                        return job
                job = uuid.uuid4().hex
                conn.execute("INSERT INTO jobs(id,db,industry,state,updated) VALUES(?,?,?,'preparing',?)",(job,database,industry,time.time()))
            conn.execute("UPDATE jobs SET matcher_version=?,state=CASE WHEN state='paused' THEN 'locating' ELSE state END,message=CASE WHEN state='paused' THEN 'Rechecking saved address locations.' ELSE message END WHERE id=?",(MATCH_VERSION,job))
            # Only one active selection per database sends address queries at a time.
            for _, (db,event) in _running.items():
                if db==database: event.set()
            cancel = threading.Event(); _running[job]=(database,cancel)
        threading.Thread(target=build,args=(job,source,cancel),daemon=True).start()
        return job

def filtered(job, mode='all', bounds=None, q=''):
    where, args = ['job=?'], [job]
    if mode=='mapped': where.append("status='matched'")
    if mode=='unmapped': where.append("status NOT IN ('matched','pending','service_unavailable','not_configured')")
    if bounds:
        where.append("status='matched' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?")
        args.extend((bounds[0],bounds[1],bounds[2],bounds[3]))
    if q:
        escaped = q.replace('!','!!').replace('%','!%').replace('_','!_')
        where.append("(name LIKE ? ESCAPE '!' OR uen LIKE ? ESCAPE '!')")
        args.extend(('%'+escaped+'%', '%'+escaped+'%'))
    return ' AND '.join(where),args

def results(job, mode='all', bounds=None, q='', offset=0, limit=25):
    where,args=filtered(job,mode,bounds,q)
    with connection() as conn:
        total=conn.execute('SELECT COUNT(*) FROM companies WHERE '+where,args).fetchone()[0]
        rows=conn.execute('SELECT payload,location FROM companies WHERE '+where+' ORDER BY uen LIMIT ? OFFSET ?',(*args,limit,offset)).fetchall()
        counts={}
        for tab in ('all','mapped','unmapped'):
            clause,params=filtered(job,tab,None if tab=='unmapped' else bounds,q)
            counts[tab]=conn.execute('SELECT COUNT(*) FROM companies WHERE '+clause,params).fetchone()[0]
    return {'items':[{'company':json.loads(row['payload']),'location':json.loads(row['location']) if row['location'] else {'status':'pending','reason':'Address confirmation is in progress; this company is included in the full industry search.'}} for row in rows], 'total':total, 'counts':counts, 'has_more':offset+len(rows)<total}

# Cluster on the server from the full index, never from the visible list page.
def markers(job, zoom, bounds):
    where,args=filtered(job,bounds=bounds)
    groups={}; scale=256*2**zoom
    with connection() as conn:
        rows=conn.execute("SELECT uen,name,lat,lng FROM companies WHERE "+where+" AND status='matched'",args)
        for row in rows:
            lat,lng=row['lat'],row['lng']; sine=math.sin(math.radians(lat))
            x=(lng+180)/360*scale; y=(.5-math.log((1+sine)/(1-sine))/(4*math.pi))*scale
            cell=(math.floor(x/60),math.floor(y/60))
            group=groups.setdefault(cell,{'key':f'{zoom}:{cell[0]}:{cell[1]}','latitude':0,'longitude':0,'count':0,'uen':row['uen'],'name':row['name']})
            group['count']+=1;group['latitude']+=lat;group['longitude']+=lng
    for group in groups.values():
        group['latitude']/=group['count'];group['longitude']/=group['count']
        if group['count']>1:group['uen']=None;group['name']=None
    return list(groups.values())
