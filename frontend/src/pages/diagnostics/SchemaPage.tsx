// Database Schema: how MariaDB and MongoDB each store the same company and tender data.
//
// Features this file covers:
// - Summary of both databases: tables or collections, foreign keys, indexes and size.
// - The MariaDB diagram (see SchemaDiagram.tsx).
// - Each MongoDB collection's document structure, from its validation rules, with embedded data,
//   references to other collections and fields MariaDB does not store marked.
// - Where each MariaDB table's data lives in MongoDB.

import type { ReactNode } from 'react'
import { useApiResource } from '../../api/useApiResource'
import { InlineError, PageHeading, Panel, SkeletonRows } from '../../components/ui'
import SchemaDiagram from './SchemaDiagram'
import { BOTH_DATABASES_NOTE, formatCount } from './shared'
import { COLLECTION_COLUMNS, FROM_TABLE, MONGO_ONLY, REFERENCES, TABLE_INFO, formatMb, tableLabel } from './schemaModel'
import type { Collection, Field, SchemaData, Table } from './schemaModel'

export default function SchemaPage() {
  const resource = useApiResource<SchemaData>('/api/system/schema')
  const result = resource.result
  const data = result?.state === 'success' ? result.body : null

  return <>
    <PageHeading title="Database Schema" description={`How the same company and tender data is stored in MariaDB (tables joined by foreign keys) and in MongoDB (documents with embedded data). Read live from both databases. ${BOTH_DATABASES_NOTE}`}
      actions={<button type="button" className="button button-secondary" disabled={resource.isLoading} onClick={resource.reload}>{resource.isLoading ? 'Reading…' : 'Read again'}</button>} />
    {result && result.state !== 'success' && <InlineError title="Could not read the schema" action={<button className="button button-secondary" onClick={resource.reload}>Retry</button>}>{result.message}</InlineError>}
    {!data && (!result || result.state === 'success') && <Panel><SkeletonRows count={6} label="Reading both databases" /></Panel>}
    {data && <>
      <Summary data={data} />
      <Panel title="MariaDB: tables and foreign keys" badge={<span className="schema-source">from information_schema</span>}>
        <div className="schema-body">
          <p className="schema-lede">Each card is a table with its columns in order. Arrows run from a foreign key column to the column it references, so they point from the detail table to the main one. Hover or click a table to focus it: everything not linked to it fades, and each lit arrow shows what happens to the row when the row it points to is deleted. The footer of each card says where the same data lives in MongoDB.</p>
          <div className="schema-legend">
            <span><i className="schema-key schema-key-pk">PK</i> primary key</span>
            <span><i className="schema-key schema-key-fk">FK</i> foreign key</span>
            <span><i className="schema-key schema-key-uq">UQ</i> unique</span>
            <span><span className="mono">name?</span> can be empty (NULL)</span>
            <span><b className="mono">CASCADE</b> row deleted with it · <b className="mono">RESTRICT</b> blocks the delete · <b className="mono">SET NULL</b> link cleared</span>
          </div>
          <SchemaDiagram tables={data.mariadb.tables} />
        </div>
      </Panel>
      <Panel title="MongoDB: collections and their documents" badge={<span className="schema-source">from each collection's validation rules</span>}>
        <div className="schema-body">
          <p className="schema-lede">Each card is a collection and the shape every document in it must have. Shaded boxes are data embedded inside the document instead of kept in a separate table. MongoDB has no foreign keys: fields marked <span className="schema-chip schema-chip-ref">refers to</span> hold another document's ID, and the application keeps them correct.</p>
          <div className="schema-legend">
            <span><span className="schema-chip schema-chip-embed">embedded object</span> <span className="schema-chip schema-chip-embed">array of objects</span> stored inside the document</span>
            <span><span className="schema-chip schema-chip-from">from Address</span> came from this MariaDB table</span>
            <span><span className="schema-chip schema-chip-only">MongoDB only</span> not stored in MariaDB</span>
            <span><span className="mono">string?</span> can be null</span>
          </div>
          <Collections collections={data.mongodb.collections} />
        </div>
      </Panel>
      <Mapping tables={data.mariadb.tables} collections={data.mongodb.collections} />
    </>}
  </>
}

function Summary({ data }: { data: SchemaData }) {
  const tables = data.mariadb.tables, collections = data.mongodb.collections
  const block = (title: string, items: [string, ReactNode][]) => <div>
    <h2 className="schema-summary-title">{title}</h2>
    <dl className="schema-summary-stats">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </div>
  return <Panel>
    <div className="schema-summary">
      {block(`MariaDB ${data.mariadb.version.replace('-MariaDB', '')}`, [
        ['Tables', tables.length],
        ['Foreign keys', tables.reduce((n, t) => n + t.foreign_keys.length, 0)],
        ['Indexes', tables.reduce((n, t) => n + t.indexes.length, 0)],
        ['Data + indexes', formatMb(tables.reduce((n, t) => n + t.data_mb + t.index_mb, 0))],
      ])}
      {block(`MongoDB ${data.mongodb.version}`, [
        ['Collections', collections.length],
        ['Foreign keys', 0],
        ['Indexes', collections.reduce((n, c) => n + c.indexes.length, 0)],
        ['On disk + indexes', formatMb(collections.reduce((n, c) => n + c.storage_mb + c.index_mb, 0))],
      ])}
    </div>
  </Panel>
}

// ---------------------------------------------------------------- MongoDB --

function typeText(field: Field) {
  const types = field.types.filter(t => t !== 'null')
  const nullable = field.types.includes('null')
  if (field.enum) return `one of: ${field.enum.join(', ')}`
  if (types.includes('array')) return field.fields ? '' : `array of ${(field.item_types ?? ['any']).join(' | ')}`
  if (types.includes('object') && field.fields) return nullable ? 'object or null' : ''
  return types.join(' | ') + (nullable ? '?' : '')
}

function FieldTree({ fields, path }: { fields: Field[]; path: string }) {
  return <ul className="schema-tree">{fields.map(field => {
    const full = `${path}.${field.name}`
    const isArray = field.types.includes('array') && !!field.fields
    const isObject = field.types.includes('object') && !!field.fields
    const type = typeText(field)
    return <li key={field.name}>
      <div className="schema-field">
        <span className="schema-field-name">{field.name}</span>
        {type && <span className={field.enum ? 'schema-field-enum' : 'schema-field-type'}>{type}</span>}
        {isArray && <span className="schema-chip schema-chip-embed">array of objects</span>}
        {isObject && <span className="schema-chip schema-chip-embed">embedded object</span>}
        {FROM_TABLE[full] && <span className="schema-chip schema-chip-from">from {FROM_TABLE[full]}</span>}
        {REFERENCES[full] && <span className="schema-chip schema-chip-ref">refers to {REFERENCES[full]}</span>}
        {MONGO_ONLY.has(full) && <span className="schema-chip schema-chip-only">MongoDB only</span>}
      </div>
      {field.fields && <FieldTree fields={field.fields} path={full} />}
    </li>
  })}</ul>
}

function Collections({ collections }: { collections: Collection[] }) {
  const byName = Object.fromEntries(collections.map(c => [c.name, c]))
  const listed = new Set(COLLECTION_COLUMNS.flat())
  const columns = COLLECTION_COLUMNS.map((names, i) => [
    ...names.filter(n => byName[n]).map(n => byName[n]),
    ...(i === COLLECTION_COLUMNS.length - 1 ? collections.filter(c => !listed.has(c.name)) : []),
  ])
  const source = (name: string) => Object.values(TABLE_INFO).find(info => info.target === name)
  return <div className="schema-collections">{columns.map((list, i) => <div key={i} className="schema-collection-column">
    {list.map(c => {
      const extra = c.indexes.filter(index => index.name !== '_id_').map(index => `${index.keys.join(' + ')}${index.unique ? ' (unique)' : ''}`)
      const from = source(c.name)
      return <div key={c.name} className="schema-collection">
        <div className="schema-card-head"><span className="schema-card-name mono">{c.name}</span><span className="schema-card-rows">{formatCount(c.documents)} documents</span></div>
        {c.validated ? <FieldTree fields={c.fields} path={c.name} /> : <p className="company-note schema-unvalidated">This collection has no validation rules, so its document shape is not fixed.</p>}
        <div className="schema-collection-foot">
          {[from ? `From MariaDB table ${from.label}` : 'No MariaDB equivalent: import bookkeeping',
            `${formatMb(c.data_mb)} of data, ${formatMb(c.storage_mb)} on disk`,
            extra.length ? `Indexes: _id, ${extra.join(', ')}` : 'Index: _id only'].join(' · ')}
        </div>
      </div>
    })}
  </div>)}</div>
}

// ---------------------------------------------------------------- mapping --

function Mapping({ tables, collections }: { tables: Table[]; collections: Collection[] }) {
  const rows = Object.fromEntries(tables.map(t => [t.name, t.rows]))
  const mapped = Object.entries(TABLE_INFO).filter(([name]) => name in rows)
  const embedded = mapped.filter(([, info]) => info.kind !== 'collection').length
  const chip = (kind: string) => kind === 'collection' ? 'schema-chip schema-chip-from' : kind === 'text field' ? 'schema-chip schema-chip-only' : 'schema-chip schema-chip-embed'
  return <Panel title={`From ${tables.length} tables to ${collections.length} collections`} badge={<span className="schema-source">where each MariaDB table went</span>}>
    <div className="schema-body">
      <div className="schema-facts">
        <div><strong>{embedded} of {mapped.length} tables are embedded</strong>Their rows live inside another document instead of their own collection, so reading them needs no join.</div>
        <div><strong>Company profile: 4 tables vs 1 document</strong>MariaDB joins Company, Address, CompanyActivity and FormerEntityName. MongoDB reads one companies document.</div>
        <div><strong>0 foreign keys in MongoDB</strong>References such as tenders.awards.supplier_id are checked by the application, not the database.</div>
      </div>
      <div className="company-table-scroll"><table className="company-table diagnostics-table schema-map">
        <thead><tr><th>MariaDB table</th><th className="cell-number">Rows</th><th><span className="visually-hidden">Becomes</span></th><th>In MongoDB</th><th>Stored as</th><th>How</th></tr></thead>
        <tbody>{mapped.map(([name, info]) => <tr key={name}>
          <td className="mono">{tableLabel(name)}</td>
          <td className="cell-number">{formatCount(rows[name])}</td>
          <td aria-hidden="true">→</td>
          <td className="mono">{info.target}</td>
          <td><span className={chip(info.kind)}>{info.kind}</span></td>
          <td className="schema-how">{info.how}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
  </Panel>
}
