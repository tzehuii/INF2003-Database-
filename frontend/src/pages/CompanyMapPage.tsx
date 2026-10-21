// OWNER: Tzehui - Full-industry map index, independent scrolling results and mouse zoom.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { API_ROUTES, apiRequest, isLiveData } from '../api/client'
import type { Address, CompanySummary, IndustriesData } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { useDatabase } from '../databaseContext'
import { PageHeading, Panel, RegistryStatusBadge } from '../components/ui'
import { addressMapQuery } from '../components/AddressMap'
type Bounds = { south: number; north: number; west: number; east: number }
type Company = CompanySummary & { addresses: Address[] }
type Location = { status: string; reason?: string; latitude?: number; longitude?: number; source?: string; approximate?: boolean }
type Entry = { company: Company; location: Location }
type Job = { id: string; db: string; industry: string; state: string; total: number; checked: number; matched: number; unavailable: number; pending: number; progress_percent: number; eta_seconds: number | null; updated: number; message: string }
type Marker = { key: string; latitude: number; longitude: number; count: number; uen: string | null; name: string | null }
type View = Bounds & { zoom: number }
type Page = { items: Entry[]; total: number; counts: Record<'all'|'mapped'|'unmapped',number>; has_more: boolean }
type Focus = { lat: number; lng: number; sequence: number }
const areaQuery = (bounds: Bounds | null) => bounds ? `${bounds.south},${bounds.north},${bounds.west},${bounds.east}` : ''
// Estimates deliberately use a range because network lookups and cached addresses differ.
function remainingTime(seconds: number) {
  if (seconds < 60) return 'About a minute remaining'
  const low=Math.max(1,Math.floor(seconds*.75/60)), high=Math.max(low+1,Math.ceil(seconds*1.5/60))
  return high>=120 ? `Roughly ${(low/60).toFixed(1)}–${(high/60).toFixed(1)} hours remaining` : `Roughly ${low}–${high} min remaining`
}
// Markers come from the complete server index, independently of list pagination.
function OverviewMap({ markers, onView, onArea, resetView, focus }: { markers: Marker[]; onView: (view: View) => void; onArea: (area: Bounds) => void; resetView: number; focus: Focus | null }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const rendered = useRef(new Map<string, L.Marker>())
  const highlight = useRef<L.CircleMarker | null>(null)
  const latestArea = useRef(onArea); latestArea.current = onArea
  useEffect(() => {
    if (!container.current) return
    const instance = L.map(container.current, { scrollWheelZoom: true }).setView([1.3521, 103.8198], 11)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(instance)
    map.current = instance; layer.current = L.layerGroup().addTo(instance)
    const moved = () => {
      const b = instance.getBounds()
      onView({ south: Math.max(-90,b.getSouth()), north: Math.min(90,b.getNorth()), west: Math.max(-180,b.getWest()), east: Math.min(180,b.getEast()), zoom: instance.getZoom() })
    }
    instance.on('moveend', moved)
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }))
    observer.observe(container.current); moved()
    return () => { observer.disconnect(); instance.remove(); map.current = null; rendered.current.clear() }
  }, [onView])
  useEffect(() => {
    const instance = map.current, group = layer.current
    if (!instance || !group) return
    const keep = new Set<string>()
    for (const point of markers) {
      const key = `${point.key}:${point.count}:${point.latitude}:${point.longitude}`
      keep.add(key)
      if (rendered.current.has(key)) continue
      const icon = L.divIcon({ className: 'company-map-pin', html: `<span>${point.count > 1 ? point.count : ''}</span>`, iconSize: point.count > 1 ? [38,38] : [18,18] })
      const marker = L.marker([point.latitude,point.longitude], { icon, title: `${point.count} ${point.count === 1 ? 'company' : 'companies'}` }).addTo(group)
      if (point.count > 1 && instance.getZoom() < 18) marker.on('click', () => instance.setView([point.latitude,point.longitude], Math.min(18,instance.getZoom()+2)))
      else {
        const popup = document.createElement('div')
        if (point.uen) {
          const link = document.createElement('a'); link.href = `/companies/${encodeURIComponent(point.uen)}`; link.textContent = point.name ?? point.uen; popup.append(link)
        } else {
          const text = document.createElement('p'); text.textContent = `${point.count} active companies at nearby or shared addresses.`; popup.append(text)
          const button = document.createElement('button'); button.className = 'button button-primary'; button.textContent = 'View companies here'
          button.onclick = () => { const p = instance.latLngToContainerPoint([point.latitude,point.longitude]); const a = instance.containerPointToLatLng(p.subtract([45,45])), b = instance.containerPointToLatLng(p.add([45,45])); latestArea.current({south:b.lat,north:a.lat,west:a.lng,east:b.lng}) }
          popup.append(button)
        }
        marker.bindPopup(popup,{autoPan:false})
      }
      rendered.current.set(key,marker)
    }
    for (const [key,marker] of rendered.current) if (!keep.has(key)) { group.removeLayer(marker); rendered.current.delete(key) }
  }, [markers])
  useEffect(() => { if (resetView) map.current?.setView([1.3521,103.8198],11,{animate:false}) }, [resetView])
  useEffect(() => {
    const instance = map.current
    if (!focus || !instance) return
    instance.setView([focus.lat,focus.lng],17)
    if (highlight.current) instance.removeLayer(highlight.current)
    highlight.current = L.circleMarker([focus.lat,focus.lng],{radius:15,color:'#233d80',weight:3,fill:false}).addTo(instance)
  }, [focus])
  return <div ref={container} className="company-overview-map" role="region" aria-label="Company map with mouse zoom and red clusters" />
}
export default function CompanyMapPage() {
  const { database } = useDatabase()
  const [controlsOpen,setControlsOpen] = useState(true)
  const [followMap,setFollowMap] = useState(true)
  const [draftIndustry,setDraftIndustry] = useState('')
  const [draftSubcategory,setDraftSubcategory] = useState('')
  const [industry,setIndustry] = useState<string | null>(null)
  const [job,setJob] = useState<Job | null>(null)
  const [revision,setRevision] = useState(0)
  const [refresh,setRefresh] = useState(false)
  const [error,setError] = useState('')
  const [starting,setStarting] = useState(false)
  const [view,setView] = useState<View | null>(null)
  const [area,setArea] = useState<Bounds | null>(null)
  const [mode,setMode] = useState<'all'|'mapped'|'unmapped'>('all')
  const [entries,setEntries] = useState<Entry[]>([])
  const [counts,setCounts] = useState<Record<'all'|'mapped'|'unmapped',number>>({all:0,mapped:0,unmapped:0})
  const [hasMore,setHasMore] = useState(false)
  const [offset,setOffset] = useState(0)
  const [listLoading,setListLoading] = useState(false)
  const [markers,setMarkers] = useState<Marker[]>([])
  const [resetView,setResetView] = useState(0)
  const [focus,setFocus] = useState<Focus | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const busyMore = useRef(false)
  const industries = useApiResource<IndustriesData>(API_ROUTES.industries, {}, '', {}, true)
  const subcategories = useApiResource<IndustriesData>(API_ROUTES.industries, {parent_code:draftIndustry || undefined,descendants:true}, '', {}, true)
  const estimateStart = useRef({id:'',time:Date.now()})
  if (job && estimateStart.current.id!==job.id) estimateStart.current={id:job.id,time:Date.now()}
  // Search starts or resumes a durable full-selection index; polling does not reload the page.
  useEffect(() => {
    if (industry === null) return
    const controller = new AbortController(); let cancelled = false; let timer: number | undefined
    setStarting(true); setError('')
    async function poll(id: string) {
      const result = await apiRequest<Job>(`/api/company-map/index/${id}`,database,{}, {signal:controller.signal})
      if (cancelled) return
      if (!isLiveData(result)) { setError(result.message);setControlsOpen(true); return }
      setJob(result.body)
      if (['preparing','locating'].includes(result.body.state)) timer = window.setTimeout(() => { void poll(id) },3000)
    }
    void apiRequest<Job>('/api/company-map/index',database,{industry_code:industry,refresh},{method:'POST',signal:controller.signal}).then(result => {
      if (cancelled) return
      setStarting(false)
      if (!isLiveData(result)) { setError(result.message);setControlsOpen(true); return }
      setJob(result.body); setOffset(0)
      void poll(result.body.id)
    })
    return () => { cancelled=true; controller.abort(); window.clearTimeout(timer) }
  }, [database,industry,revision])
  // Every list page queries the full index. Source counts include companies awaiting coordinates.
  const currentJob = job?.db === database && job.industry === industry
  const sourceReady = job && currentJob && job.state !== 'preparing'
  const progress = job ? `${job.checked}:${job.state}` : ''
  useEffect(() => {
    if (!job || !sourceReady) return
    const controller = new AbortController(); let cancelled = false
    setListLoading(true); setError('')
    // Refresh previously loaded cards too, so pending labels become confirmed in place.
    const id = job.id
    async function fetchPages() {
      const pages: Page[] = []
      for (let pageOffset=0; pageOffset<=offset; pageOffset+=25) {
        const result = await apiRequest<Page>(`/api/company-map/index/${id}/results`,database,{mode,bounds:mode!=='unmapped'?areaQuery(area):'',limit:25,offset:pageOffset},{signal:controller.signal})
        if (cancelled) return
        if (!isLiveData(result)) { setError(result.message);setListLoading(false);busyMore.current=false;return }
        pages.push(result.body)
      }
      if (cancelled) return
      const last=pages[pages.length-1]
      setCounts(last.counts);setHasMore(last.has_more);setEntries(pages.flatMap(page=>page.items))
      setListLoading(false);busyMore.current=false
    }
    void fetchPages()
    return () => { cancelled=true;controller.abort() }
  }, [database,job?.id,sourceReady,mode,area,offset,progress])
  useEffect(() => { setOffset(0); busyMore.current=false; if(list.current) list.current.scrollTop=0 }, [job?.id,mode,area])
  useEffect(() => {
    if (!job || !view || !currentJob) return
    const controller = new AbortController(); let cancelled=false
    const timer = window.setTimeout(() => {
      void apiRequest<{items:Marker[]}>(`/api/company-map/index/${job.id}/markers`,database,{zoom:view.zoom,bounds:areaQuery(view)},{signal:controller.signal}).then(result => {
        if(!cancelled && isLiveData(result)) setMarkers(result.body.items)
      })
    },180)
    return () => { cancelled=true; window.clearTimeout(timer);controller.abort() }
  }, [database,job?.id,view,progress,currentJob])
  // Follow settled camera movement, keeping existing cards visible while the next area loads.
  // Source-progress polling must not trigger this effect or reset the reader's scroll position.
  useEffect(() => {
    if (!followMap || !view || !currentJob || !sourceReady || mode==='unmapped') return
    const timer=window.setTimeout(() => setArea(previous => {
      if (previous && Math.abs(previous.south-view.south)<1e-7 && Math.abs(previous.north-view.north)<1e-7 && Math.abs(previous.west-view.west)<1e-7 && Math.abs(previous.east-view.east)<1e-7) return previous
      return {south:view.south,north:view.north,west:view.west,east:view.east}
    }),350)
    return () => window.clearTimeout(timer)
  }, [view,followMap])
  const loadMore = useCallback(() => {
    if (!busyMore.current && !listLoading && hasMore) { busyMore.current=true; setOffset(entries.length) }
  }, [listLoading,hasMore,entries.length])
  const selectArea = useCallback((bounds:Bounds) => { setArea(bounds);setMode('all');setControlsOpen(false) },[])
  const search = (force=false) => { setControlsOpen(false);setRefresh(force);setIndustry(draftSubcategory || draftIndustry);setRevision(value=>value+1);setArea(null);setMode('all');setResetView(value=>value+1) }
  return <div className="company-map-page">
    <PageHeading icon="globe" title="Company Map" description="Search every active company in an industry and explore its confirmed registered locations." />
    {/* OWNER: Tzehui - Always-visible notice between the introduction and the map workspace. */}
    <aside className="company-map-intro-notice" role="note" aria-label="Map accuracy notice">
      <span className="company-map-notice-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5h.01" /></svg></span>
      <p><strong>Map accuracy notice.</strong> Singapore introduced six-digit postal codes in September 1995; older four-digit codes may be valid historical data. Maps use available address information on a best-effort basis, so old, incomplete or changed addresses may be approximate or unavailable. Original records are preserved. <a href="https://philately.singpost.com/en/explore-stamps/postal-code" target="_blank" rel="noopener noreferrer">Postal-code history — SingPost ↗</a></p>
    </aside>
    <Panel className="company-map-panel">
      <div className="company-map-top-controls">
      {/* OWNER: Tzehui - Selection and progress live above the map, leaving the side panel for results. */}
      <div className="company-map-controls-toggle"><button type="button" aria-expanded={controlsOpen} aria-controls="map-browse-controls" onClick={()=>setControlsOpen(value=>!value)}><span>{controlsOpen?'Hide filters & controls':'Show filters & controls'}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={controlsOpen?'m6 15 6-6 6 6':'m6 9 6 6 6-6'} /></svg></button>{!controlsOpen && <span className="company-map-selection-label">{industry?`Industry ${industry}`:'All industries'}{area?' · Selected map area':''}</span>}</div>
      <section id="map-browse-controls" className="company-map-browse-controls" hidden={!controlsOpen} aria-label="Industry and map controls">
      <form className="toolbar company-map-toolbar" onSubmit={event=>{event.preventDefault();search()}}><h3 className="company-map-section-title">Industry</h3>
        <div className="toolbar-row toolbar-row-fields"><label className="field field-grow"><select aria-label="Primary industry / SSIC" className="input" value={draftIndustry} onChange={event=>{setDraftIndustry(event.target.value);setDraftSubcategory('')}}><option value="">All industries</option>{isLiveData(industries.result) && industries.result.body.items.map(item=><option key={item.code} value={item.code}>{item.code} - {item.title}</option>)}</select></label><label className="field field-grow"><span className="field-label">Subcategory (optional)</span><select className="input" aria-label="Industry subcategory" disabled={!draftIndustry} value={draftSubcategory} onChange={event=>setDraftSubcategory(event.target.value)}><option value="">All subcategories</option>{draftIndustry && isLiveData(subcategories.result) && subcategories.result.body.items.map(item=><option key={item.code} value={item.code}>{item.code} - {item.title}</option>)}</select></label><button className="button button-primary" disabled={starting}>Search industry</button><button type="button" className="button button-secondary" disabled={starting || industry===null} onClick={()=>search(true)}>Refresh source data</button></div>
        <p className="muted-text">Active records only · Industry subcategories included.</p>
      </form>
      {job && job.state!=='complete' && <p className="company-map-list-note">{job.state==='preparing'?'Collecting the entire selection; map pins will appear after the source list is ready.':job.state==='locating'?'The full company list is available. Some pins are still being confirmed; this map is not complete yet.':'Location checks are paused. Search industry again to resume; companies without confirmed coordinates remain listed.'}</p>}
      <div className="company-map-controls"><h3 className="company-map-section-title">Map controls</h3><label className="company-map-follow"><input type="checkbox" checked={followMap} onChange={event=>setFollowMap(event.target.checked)} />Update results as I move the map</label><button type="button" className="button button-primary" disabled={!view||!job} onClick={()=>view&&selectArea(view)}>Search this area</button><button type="button" className="button button-secondary" onClick={()=>{setControlsOpen(false);setArea(null);setMode('all');setResetView(value=>value+1)}}>Show all locations</button></div>
      </section>



      {error && <p className="banner banner-warning" role="alert">{error}</p>}
      {job?.state==='complete' ? <div className="company-map-ready" role="status"><strong>{job.total.toLocaleString()} active companies</strong><span>✓ Locations ready</span></div> : <div className="company-map-summary" aria-live="polite"><strong>{job ? `${job.total.toLocaleString()} active companies${job.state==='preparing'?' collected so far':''}` : 'Select an industry to begin.'}</strong>
        {job && <><div className="company-map-progress-label"><span>{job.state==='complete'?'Location checks complete':job.state==='preparing'?'Collecting companies':`Checking addresses: ${job.checked.toLocaleString()} / ${job.total.toLocaleString()}`}</span><strong>{job.state==='preparing'?'':`${job.progress_percent}%`}</strong></div><progress className="company-map-progress" aria-label="Address location checks" max={100} value={job.state==='preparing'?undefined:job.progress_percent} /><div className="company-map-progress-meta"><span>{job.pending.toLocaleString()} pending</span><span>{job.state==='complete'?'Saved for future searches':job.state==='locating'&&job.eta_seconds!=null&&Date.now()-estimateStart.current.time>=10000?remainingTime(job.eta_seconds):job.state==='locating'?'Calculating time estimate…':job.state}</span></div>{job.state==='locating'&&<span className="muted-text">You can browse while locations are being checked.</span>}</>}
        {starting && <span>Preparing your search…</span>}
      </div>}




      </div>
      <div className="company-map-layout company-map-workspace"><div className="company-map-visual"><OverviewMap markers={markers} onView={setView} onArea={selectArea} resetView={resetView} focus={focus} /></div><aside className="company-map-side" aria-label="Map filters and company results">
        <section className="company-map-results" aria-label="Company results"><h3 className="company-map-section-title">Results</h3><div className="company-map-tabs" role="group" aria-label="Company location lists"><button type="button" className="button button-secondary" aria-pressed={mode==='all'} onClick={()=>setMode('all')}>{area?'Selected area':'All'} ({counts.all})</button><button type="button" className="button button-secondary" aria-pressed={mode==='mapped'} onClick={()=>setMode('mapped')}>Mapped ({counts.mapped})</button><button type="button" className="button button-secondary" aria-pressed={mode==='unmapped'} onClick={()=>setMode('unmapped')}>Unmapped ({counts.unmapped})</button></div>

        <div ref={list} className="company-map-list" role="region" tabIndex={0} aria-label="Active company map results" onScroll={event=>{const element=event.currentTarget;if(element.scrollHeight-element.scrollTop-element.clientHeight<120)loadMore()}}>
          {mode==='unmapped' && <p className="company-map-list-note">Addresses that could not be confirmed. Companies still awaiting a check remain in All companies.</p>}
          {!entries.length && <p className="company-map-list-note">{starting||job?.state==='preparing'||listLoading?'Preparing company results…':job?'No companies match this selection.':'Search an industry to view its companies and map.'}</p>}
          {entries.map(({company,location})=>{const address=company.addresses[0];const text=address?addressMapQuery(address):null;return <article className="company-map-card" key={company.uen}>
            <Link className="row-link" to={`/companies/${encodeURIComponent(company.uen)}`}>{company.name??company.uen}</Link><div className="company-map-card-meta"><span>{company.uen}</span><RegistryStatusBadge status={company.status} /></div><p>{company.primary_activity?`${company.primary_activity.code} - ${company.primary_activity.title??'No title'}`:'Primary activity not recorded'}</p><p>{text??'No complete address recorded.'}</p><p className={location.status==='matched'?'map-location-matched':'muted-text'}>{location.status==='matched'?location.approximate ? location.reason ?? `Approximate address location from ${location.source}.` : `Address matched by ${location.source}.`:location.reason}</p>
            <div className="company-actions">{location.status==='matched'&&location.latitude!=null&&location.longitude!=null&&<button type="button" className="button button-secondary" onClick={()=>setFocus({lat:location.latitude!,lng:location.longitude!,sequence:Date.now()})}>Locate on map</button>}{text&&<a href={`https://www.google.com/maps/search/?${new URLSearchParams({api:'1',query:text})}`} target="_blank" rel="noopener noreferrer">Open address search ↗</a>}</div>
          </article>})}
          <div className="company-map-list-note">{listLoading?'Loading company results…':hasMore?<button className="button button-secondary" onClick={loadMore}>Load more companies</button>:job&&sourceReady?'End of this company list.':''}</div>
        </div>
      </section></aside></div>
      <p className="company-map-help">Mouse-wheel zoom · Results follow the map when enabled · Unmapped addresses remain industry-wide · Refresh source data after database edits.</p>
    </Panel>
  </div>
}
