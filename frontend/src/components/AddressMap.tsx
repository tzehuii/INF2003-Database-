import type { Address } from '../api/client'

/** Use the building address rather than the company's name or floor/unit number. */
export function addressMapQuery(address: Address): string | null {
  const clean = (value: string | null) => {
    const text = value?.trim() ?? ''
    return /^(?:na|n\/a|nil|null|none|-)$/i.test(text) ? '' : text
  }
  const street = [clean(address.block), clean(address.street_name)].filter(Boolean).join(' ')
  const postal = clean(address.postal_code)
  const other = [clean(address.other_address_line1), clean(address.other_address_line2)].filter(Boolean)
  const building = clean(address.building_name)
  if (!clean(address.street_name) && !postal && !other.length && !building) return null
  const parts = [street, building, ...other]
  if (address.type?.toUpperCase() === 'LOCAL') {
    parts.push('Singapore', /^\d{6}$/.test(postal) ? postal : '')
  } else {
    parts.push(postal)
  }
  return parts.filter(Boolean).join(', ')
}

export default function AddressMap({ address, companyName }: { address: Address; companyName?: string | null }) {
  const query = addressMapQuery(address)
  if (!query) return <p className="muted-text address-map-unavailable">A map is unavailable because this address has no location details.</p>
  const embed = `https://www.google.com/maps?${new URLSearchParams({ q: query, z: '17', output: 'embed', hl: 'en' })}`
  const open = `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`
  return <div className="address-map">
    <iframe key={query} className="address-map-frame" title={`Registered address map${companyName ? ` for ${companyName}` : ''}: ${query}`} src={embed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
    <div className="address-map-caption"><span>{query}</span><a className="row-link" href={open} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a></div>
  </div>
}
