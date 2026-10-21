r"""OWNER: Tzehui - Prepare stored company locations ahead of a demo or user visit.

Start the backend first, then run from the repository root:
  .\.venv\Scripts\python.exe -m backend.scripts.prepare_company_maps --all-industries --database both
Use --industry A for a smaller selection. Source databases are never modified.
"""
import argparse
import json
import sys
import time
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def api(path, database, method='GET', **query):
    url='http://127.0.0.1:8000/api/company-map'+path+'?'+urlencode({'database':database,**query})
    with urlopen(Request(url,method=method),timeout=60) as response:
        return json.load(response)['data']


def main():
    parser=argparse.ArgumentParser(description='Prepare complete map locations before users visit the website. Requires the local backend on port 8000.')
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--industry',action='append',help='SSIC section or subcategory; repeat for multiple selections.')
    group.add_argument('--all-industries',action='store_true',help='Prepare all active companies. Initial OneMap lookups may take hours.')
    parser.add_argument('--database',choices=['mariadb','mongodb','both'],default='both')
    parser.add_argument('--refresh',action='store_true',help='Collect fresh source records instead of reusing a prepared snapshot.')
    args=parser.parse_args()
    databases=['mariadb','mongodb'] if args.database=='both' else [args.database]
    try:
        for database in databases:
            for industry in args.industry or ['']:
                print(f'Preparing {database}: {industry or "all industries"}',flush=True)
                info=api('/index',database,'POST',industry_code=industry.upper(),refresh=str(args.refresh).lower())
                last=None
                while True:
                    line=f"{info['state']}: {info['checked']:,}/{info['total']:,} checked; {info['matched']:,} mapped; {info['unavailable']:,} unmapped"
                    if line!=last:print(line,flush=True);last=line
                    if info['state']=='complete':break
                    if info['state'] in ('paused','error'):
                        print(info['message'],file=sys.stderr);return 1
                    time.sleep(2)
                    info=api('/index/'+info['id'],database)
        print('Prepared locations are saved. Website searches and subcategories can reuse them.',flush=True)
        return 0
    except (HTTPError,URLError,TimeoutError):
        print('The local backend could not complete preparation. Keep it running and retry this command.',file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('\nStopped monitoring. The backend continues preparing the current selection; rerun to check progress.',file=sys.stderr)
        return 130


if __name__=='__main__':raise SystemExit(main())
