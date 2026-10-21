# OWNER: Tzehui - Public active-company overview and verified map locations.
from typing import Annotated
from fastapi import APIRouter, Query, Request
from .api import companies, envelope
from .companies import store, read, fail
from ..system.address_geocoding import configured, resolve_address
router=APIRouter(prefix='/api/company-map',tags=['company map'])
ACTIVE_STATUSES=['Live','Live Company','Live (Receiver or Receiver and Manager appointed)']

# Reuse industry matching and pagination so both database modes select the same kind of records.
@router.get('')
def company_map(request: Request, database: Annotated[str,Query(pattern='^(mariadb|mongodb)$')], industry_code: str='', limit: int=Query(default=25,ge=1,le=50),offset: int=Query(default=0,ge=0)):
    result=companies(request,database,q='',status=ACTIVE_STATUSES,require_linked_award=False,limit=limit,offset=offset,industry_code=industry_code,sort_by='uen',sort_direction='asc')
    with store(request,database) as db:
        for item in result['data']['items']:
            item['addresses']=read(db,database,item['uen'])['addresses']
    result['data']['geocoding_configured']=configured()
    result['data']['active_statuses']=ACTIVE_STATUSES
    return result

# Re-read the selected database instead of accepting arbitrary address text from a client.
@router.get('/location/{uen}')
def company_location(request: Request,database: Annotated[str,Query(pattern='^(mariadb|mongodb)$')],uen: str):
    with store(request,database) as db:
        company=read(db,database,uen.upper())
    if company['status'] not in ACTIVE_STATUSES:
        fail(422,'inactive_company','Only active companies appear on the overview map.')
    addresses=company['addresses']
    if not addresses:return envelope({'status':'unavailable','reason':'No registered address is recorded for this company.'},database)
    # Show the first registered address, consistently with the source's address order.
    return envelope(resolve_address(addresses[0]),database)

# The persistent index covers the full selection; list pages never control map coverage.
from .company_map_source import MapSource
from ..system import company_map_index as map_index
import math


def index_job(job, database):
    info=map_index.status(job,database)
    if not info:fail(404,'map_index_not_found','Search the industry again to create its map index.')
    if info['state'] in ('preparing','locating') and not map_index.is_running(job):
        message='Source loading interrupted by a backend restart. Search again to restart.' if info['state']=='preparing' else 'Location checks paused after a backend restart. Search again to resume.'
        map_index.update(job,state='paused',message=message)
        info=map_index.status(job,database)
    return info


def parse_bounds(bounds):
    if not bounds:return None
    try:
        values=tuple(float(value) for value in bounds.split(','))
        if len(values)!=4 or not all(math.isfinite(value) for value in values):raise ValueError()
        south,north,west,east=values
        if not (-90<=south<=north<=90 and -180<=west<=east<=180):raise ValueError()
        return values
    except ValueError:fail(422,'invalid_map_bounds','Choose a valid map area.')


@router.post('/index')
def start_map_index(request:Request,database:Annotated[str,Query(pattern='^(mariadb|mongodb)$')],industry_code:str='',refresh:bool=False):
    industry=industry_code.strip().upper()
    source=MapSource(request,database,industry)
    job=map_index.start(database,industry,source,refresh)
    return envelope(index_job(job,database),database)


@router.get('/index/{job}')
def map_index_status(job:str,database:Annotated[str,Query(pattern='^(mariadb|mongodb)$')]):
    return envelope(index_job(job,database),database)


@router.get('/index/{job}/results')
def map_index_results(job:str,database:Annotated[str,Query(pattern='^(mariadb|mongodb)$')],mode:Annotated[str,Query(pattern='^(all|mapped|unmapped)$')]='all',bounds:str='',q:Annotated[str,Query(max_length=200)]='',offset:int=Query(default=0,ge=0),limit:int=Query(default=25,ge=1,le=50)):
    index_job(job,database)
    return envelope(map_index.results(job,mode,parse_bounds(bounds),q.strip(),offset,limit),database)


@router.get('/index/{job}/markers')
def map_index_markers(job:str,database:Annotated[str,Query(pattern='^(mariadb|mongodb)$')],zoom:int=Query(default=11,ge=1,le=19),bounds:str=''):
    index_job(job,database)
    return envelope({'items':map_index.markers(job,zoom,parse_bounds(bounds))},database)
