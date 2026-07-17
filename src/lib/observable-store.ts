export type StoreListener = () => void

export interface ObservableStore<State> {
  getSnapshot(): State
  subscribe(listener: StoreListener): () => void
  setState(next: State | ((current: State) => State)): State
}

export function createObservableStore<State>(initial: State): ObservableStore<State> {
  let state = initial
  const listeners = new Set<StoreListener>()

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setState: (next) => {
      state = typeof next === 'function' ? (next as (current: State) => State)(state) : next
      emit()
      return state
    },
  }
}
