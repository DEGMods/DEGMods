/**
 * Parse a single CSV line respecting quoted fields.
 * Handles commas inside quoted strings and escaped quotes ("").
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0

  while (i < line.length) {
    const ch = line[i]

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i += 2
        } else {
          // End of quoted field
          inQuotes = false
          i++
        }
      } else {
        current += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        fields.push(current.trim())
        current = ''
        i++
      } else {
        current += ch
        i++
      }
    }
  }

  fields.push(current.trim())
  return fields
}

/**
 * Escape a CSV field value: wraps in quotes if it contains commas, quotes, or newlines.
 */
export function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}
