/**
 * React and its reconciler pick their development or production build from
 * `process.env.NODE_ENV` the moment they are first imported. `bun run` leaves
 * the variable unset, so every launch through the npm shim or `bun run
 * src/gambit.tsx` was rendering the TUI with React's development build, which
 * carries extra validation on every render and commit. The CLI entry imports
 * this module before anything that pulls in React.
 *
 * Only an unset variable is touched: an explicit `NODE_ENV=development` (or
 * the `test` value `bun test` sets) is left alone.
 */
export function ensureProductionEnv(env: { NODE_ENV?: string } = process.env): void {
  if (env.NODE_ENV === undefined || env.NODE_ENV === '') {
    env.NODE_ENV = 'production'
  }
}

ensureProductionEnv()
