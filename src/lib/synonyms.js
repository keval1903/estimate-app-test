export const SYNONYM_DICTIONARY = {
  // Fractions / Measurements
  'aadha': '1/2',
  'adha': '1/2',
  'half': '1/2',
  'pauna': '3/4',
  'pona': '3/4',
  'paune': '3/4',
  'sava': '1.25',
  'dedh': '1.5',
  'ded': '1.5',
  'dhai': '2.5',

  // Materials / Variations
  'lipping': 'liping', // Enforces correct mapping for common misspellings if needed
  'liping': 'liping',
  'leeping': 'liping',

  'sut': 'mm', // Usually sut is 1/8 of an inch, sometimes referred in mm loosely, but keeping it as mm if requested, or leave out. Let's keep sut -> sut for now unless explicitly asked.
}

export function normalizeSearchQuery(query) {
  if (!query) return ''
  let normalized = query.toLowerCase()

  // Replace each synonym
  for (const [key, value] of Object.entries(SYNONYM_DICTIONARY)) {
    // Replace whole word matches only using word boundaries,
    // Note: since our search logic strips spaces sometimes, we might also want to do simple replaces, 
    // but word boundaries (\b) are safer to avoid replacing parts of other words.
    // e.g. "dedh" -> "1.5"
    const regex = new RegExp(`\\b${key}\\b`, 'g')
    normalized = normalized.replace(regex, value)
  }

  return normalized
}
