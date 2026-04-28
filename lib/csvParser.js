import Papa from 'papaparse'
import { normArtist } from './artists'

function normMonth(s) {
  if (!s) return ''
  s = s.trim()
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7)
  if (/^\d{2}\/\d{4}$/.test(s)) {
    const [m, y] = s.split('/')
    return `${y}-${m.padStart(2, '0')}`
  }
  const months = {
    january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'
  }
  const match = s.toLowerCase().match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/)
  if (match) return `${match[2]}-${months[match[1]]}`
  return ''
}

export function parseDistroKid(text) {
  const result = Papa.parse(text, { header: true, skipEmptyLines: true })
  const rows = result.data

  if (!rows.length) return { rows: [], months: [] }

  const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim())
  const col = (...candidates) => {
    for (const c of candidates) {
      const i = headers.findIndex(h => h.includes(c))
      if (i >= 0) return Object.keys(rows[0])[i]
    }
    return null
  }

  const kMonth    = col('sale month', 'reporting month', 'month')
  const kArtist   = col('artist name', 'artist')
  const kTitle    = col('title', 'song', 'track')
  const kStore    = col('store', 'platform', 'service', 'dsp')
  const kEarnings = col('earnings (usd)', 'earnings', 'revenue', 'royalties')

  if (!kEarnings) throw new Error('Colonne "Earnings (USD)" introuvable dans le CSV.')

  const agg = {}
  for (const row of rows) {
    const usd = parseFloat(row[kEarnings])
    if (!usd || usd === 0) continue
    const month  = normMonth(kMonth  ? row[kMonth]  : '')
    const artist = normArtist(kArtist ? row[kArtist] : 'Inconnu')
    const title  = kTitle ? row[kTitle] : 'Inconnu'
    const store  = kStore ? row[kStore] : 'Autre'
    if (!month) continue
    const key = `${month}|${artist}|${title}|${store}`
    agg[key] = (agg[key] || 0) + usd
  }

  const parsed = Object.entries(agg).map(([key, usd]) => {
    const [month, artist, title, store] = key.split('|')
    return { month, artist, title, store, usd: Math.round(usd * 10000) / 10000 }
  })

  const months = [...new Set(parsed.map(r => r.month))]
  return { rows: parsed, months }
}
