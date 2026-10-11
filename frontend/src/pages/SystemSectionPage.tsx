/** Placeholder workspace for a System section. Operations are added later. */

import { Navigate, useParams } from 'react-router-dom'
import { Card, PageHeading } from '../components/ui'
import { DEFAULT_SYSTEM_PATH, SYSTEM_SECTIONS } from '../systemSections'

export default function SystemSectionPage() {
  const { section } = useParams()
  const current = SYSTEM_SECTIONS.find((item) => item.slug === section)

  if (!current) {
    return <Navigate to={DEFAULT_SYSTEM_PATH} replace />
  }

  return (
    <>
      <PageHeading title={current.label} />
      <Card>
        <p className="empty-state">
          {current.label} operations will be added later. This workspace is a placeholder.
        </p>
      </Card>
    </>
  )
}
