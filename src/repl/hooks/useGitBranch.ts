import { useEffect, useState } from 'react'

export function useGitBranch(): string {
  const [gitBranch, setGitBranch] = useState('')

  useEffect(() => {
    const proc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    Promise.all([new Response(proc.stdout).text(), proc.exited])
      .then(([branch, exitCode]) => {
        setGitBranch(exitCode === 0 ? branch.trim() : '')
      })
      .catch(() => setGitBranch(''))
  }, [])

  return gitBranch
}
