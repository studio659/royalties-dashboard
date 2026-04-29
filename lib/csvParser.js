import Papa from 'papaparse'
import { normArtist } from './artists'

// ── DistroKid parser (USD natif) ────────────────────────────────────────
export function parseDistroKid(text) {
  const result = Papa.parse(text, {
    delimiter: '\t',
    header: true,
    skipEmptyLines: true,
  })
  const rows = result.data
  if (!rows.length) return { rows: [], months: [] }

  const agg = {}
  for (const row of rows) {
    const usd = parseFloat(row['Earnings (USD)']) || 0
    const qty = parseInt(row['Quantity']) || 0
    if (usd === 0 && qty === 0) continue

    const rawMonth = row['Reporting Month'] || row['Sale Month'] || ''
    let month = ''
    if (/^\d{4}-\d{2}$/.test(rawMonth)) {
      month = rawMonth
    } else if (/^\d{1,2}\/\d{4}$/.test(rawMonth)) {
      const [m, y] = rawMonth.split('/')
      month = `${y}-${m.padStart(2, '0')}`
    } else if (/^\d{4}\/\d{1,2}$/.test(rawMonth)) {
      const [y, m] = rawMonth.split('/')
      month = `${y}-${m.padStart(2, '0')}`
    } else if (/^\d{4}\d{2}$/.test(rawMonth)) {
      month = `${rawMonth.slice(0, 4)}-${rawMonth.slice(4)}`
    }

    const artist  = normArtist(row['Artist'] || 'Inconnu')
    const title   = row['Title'] || row['Song'] || row['Song/Album'] || 'Inconnu'
    const store   = row['Store'] || 'Autre'
    const country = row['Country of Sale'] || row['Country'] || ''
    const isrc    = row['ISRC'] || ''

    if (!month) continue
    const key = `${month}|${artist}|${title}|${store}|${country}|${isrc}`
    if (!agg[key]) agg[key] = { usd: 0, qty: 0 }
    agg[key].usd += usd
    agg[key].qty += qty
  }

  const parsed = Object.entries(agg).map(([key, v]) => {
    const [month, artist, title, store, country, isrc] = key.split('|')
    const amount = Math.round(v.usd * 10000) / 10000
    return {
      month, artist, title, store, country, isrc,
      usd: amount,           // legacy
      amount,                // natif (USD)
      currency: 'USD',
      qty: v.qty
    }
  })

  const months = [...new Set(parsed.map(r => r.month))]
  return { rows: parsed, months }
}

// ── TuneCore parser (USD natif) ─────────────────────────────────────────
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
    const amount = Math.round(v.usd * 10000) / 10000
    return {
      month, artist, title, store, country, isrc,
      usd: amount,
      amount,
      currency: 'USD',
      qty: v.qty
    }
  })

  const months = [...new Set(parsed.map(r => r.month))]
  return { rows: parsed, months }
}

// ── Warner TXT parser (EUR natif) ───────────────────────────────────────
// eurRate sert UNIQUEMENT à calculer la valeur usd legacy (rétrocompat).
// Le montant natif (amount, currency='EUR') n'est jamais converti à l'import.
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
    // Lignes négatives (corrections, remboursements) conservées pour matcher le total Net.

    const rawPeriod = (cols[iPeriod] || '').trim()
    const month = rawPeriod.replace(' ', '-')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue

    const rawArtist = (cols[iArtist] || '').trim()
    const artist = normWarnerArtist(rawArtist)
    const title   = (cols[iTitle]   || '').trim() || 'Inconnu'
    if (title.toLowerCase().startsWith('d2c') || title.toLowerCase().includes('d2c -')) continue
    const store   = (cols[iStore]   || '').trim() || 'Warner'
    const country = (cols[iCountry] || '').trim()

    const key = `${month}|${artist}|${title}|${store}|${country}`
    if (!agg[key]) agg[key] = { eur: 0, qty: 0 }
    agg[key].eur += eur
    agg[key].qty += qty
  }

  const parsed = Object.entries(agg).map(([key, v]) => {
    const [month, artist, title, store, country] = key.split('|')
    const amount = Math.round(v.eur * 10000) / 10000   // EUR natif
    const usd = Math.round((amount / eurRate) * 10000) / 10000  // legacy compat
    return {
      month, artist, title, store, country, isrc: '',
      usd,
      amount,
      currency: 'EUR',
      qty: v.qty
    }
  })

  const months = [...new Set(parsed.map(r => r.month))]
  return { rows: parsed, months }
}

function normWarnerArtist(raw) {
  const l = (raw || '').toLowerCase()
  if (l.includes('sherif') || l.includes('sherff') || l.includes('shérif')) return 'Sherfflazone'
  if (l.includes('nosnow') || l.includes('no snow')) return 'NoSnow'
  if (l.includes('&') || l.includes('feat')) {
    if (l.includes('sherif') || l.includes('sherff')) return 'Sherfflazone'
    if (l.includes('nosnow')) return 'NoSnow'
  }
  return normArtist(raw)
}

// ── Warner PDF parser (EUR natif) ───────────────────────────────────────
export function parseWarnerPDF(text, eurRate = 0.92) {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean)

  // Métadonnées
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

  const fradMap = { 'FRAD0140': 'NoSnow', 'FRAD0169': 'Sherfflazone' }
  let artist = fradMap[account]
  if (!artist) {
    for (const line of lines.slice(0, 30)) {
      const u = line.toUpperCase()
      if (u.includes('NOSNOW') || u.includes('NO SNOW')) { artist = 'NoSnow'; break }
      if (u.includes('SHERIF') || u.includes('SHERFF')) { artist = 'Sherfflazone'; break }
    }
    if (!artist) artist = 'Inconnu'
  }

  // Parsing détaillé : pattern titre + part 100% + sous-total quantité + sous-total €
  const titlePat = /([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s'\-!?,.]{0,40}?)\s+Part\s*\(%\)\s*:?\s*100,00\s+Sous-total\s+([\d\s]+)\s+([\d\s]+,\d{2})/g

  const rows = []
  for (const line of lines) {
    titlePat.lastIndex = 0
    let m
    while ((m = titlePat.exec(line)) !== null) {
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
        amount: Math.round(eur * 10000) / 10000,
        currency: 'EUR',
        qty
      })
    }
  }

  if (rows.length > 0) {
    return { rows, months: [month] }
  }

  // Fallback agrégé : extrait juste le Total Net du mois
  let totalEur = null
  for (const line of lines) {
    if (/Total Redevances de la p[eé]riode/i.test(line)) {
      const nums = line.match(/[\d\s]+,\d{2}/g)
      if (nums && nums.length) {
        totalEur = parseFloat(nums[nums.length - 1].replace(/\s/g, '').replace(',', '.'))
        break
      }
    }
  }
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
    throw new Error('Aucun titre trouvé et impossible d\'extraire le total redevances du PDF.')
  }

  const usd = totalEur / eurRate
  return {
    rows: [{
      month, artist,
      title: `Total ${month}`,
      store: 'Warner (PDF agrégé)',
      country: '', isrc: '',
      usd: Math.round(usd * 10000) / 10000,
      amount: Math.round(totalEur * 10000) / 10000,
      currency: 'EUR',
      qty: 0,
    }],
    months: [month]
  }
}
