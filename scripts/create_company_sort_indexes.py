from backend.app.config import load_settings
from backend.app.databases import connect_mariadb
from pymongo import MongoClient
from time import perf_counter
s=load_settings(); db=connect_mariadb(s); c=db.cursor()
for field in ('company_name','status','registration_date'):
 name='idx_company_sort_'+field
 start=perf_counter(); c.execute(f'CREATE INDEX IF NOT EXISTS {name} ON Company ({field}, uen)'); print('MariaDB',name,round(perf_counter()-start,2),'s',flush=True)
db.close()
m=MongoClient(s.mongodb_uri); coll=m[s.mongodb_db_name].companies
for field,name in [('name','name'),('status','status'),('registration.incorporation_date','date'),('activities.primary.code','activity')]:
 start=perf_counter(); coll.create_index([(field,1),('_id',1)],name='company_sort_'+name); print('MongoDB',name,round(perf_counter()-start,2),'s',flush=True)
m.close()
