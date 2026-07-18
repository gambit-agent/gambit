import { useEffect, useRef } from 'react'

import type { SubmitOutcome } from '../../lib/interactive/controller'

/**
 * Guards the follow-up drain so at most one queued follow-up is submitted per
 * idle period. The drain effect re-runs whenever the conversation status or
 * the queue changes while the status is still 'idle' — without this gate, two
 * queued follow-ups would both submit and the second run would abort the
 * first.
 */
export class FollowUpDrainGate {
  private draining = false

  get isDraining(): boolean {
    return this.draining
  }

  /** Observe the latest status; leaving 'idle' means the run started, so the gate re-arms. */
  observeStatus(status: string): void {
    if (status !== 'idle') {
      this.draining = false
    }
  }

  /**
   * Returns true when a drain may begin; marks the gate as draining.
   * `runActive` is the synchronous run indicator (`session.isRunActive`): the
   * store status lags behind an actual submission, so it alone cannot be
   * trusted — draining while a run is active would pop an item only for
   * `handleSubmit` to requeue it.
   */
  tryBeginDrain(status: string, runActive = false): boolean {
    if (status !== 'idle' || runActive || this.draining) {
      return false
    }
    this.draining = true
    return true
  }

  /** Nothing was drained after all; re-arm immediately. */
  cancelDrain(): void {
    this.draining = false
  }

  /**
   * The submission settled. If the status never left 'idle' (e.g. a local-only
   * slash command, or the submit failed before starting a run), re-arm so
   * later drains are not stuck.
   */
  settleDrain(status: string): void {
    if (status === 'idle') {
      this.draining = false
    }
  }
}

export interface FollowUpDrainDeps<T = string> {
  gate: FollowUpDrainGate
  getStatus: () => string
  isRunActive: () => boolean
  drainFollowUp: () => T | undefined
  submit: (value: T, options: { fromFollowUpDrain: true }) => Promise<SubmitOutcome | void>
}

/**
 * Drains queued follow-ups one at a time while the conversation is idle.
 *
 * The loop (rather than a single attempt) covers submissions that settle
 * without ever leaving 'idle' — local-only slash commands like /model or
 * /themes, and submits that fail before starting a run. Without it, the
 * remaining queued follow-ups would stall until an unrelated status change.
 *
 * Behavior decision for continuation entries: a drained follow-up ending in
 * '\' is an unfinished multi-line draft. The controller stuffs it back into
 * the composer ('continuation' outcome); we then keep the gate held so the
 * remaining queue does NOT drain past content the user needs to see and act
 * on. Draining resumes automatically after the next run (the status leaving
 * 'idle' re-arms the gate).
 */
export async function drainFollowUps<T>(deps: FollowUpDrainDeps<T>): Promise<void> {
  while (true) {
    if (!deps.gate.tryBeginDrain(deps.getStatus(), deps.isRunActive())) {
      return
    }
    const next = deps.drainFollowUp()
    if (next === undefined) {
      deps.gate.cancelDrain()
      return
    }
    let outcome: SubmitOutcome | void
    try {
      outcome = await deps.submit(next, { fromFollowUpDrain: true })
    } catch {
      outcome = undefined
    }
    if (outcome === 'continuation') {
      // Pause the drain (see doc comment above): the entry is back in the
      // composer and the gate stays held until the status leaves 'idle'.
      return
    }
    deps.gate.settleDrain(deps.getStatus())
    if (deps.gate.isDraining) {
      // A real run started; the idle transition will re-arm and resume.
      return
    }
    // Status never left 'idle': keep draining the remaining follow-ups.
  }
}

export function useFollowUpDrain<T>({
  status,
  queueVersion,
  isRunActive,
  drainFollowUp,
  submit,
}: {
  status: string
  /**
   * Any value whose identity changes on every queue mutation (the queue's
   * React snapshot). Without it, a follow-up enqueued while already idle —
   * or left over after a drain that never changed the status — would stall
   * until an unrelated re-render.
   */
  queueVersion: unknown
  isRunActive: () => boolean
  drainFollowUp: () => T | undefined
  submit: (value: T, options?: { fromFollowUpDrain?: boolean }) => Promise<SubmitOutcome | void>
}): void {
  const gateRef = useRef<FollowUpDrainGate | null>(null)
  if (gateRef.current === null) {
    gateRef.current = new FollowUpDrainGate()
  }
  const statusRef = useRef(status)

  useEffect(() => {
    statusRef.current = status
    const gate = gateRef.current!
    gate.observeStatus(status)
    void drainFollowUps({
      gate,
      getStatus: () => statusRef.current,
      isRunActive,
      drainFollowUp,
      submit,
    })
  }, [status, queueVersion, isRunActive, drainFollowUp, submit])
}
