/**
 * Small inline SVG icons.
 *
 * Every icon is decorative: the visible label next to it carries the meaning,
 * so the SVG is hidden from assistive technology. No icon library is used.
 */

export type IconName =
  | 'companies'
  | 'agency'
  | 'industry'
  | 'saved'
  | 'tree'
  | 'truck'
  | 'document'
  | 'building'
  | 'chevron'
  | 'search'
  | 'info'
  | 'warning'
  | 'danger'
  | 'check'
  | 'globe'
  | 'sliders'
  | 'compare'
  | 'gauge'
  | 'schema'
  | 'logo'

const PATHS: Record<IconName, string> = {
  companies: 'M4 21V8l8-4 8 4v13M8 21v-4h8v4M8 10h1M12 10h1M16 10h1M8 14h1M12 14h1M16 14h1',
  agency: 'M12 3 3 8h18l-9-5ZM5 10v7M9 10v7M15 10v7M19 10v7M3 21h18M4 17h16',
  industry: 'M5 20v-6M10 20V9M15 20V5M20 20V2',
  saved: 'M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3-6 3V4.5Z',
  tree: 'M4 5h5v4H4zM15 11h5v4h-5zM15 17h5v4h-5zM6.5 9v10H15M6.5 13H15',
  truck: 'M2 6h11v10H2zM13 9h4.5l3.5 3.5V16h-8M6.5 19.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM17 19.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z',
  document: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h6',
  building: 'M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h3a1 1 0 0 1 1 1v10M3 21h18M9 8h2M9 12h2M9 16h2',
  chevron: 'm9 6 6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  warning: 'M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.5h.01',
  danger: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5v5M12 16h.01',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.75 5.5 3.75 9S14.5 18.5 12 21c-2.5-2.5-3.75-5.5-3.75-9S9.5 5.5 12 3Z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  compare: 'M7 4 3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-6M7 13.5l-1-.6M17 13.5l1-.6M12 8V7',
  schema: 'M3 4h7v6H3zM14 14h7v6h-7zM3 7h7M14 17h7M10 7h2v10h2',
  logo: 'm4 10 8-5 8 5M5 19h14M7 11v6M11 11v6M15 11v6M19 11v6',
}

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icon ${className}` : 'icon'}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
