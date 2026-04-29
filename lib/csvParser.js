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

// ── DistroKid parser ─────────────────────────────────────
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

  const kMonth   = col('sale month', 'reporting month', 'month')
  const kArtist  = col('artist name', 'artist')
  const kTitle   = col('title', 'song', 'track')
  const kStore   = col('store', 'platform', 'service', 'dsp')
  const kEarnings= col('earnings (usd)', 'earnings', 'revenue', 'royalties')
  const kQty     = col('quantity', 'streams', 'plays', 'units')
  const kCountry = col('country of sale', 'country', 'territory')
  const kIsrc    = col('isrc')

  if (!kEarnings) throw new Error('Colonne "Earnings (USD)" introuvable dans le CSV.')

  const agg = {}
  for (const row of rows) {
    const usd = parseFloat(row[kEarnings]) || 0
    const qty = parseInt(row[kQty]) || 0
    if (usd === 0 && qty === 0) continue

    const month   = normMonth(kMonth   ? row[kMonth]   : '')
    const artist  = normArtist(kArtist ? row[kArtist]  : 'Inconnu')
    const title   = kTitle   ? row[kTitle]   : 'Inconnu'
    const store   = kStore   ? row[kStore]   : 'Autre'
    const country = kCountry ? row[kCountry] : ''
    const isrc    = kIsrc    ? row[kIsrc]    : ''

    if (!month) continue
    const key = `${month}|${artist}|${title}|${store}|${country}|${isrc}`
    if (!agg[key]) agg[key] = { usd: 0, qty: 0 }
    agg[key].usd += usd
    agg[key].qty += qty
  }

  const parsed = Object.entries(agg).map(([key, v]) => {
    const [month, artist, title, store, country, isrc] = key.split('|')
    return {
      month, artist, title, store, country, isrc,
      usd: Math.round(v.usd * 10000) / 10000,
      qty: v.qty
    }
  })

  const months = [...new Set(parsed.map(r => r.month))]
  return { rows: parsed, months }
}

// ── TuneCore parser ──────────────────────────────────────
export function parseTuneCore(text) {
  const result = Papa.parse(text, { header: true, skipEmptyLines: true })
  const rows = result.data
  if (!rows.length) return { rows: [], months: [] }

  const agg = {}
  for (const row of rows) {
    const usd = parseFloat(row['Net Sales']) || 0
    const qty = parseInt(row['# Units Sold']) || 0
    if (usd === 0 && qty === 0) continue

    // Sales Period format: "2026-03-01" → "2026-03"
    const rawMonth = row['Sales Period'] || ''
    const month = rawMonth.slice(0, 7)
    if (!month) continue

    const artist  = normArtist(row['Artist'] || 'Inconnu')
    const title   = row['Song Title'] || row['Release Title'] || 'Inconnu'
    const store   = row['Store Name'] || 'Autre'
    const country = row['Country Of Sale'] || ''
    const isrc    = row['Optional ISRC'] || ''

    const key = `${month}|${artist}|${title}|${store}|${country}|${isrc}`
    if (!agg[key]) agg[key] = { usd: 0, qty: 0 }
    agg[key].usd += usd
    agg[key].qty += qty
  }

  const parsed = Object.entries(agg).map(([key, v]) => {
    const [month, artist, title, store, country, isrc] = key.split('|')
    return {
      month, artist, title, store, country, isrc,
      usd: Math.round(v.usd * 10000) / 10000,
      qty: v.qty
    }
  })

  const months = [...new Set(parsed.map(r => r.month))]
  return { rows: parsed, months }
}

// ── Warner parser ─────────────────────────────────────────
// Format réel Warner Music France : TSV (tabulation), colonnes exactes
// Sales Period : "2026 03" → "2026-03"
// Montants en EUR → convertis en USD via eurRate (défaut 0.92)
export function parseWarner(text, eurRate = 0.92) {
  // Warner uses tab-separated values
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { rows: [], months: [] }

  const headers = lines[0].split('\t').map(h => h.trim())
  const idx = name => headers.indexOf(name)

  // Column indices
  const iTitle    = idx('Product Title')
  const iArtist   = idx('Product Artist')
  const iStore    = idx('Digital Service Provider(DSP)')
  const iCountry  = idx('Country')
  const iQty      = idx('Sale Units')
  const iEur      = idx('Royalty Payable')
  const iPeriod   = idx('Sales Period')

  if (iTitle < 0 || iPeriod < 0) {
    throw new Error('Format Warner non reconnu. Vérifier que c\'est bien le fichier .txt Warner.')
  }

  const agg = {}
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    if (cols.length < headers.length - 1) continue

    const eur = parseFloat(cols[iEur]) || 0
    const qty = parseInt(cols[iQty]) || 0
    if (eur === 0 && qty === 0) continue

    // Sales Period "2026 03" → "2026-03"
    const rawPeriod = (cols[iPeriod] || '').trim()
    const month = rawPeriod.replace(' ', '-')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue

    const rawArtist = (cols[iArtist] || '').trim()
    const artist = normWarnerArtist(rawArtist)
    const title   = (cols[iTitle]   || '').trim() || 'Inconnu'
    const store   = (cols[iStore]   || '').trim() || 'Warner'
    const country = (cols[iCountry] || '').trim()

    // Convert EUR → USD
    const usd = eur / eurRate

    const key = `${month}|${artist}|${title}|${store}|${country}`
    if (!agg[key]) agg[key] = { usd: 0, qty: 0 }
    agg[key].usd += usd
    agg[key].qty += qty
  }

  const parsed = Object.entries(agg).map(([key, v]) => {
    const [month, artist, title, store, country] = key.split('|')
    return {
      month, artist, title, store, country, isrc: '',
      usd: Math.round(v.usd * 10000) / 10000,
      qty: v.qty
    }
  })

  const months = [...new Set(parsed.map(r => r.month))]
  return { rows: parsed, months }
}

// Normalize Warner artist names to our internal names
function normWarnerArtist(raw) {
  const l = raw.toLowerCase()
  // Sherifflazone (Warner spelling) → Sherfflazone (our spelling)
  if (l.includes('sherif') || l.includes('sherff') || l.includes('shérif')) return 'Sherfflazone'
  // NoSnow
  if (l.includes('nosnow') || l.includes('no snow')) return 'NoSnow'
  // Collaborations : keep the main artist
  if (l.includes('&') || l.includes('feat')) {
    if (l.includes('sherif') || l.includes('sherff')) return 'Sherfflazone'
    if (l.includes('nosnow')) return 'NoSnow'
  }
  // Fallback: use our general normArtist
  return normArtist(raw)
}
