// What the Database Schema page knows beyond what the databases report: where each MariaDB table's
// data lives in MongoDB, how the diagram is laid out, and which MongoDB fields refer to other
// collections. Everything else on the page is read live from /api/system/schema.

export type Column = { name: string; type: string; nullable: boolean; primary_key: boolean }
export type ForeignKey = { column: string; table: string; column_referenced: string; on_delete: string }
export type TableIndex = { name: string; columns: string[]; unique: boolean }
export type Table = {
  name: string; columns: Column[]; foreign_keys: ForeignKey[]; indexes: TableIndex[]
  data_mb: number; index_mb: number; rows: number
}
export type Field = { name: string; types: string[]; required: boolean; enum?: string[]; item_types?: string[]; fields?: Field[] }
export type Collection = {
  name: string; validated: boolean; fields: Field[]; indexes: { name: string; keys: string[]; unique: boolean }[]
  documents: number; data_mb: number; storage_mb: number; index_mb: number
}
export type SchemaData = {
  mariadb: { version: string; tables: Table[] }
  mongodb: { version: string; collections: Collection[] }
}

export type StorageKind = 'collection' | 'embedded object' | 'array of objects' | 'text field'
export type GroupKey = 'companies' | 'lists' | 'tenders'

type TableInfo = {
  label: string
  // Diagram column, left to right along the chain of foreign keys:
  // 0 lookup tables, 1 tables that hang off Company, 2 Company, 3 supplier links and awards, 4 Supplier, Tender, agency.
  column: number
  group: GroupKey
  target: string
  kind: StorageKind
  how: string
}

// Keyed by the name the server reports, which is lowercase on Windows. Listed in mapping-table order.
export const TABLE_INFO: Record<string, TableInfo> = {
  company: { label: 'Company', column: 2, group: 'companies', target: 'companies', kind: 'collection', how: 'One document per company; uen becomes _id.' },
  address: { label: 'Address', column: 1, group: 'companies', target: 'companies.address', kind: 'embedded object', how: 'One address object inside each company. MongoDB holds one address; MariaDB allows several.' },
  formerentityname: { label: 'FormerEntityName', column: 1, group: 'companies', target: 'companies.former_names', kind: 'array of objects', how: "The company's former names as an array inside it." },
  companyactivity: { label: 'CompanyActivity', column: 1, group: 'companies', target: 'companies.activities', kind: 'embedded object', how: 'Primary and secondary industry as two fixed slots, each holding the SSIC code.' },
  businessactivity: { label: 'BusinessActivity', column: 0, group: 'companies', target: 'industries', kind: 'collection', how: 'One document per SSIC code. ancestor_codes stores the whole path, so no recursive lookup is needed.' },
  supplier: { label: 'Supplier', column: 4, group: 'tenders', target: 'suppliers', kind: 'collection', how: 'One document per supplier; the name becomes _id.' },
  supplierentitymatch: { label: 'SupplierEntityMatch', column: 3, group: 'tenders', target: 'suppliers.match', kind: 'embedded object', how: 'Link status, candidate count and linked UEN inside the supplier.' },
  tender: { label: 'Tender', column: 4, group: 'tenders', target: 'tenders', kind: 'collection', how: 'One document per tender; tender_no becomes _id.' },
  tenderaward: { label: 'TenderAward', column: 3, group: 'tenders', target: 'tenders.awards', kind: 'array of objects', how: 'The awards as an array inside their tender, naming the supplier.' },
  governmentagency: { label: 'GovernmentAgency', column: 4, group: 'tenders', target: 'tenders.agency_name', kind: 'text field', how: 'No separate collection: each tender stores the agency name as text.' },
  savedlist: { label: 'SavedList', column: 0, group: 'lists', target: 'saved_lists', kind: 'collection', how: 'One document per saved list.' },
  savedlistentry: { label: 'SavedListEntry', column: 1, group: 'lists', target: 'saved_list_entries', kind: 'collection', how: 'Kept separate, as in MariaDB, so lists can grow without limit.' },
}

export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'companies', label: 'COMPANIES AND INDUSTRIES' },
  { key: 'lists', label: 'SAVED LISTS' },
  { key: 'tenders', label: 'TENDERS AND SUPPLIERS' },
]

export const tableLabel = (name: string) => TABLE_INFO[name]?.label ?? name

// MongoDB field path -> the MariaDB table its data came from (embedded data and text fields only).
export const FROM_TABLE: Record<string, string> = Object.fromEntries(
  Object.values(TABLE_INFO).filter(info => info.target.includes('.')).map(info => [info.target, info.label]),
)

// Fields holding another document's ID: MongoDB's equivalent of a foreign key, which it does not enforce.
export const REFERENCES: Record<string, string> = {
  'tenders.awards.supplier_id': 'suppliers',
  'suppliers.match.company_uen': 'companies',
  'suppliers.match.candidate_uen': 'companies',
  'companies.activities.primary.code': 'industries',
  'companies.activities.secondary.code': 'industries',
  'saved_list_entries.company_uen': 'companies',
  'saved_list_entries.list_id': 'saved_lists',
  'industries.parent_code': 'industries',
}

// Company fields MongoDB keeps from the ACRA file that have no MariaDB column.
export const MONGO_ONLY = new Set([
  'companies.search_name', 'companies.registration', 'companies.filings', 'companies.officer_count',
  'companies.auditors', 'companies.source_record',
])

// What each delete rule means for the row holding the foreign key.
export const DELETE_RULES: Record<string, { short: string; meaning: string }> = {
  CASCADE: { short: 'CASCADE', meaning: 'is deleted with it' },
  RESTRICT: { short: 'RESTRICT', meaning: 'blocks the delete' },
  'SET NULL': { short: 'SET NULL', meaning: 'has this column set to empty' },
  'NO ACTION': { short: 'NO ACTION', meaning: 'blocks the delete' },
}

// MongoDB collection cards, left to right; collections not listed go in the last column.
export const COLLECTION_COLUMNS = [['companies'], ['tenders', 'suppliers', 'industries'], ['saved_lists', 'saved_list_entries', 'dataset_metadata']]

export const formatMb = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`

export const shortType = (type: string) => type.replace(' unsigned', '').replace(/^int\(\d+\)/, 'int').replace(/^tinyint\(1\)/, 'boolean')
