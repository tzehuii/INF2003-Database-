# OWNER: Tzehui - Stream every active source company without public-directory pagination.
from .api import catalogue, industry_descendants
from .companies import store, ADDRESS_FIELDS
from ..system.company_map_index import ACTIVE

class MapSource:
    def __init__(self, request, database, industry):
        self.request,self.database=request,database
        with store(request,database) as db:
            self.nodes=catalogue(db,database)
        self.codes=industry_descendants(self.nodes,industry) if industry else []

    def __call__(self):
        with store(self.request,self.database) as db:
            if self.database=='mongodb':
                filters={'status':{'$in':ACTIVE}}
                if self.codes:filters['activities.primary.code']={'$in':self.codes}
                projection={'name':1,'status':1,'activities.primary':1,'address':1}
                for doc in db.companies.find(filters,projection).sort('_id',1).batch_size(500):
                    activity=(doc.get('activities') or {}).get('primary') or {}
                    code=activity.get('code');address=doc.get('address')
                    yield {'uen':doc['_id'],'name':doc.get('name'),'status':doc['status'],
                      'primary_activity':{'code':code,'title':self.nodes.get(code,{}).get('title')} if code else None,
                      'addresses':[address] if address and any(address.values()) else []}
            else:
                where='c.status IN (?,?,?)';args=list(ACTIVE)
                if self.codes:
                    where+=' AND ba.ssic_code IN ('+','.join('?' for _ in self.codes)+')';args.extend(self.codes)
                address_columns=','.join('a.'+('address_type' if key=='type' else key)+' AS '+('map_type' if key=='type' else key) for key in ADDRESS_FIELDS)
                cursor=db.cursor(dictionary=True)
                try:
                    cursor.execute('''SELECT c.uen,c.company_name,c.status,ba.ssic_code,ba.ssic_title,'''+address_columns+'''
                      FROM Company c LEFT JOIN CompanyActivity ca ON ca.company_id=c.company_id AND ca.activity_type='Primary'
                      LEFT JOIN BusinessActivity ba ON ba.activity_id=ca.activity_id
                      LEFT JOIN Address a ON a.address_id=(SELECT MIN(a2.address_id) FROM Address a2 WHERE a2.company_id=c.company_id)
                      WHERE '''+where+' ORDER BY c.uen',args)
                    for row in cursor:
                        address={key:row['map_type' if key=='type' else key] for key in ADDRESS_FIELDS}
                        yield {'uen':row['uen'],'name':row['company_name'],'status':row['status'],
                          'primary_activity':{'code':row['ssic_code'],'title':row['ssic_title']} if row['ssic_code'] else None,
                          'addresses':[address] if any(address.values()) else []}
                finally:cursor.close()
