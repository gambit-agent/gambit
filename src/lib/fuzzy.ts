/**
 * Simple fuzzy string matcher.
 * Returns a score (higher = better match) or 0 if no match.
 */
export function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  let qi = 0
  let score = 0
  let consecutive = 0
  let prevMatch = false

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      if (prevMatch) {
        consecutive++
        score += consecutive * 10
      } else {
        score += 1
        if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '_' || t[ti - 1] === '-' || t[ti - 1] === '.') {
          score += 50
        }
      }
      prevMatch = true
    } else {
      prevMatch = false
    }
  }

  return qi === q.length ? score : 0
}

export interface FuzzyResult<T> {
  item: T
  score: number
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  extract: (item: T) => string,
  maxResults = 20,
): FuzzyResult<T>[] {
  if (!query) {
    return items.slice(0, maxResults).map((item) => ({ item, score: 0 }))
  }

  const scored: FuzzyResult<T>[] = []
  for (const item of items) {
    const score = fuzzyMatch(query, extract(item))
    if (score > 0) {
      scored.push({ item, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, maxResults)
}
