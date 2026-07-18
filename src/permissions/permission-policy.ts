import { isSessionPlanFile } from '../plans/plan-store'
import { resolveWorkspacePath } from '../lib/workspace'
import type { AnyToolDefinition, ToolPermissionRequest } from '../tools/tool-types'

export interface PermissionPolicyRequest {
  toolId: string
  subject: string
  metadata?: Record<string, unknown>
}

export class PermissionPolicy {
  buildToolRequest(
    definition: AnyToolDefinition,
    input: unknown,
    request: ToolPermissionRequest,
  ): PermissionPolicyRequest {
    const metadata = { ...request.metadata }
    const planFilePath = definition.permissionMetadata?.planFilePath?.(input)

    if (typeof planFilePath === 'string' && planFilePath.trim()) {
      try {
        const resolved = resolveWorkspacePath(planFilePath)
        if (isSessionPlanFile(resolved)) {
          metadata.isPlanFileWrite = true
        }
      } catch {
        // Invalid paths are handled by the tool's normal input validation.
      }
    }

    return {
      toolId: definition.id,
      subject: request.subject,
      metadata,
    }
  }
}
