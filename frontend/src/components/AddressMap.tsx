import type { Address } from '../api/client'

const clean = (value: string | null | undefined) => {
  const text = value?.trim() ?? ''
  return /^(?:na|n\/a|nil|null|none|-)$/i.test(text) ? '' : text
}

// Keep historical codes as source data, but never search for a four-digit code alone.
export function addressMapQuery(address: Address): string | null {
  const block = clean(address.block), road = clean(address.street_name)
  const building = clean(address.building_name), postal = clean(address.postal_code)
  const other = [clean(address.other_address_line1), clean(address.other_address_line2)].filter(Boolean)
  const local = address.type?.toUpperCase() === 'LOCAL'
  const usable = (block && road) || building || other.length || (local && /^\d{6}$/.test(postal))
  if (!usable) return null
  return [[block, road].filter(Boolean).join(' '), building, ...other, ...(local ? ['Singapore', /^\d{6}$/.test(postal) ? postal : ''] : [postal])].filter(Boolean).join(', ')
}

export function mapUnavailableReason(address: Address): string {
  if (/^\d{4}$/.test(clean(address.postal_code))) return 'Map unavailable: this record has a historical four-digit postal code but not enough building or street information to locate it reliably.'
  return 'Map unavailable: the registered address is missing or incomplete. A building address or six-digit Singapore postal code is needed to search for a location.'
}

// Shared wording for individual address maps and the active-company overview.
export function PostalMapDisclaimer() {
  return <div className="postal-map-disclaimer"><strong>About postal codes and map accuracy</strong><p>Singapore introduced six-digit postal codes in September 1995. Four-digit codes in older records may be valid historical data; they are not automatically errors. Maps use the available address information on a best-effort basis. Old, incomplete or changed addresses may not be found, and an address-search pin may be approximate. Original records are preserved.</p><a className="row-link" href="https://philately.singpost.com/en/explore-stamps/postal-code" target="_blank" rel="noopener noreferrer">Postal-code history - SingPost ↗</a></div>
}

export default function AddressMap({ address, companyName }: { address: Address; companyName?: string | null }) {
  const query = addressMapQuery(address)
  if (!query) return <div className="address-map-unavailable"><p>{mapUnavailableReason(address)}</p><PostalMapDisclaimer /></div>
  const embed = `https://www.google.com/maps?${new URLSearchParams({ q: query, z: '17', output: 'embed', hl: 'en' })}`
  const open = `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`
  return <div className="address-map">
    <iframe key={query} className="address-map-frame" title={`Registered address search${companyName ? ` for ${companyName}` : ''}: ${query}`} src={embed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
    <div className="address-map-caption"><span>{query}</span><a className="row-link" href={open} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a></div>
    <p className="map-search-notice">Address-search result - exact location not verified. If no suitable result appears, the historical address may have changed or no longer exist.</p>
    <PostalMapDisclaimer />
  </div>
}
