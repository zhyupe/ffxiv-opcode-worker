import { parse } from 'csv-parse/sync'

export function readCsv(input, fields, { header = 1, skip = 3 } = {}) {
  const lines = parse(input, {
    skip_empty_lines: true
  })

  if (!Array.isArray(fields)) {
    fields = lines[header]
  }

  return lines.slice(skip).map(line => fields.reduce((obj, field, i) => {
    obj[`$${i}`] = line[i]
    if (field) {
      obj[field] = line[i]
    }
    return obj
  }, { _: line }))
}