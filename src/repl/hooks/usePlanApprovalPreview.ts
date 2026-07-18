import { useEffect, useState } from 'react'

import type { PermissionRequestRecord } from '../../permissions/permission-types'
import { readPlan } from '../../plans/plan-store'

export function usePlanApprovalPreview(
  request: PermissionRequestRecord | null,
  conversationId: string,
): string | null {
  const [activePlanContent, setActivePlanContent] = useState<string | null>(null)

  useEffect(() => {
    if (request?.metadata?.isPlanApproval) {
      readPlan(conversationId).then(
        (content) => setActivePlanContent(content),
        () => setActivePlanContent(null),
      )
    } else {
      setActivePlanContent(null)
    }
  }, [request, conversationId])

  return activePlanContent
}
