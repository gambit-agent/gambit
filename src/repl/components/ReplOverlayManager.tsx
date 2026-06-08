import type { ModelPickerState } from '../../lib/modelPicker'
import type { PermissionRequestRecord } from '../../permissions/permission-types'
import type { TaskRecord } from '../../tasks/task-types'
import { MCPServerManagerOverlay } from '../../ui/overlays/MCPServerManagerOverlay'
import {
  AskUserQuestionOverlay,
  type AskUserQuestionController,
} from '../../ui/overlays/AskUserQuestionOverlay'
import { PermissionOverlay } from '../../ui/overlays/PermissionOverlay'
import { PlanApprovalOverlay } from '../../ui/overlays/PlanApprovalOverlay'
import {
  SessionPickerOverlay,
  type SessionPickerOption,
} from '../../ui/overlays/SessionPickerOverlay'
import { ModelPickerOverlay } from '../../ui/model-picker/ModelPickerOverlay'
import { listMCPServerConfigs } from '../../lib/mcp-config'
import type { SessionPickerState } from '../hooks/useSessionPicker'
import { TaskDrawer } from './TaskDrawer'

type FocusedOverlay = 'permission' | 'question' | 'mcp' | 'model' | 'session' | null

export interface ReplOverlayManagerProps {
  sessionInitializing: boolean
  modelId: string | null
  modelPickerState: ModelPickerState
  sessionPickerState: SessionPickerState
  sessionPickerOptions: SessionPickerOption[]
  mcpOverlayOpen: boolean
  permissionRequest: PermissionRequestRecord | null
  permissionExplainOpen: boolean
  activePlanContent: string | null
  questionOpen: boolean
  questionController: AskUserQuestionController
  tasksOpen: boolean
  activeTasks: TaskRecord[]
  recentTasks: TaskRecord[]
  terminalWidth: number
  terminalHeight: number
  onModelFilterChange: (value: string) => void
  onModelFilterSubmit: (value: string) => void
  onModelOptionChange: (index: number, modelId?: string) => void
  onModelOptionSelect: (index: number, modelId?: string) => void
  onModelProviderOptionChange: (index: number) => void
  onModelProviderOptionSelect: (index: number) => void
  onModelClose: () => void
  onSessionFilterChange: (value: string) => void
  onSessionFilterSubmit: (value: string) => void
  onSessionOptionChange: (index: number) => void
  onSessionOptionSelect: (index: number) => void
}

export function getReplOverlayFocus(options: {
  sessionInitializing: boolean
  modelPickerOpen: boolean
  sessionPickerOpen: boolean
  mcpOverlayOpen: boolean
  permissionOpen: boolean
  questionOpen: boolean
}): {
  focusedOverlay: FocusedOverlay
  mainInput: boolean
  modelPicker: boolean
  sessionPicker: boolean
  questionOverlay: boolean
} {
  const focusedOverlay =
    options.permissionOpen
      ? 'permission'
      : options.questionOpen
        ? 'question'
        : options.mcpOverlayOpen
          ? 'mcp'
          : options.modelPickerOpen
            ? 'model'
            : options.sessionPickerOpen
              ? 'session'
              : null

  return {
    focusedOverlay,
    mainInput: !focusedOverlay && !options.sessionInitializing,
    modelPicker: focusedOverlay === 'model',
    sessionPicker: focusedOverlay === 'session',
    questionOverlay: focusedOverlay === 'question',
  }
}

export function ReplOverlayManager({
  sessionInitializing,
  modelId,
  modelPickerState,
  sessionPickerState,
  sessionPickerOptions,
  mcpOverlayOpen,
  permissionRequest,
  permissionExplainOpen,
  activePlanContent,
  questionOpen,
  questionController,
  tasksOpen,
  activeTasks,
  recentTasks,
  terminalWidth,
  terminalHeight,
  onModelFilterChange,
  onModelFilterSubmit,
  onModelOptionChange,
  onModelOptionSelect,
  onModelProviderOptionChange,
  onModelProviderOptionSelect,
  onModelClose,
  onSessionFilterChange,
  onSessionFilterSubmit,
  onSessionOptionChange,
  onSessionOptionSelect,
}: ReplOverlayManagerProps) {
  const focus = getReplOverlayFocus({
    sessionInitializing,
    modelPickerOpen: modelPickerState.isOpen,
    sessionPickerOpen: sessionPickerState.isOpen,
    mcpOverlayOpen,
    permissionOpen: Boolean(permissionRequest),
    questionOpen,
  })

  return (
    <>
      {modelPickerState.isOpen ? (
        <ModelPickerOverlay
          state={modelPickerState}
          currentModelId={modelId ?? ''}
          hasFocus={focus.modelPicker}
          onFilterChange={onModelFilterChange}
          onFilterSubmit={onModelFilterSubmit}
          onOptionChange={onModelOptionChange}
          onOptionSelect={onModelOptionSelect}
          onProviderOptionChange={onModelProviderOptionChange}
          onProviderOptionSelect={onModelProviderOptionSelect}
          onClose={onModelClose}
        />
      ) : null}

      {sessionPickerState.isOpen ? (
        <SessionPickerOverlay
          isOpen={sessionPickerState.isOpen}
          hasFocus={focus.sessionPicker}
          filterValue={sessionPickerState.filterValue}
          selectedIndex={sessionPickerState.selectedIndex}
          fetchState={sessionPickerState.fetchState}
          fetchError={sessionPickerState.fetchError}
          options={sessionPickerOptions}
          onFilterChange={onSessionFilterChange}
          onFilterSubmit={onSessionFilterSubmit}
          onOptionChange={onSessionOptionChange}
          onOptionSelect={onSessionOptionSelect}
        />
      ) : null}

      {mcpOverlayOpen ? <MCPServerManagerOverlay servers={listMCPServerConfigs()} /> : null}

      {permissionRequest ? (
        permissionRequest.metadata?.isPlanApproval ? (
          <PlanApprovalOverlay request={permissionRequest} planContent={activePlanContent} />
        ) : (
          <PermissionOverlay request={permissionRequest} showExplanation={permissionExplainOpen} />
        )
      ) : null}

      {questionOpen ? (
        <AskUserQuestionOverlay controller={questionController} hasFocus={focus.questionOverlay} />
      ) : null}

      {tasksOpen ? (
        <TaskDrawer
          activeTasks={activeTasks}
          recentTasks={recentTasks}
          terminalWidth={terminalWidth}
          terminalHeight={terminalHeight}
        />
      ) : null}
    </>
  )
}
