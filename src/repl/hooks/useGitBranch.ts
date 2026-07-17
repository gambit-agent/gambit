import { useEffect, useState } from 'react'

import { collectBoundedText } from '../../lib/process-output'

export function useGitBranch(): string {
  const [gitBranch, setGitBranch] = useState('')

  useEffect(() => {
    const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    Promise.all([collectBoundedText(proc.stdout, 512), proc.exited])
      .then(([branch, exitCode]) => {
        setGitBranch(exitCode === 0 ? branch.text.trim() : '')
      })
      .catch(() => setGitBranch(''))
  }, [])

  return gitBranch
}
