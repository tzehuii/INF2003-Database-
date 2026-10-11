/**
 * Application header.
 *
 * It holds the application title and the global database selector only. There
 * is no user icon, account menu, notification area, or authentication control,
 * by design.
 */

import DatabaseSelector from './DatabaseSelector'
import ViewSelector from './ViewSelector'

export default function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header-title">
        <h1>Business &amp; Tender Analytics</h1>
        <p className="app-header-subtitle">
          Singapore company, industry, and government procurement data
        </p>
      </div>
      <div className="app-header-controls">
        <ViewSelector />
        <DatabaseSelector />
      </div>
    </header>
  )
}
