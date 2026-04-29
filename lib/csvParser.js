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

// ── Warner TXT parser ─────────────────────────────────────
export function parseWarner(text, eurRate = 0.92) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { rows: [], months: [] }

  const headers = lines[0].split('\t').map(h => h.trim())
  const idx = name => headers.indexOf(name)

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
    if (eur < 0 || qty < 0) continue

    const rawPeriod = (cols[iPeriod] || '').trim()
    const month = rawPeriod.replace(' ', '-')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue

    const rawArtist = (cols[iArtist] || '').trim()
    const artist = normWarnerArtist(rawArtist)
    const title   = (cols[iTitle]   || '').trim() || 'Inconnu'
    if (title.toLowerCase().startsWith('d2c') || title.toLowerCase().includes('d2c -')) continue
    const store   = (cols[iStore]   || '').trim() || 'Warner'
    const country = (cols[iCountry] || '').trim()

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

function normWarnerArtist(raw) {
  const l = raw.toLowerCase()
  if (l.includes('sherif') || l.includes('sherff') || l.includes('shérif')) return 'Sherfflazone'
  if (l.includes('nosnow') || l.includes('no snow')) return 'NoSnow'
  if (l.includes('&') || l.includes('feat')) {
    if (l.includes('sherif') || l.includes('sherff')) return 'Sherfflazone'
    if (l.includes('nosnow')) return 'NoSnow'
  }
  return normArtist(raw)
}

// ── Warner PDF parser ─────────────────────────────────────
// Parse les relevés Warner au format PDF (texte extrait via PDF.js).
// Le texte doit être reconstruit par positions Y dans extractPDFText (côté ImportModal)
// pour que les regex matchent ligne par ligne.
//
// Stratégie en 2 temps :
//  1. Tente le parsing détaillé par titre via le pattern "<TITRE> Part (%): 100,00 Sous-total <STREAMS> <€>"
//  2. Si aucun titre trouvé → fallback agrégé : extrait juste le total Net du mois et crée une seule ligne
export function parseWarnerPDF(text, eurRate = 0.92) {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean)

  // ── 1. Métadonnées : période + compte FRAD ──
  let month = ''
  let account = ''
  for (const line of lines) {
    if (!month) {
      const m = line.match(/P[eé]riode\s*:?\s*\d{2}\/(\d{2})\/(\d{4})/)
      if (m) month = `${m[2]}-${m[1]}`
    }
    if (!account) {
      const m = line.match(/Compte\s*N°\s*:?\s*(FRAD\d+)/)
      if (m) account = m[1]
    }
    if (month && account) break
  }
  if (!month) throw new Error('Période introuvable dans le PDF.')

  // ── 2. Détection artiste (FRAD code = source de vérité) ──
  const fradMap = {
    'FRAD0140': 'NoSnow',
    'FRAD0169': 'Sherfflazone',
  }
  let artist = fradMap[account]
  if (!artist) {
    // Fallback: scan header for name
    for (const line of lines.slice(0, 30)) {
      const u = line.toUpperCase()
      if (u.includes('NOSNOW') || u.includes('NO SNOW')) { artist = 'NoSnow'; break }
      if (u.includes('SHERIF') || u.includes('SHERFF')) { artist = 'Sherfflazone'; break }
    }
    if (!artist) artist = 'Inconnu'
  }

  // ── 3. Tentative parsing détaillé par titre ──
  // Pattern : <NOM> ... Part (%): 100,00 ... Sous-total <STREAMS> <€>
  // On enlève ^ et $ pour matcher au milieu d'une ligne (plus tolérant)
  const titlePat = /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s'\-!?,.]{0,40}?)\s+Part\s*\(%\)\s*:?\s*100,00\s+Sous-total\s+([\d\s]+)\s+([\d\s]+,\d{2})/g

  const rows = []
  for (const line of lines) {
    titlePat.lastIndex = 0
    let m
    while ((m = titlePat.exec(line)) !== null) {
      // Nettoyage du titre : enlever bruit en début (chiffres, virgules, etc.)
      let title = m[1].trim().replace(/^[\d,.\s\-+%]+/, '').trim()
      if (!title || title.length < 2) continue
      if (title.toLowerCase().startsWith('d2c')) continue

      const qty = parseInt(m[2].replace(/\s/g, '')) || 0
      const eur = parseFloat(m[3].replace(/\s/g, '').replace(',', '.')) || 0
      if (qty <= 0 && eur <= 0) continue

      const usd = eur / eurRate
      rows.push({
        month, artist, title,
        store: 'Warner (PDF)',
        country: '', isrc: '',
        usd: Math.round(usd * 10000) / 10000,
        qty
      })
    }
  }

  // ── 4. Si on a trouvé des titres → on retourne le détail ──
  if (rows.length > 0) {
    return { rows, months: [month] }
  }

  // ── 5. FALLBACK AGRÉGÉ : aucune ligne titre trouvée ──
  // On extrait au minimum le total Net du mois et on crée 1 seule entrée.
  let totalEur = null

  // Priorité 1 : "Total Redevances de la période" → dernier nombre = Net
  for (const line of lines) {
    if (/Total Redevances de la p[eé]riode/i.test(line)) {
      const nums = line.match(/[\d\s]+,\d{2}/g)
      if (nums && nums.length) {
        totalEur = parseFloat(nums[nums.length - 1].replace(/\s/g, '').replace(',', '.'))
        break
      }
    }
  }

  // Priorité 2 : "Total Redevances" simple
  if (totalEur === null) {
    for (const line of lines) {
      const m = line.match(/Total Redevances\s+([\d\s]+,\d{2})/i)
      if (m) {
        totalEur = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'))
        break
      }
    }
  }

  if (totalEur === null || totalEur <= 0) {
    throw new Error('Aucun titre trouvé et impossible d\'extraire le total redevances du PDF. Format inattendu.')
  }

  const usd = totalEur / eurRate
  return {
    rows: [{
      month, artist,
      title: `Total ${month}`,
      store: 'Warner (PDF agrégé)',
      country: '', isrc: '',
      usd: Math.round(usd * 10000) / 10000,
      qty: 0,
    }],
    months: [month]
  }
}
