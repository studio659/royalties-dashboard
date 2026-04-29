export const ARTISTS = ['NoSnow', 'Magie!', 'Veridis Project', 'Louis Marguier']

export const ARTIST_SOURCES = {
  'NoSnow':          ['warner'],
  'Magie!':          ['distrokid'],
  'Veridis Project': ['distrokid'],
  'Louis Marguier':  ['distrokid', 'tunecore'],
  'Sherfflazone':    ['warner'],
}

// Devise native par artiste — utilisé en priorité sur l'auto-detect
export const ARTIST_CURRENCY = {
  'Sherfflazone':    'EUR',
  'NoSnow':          'EUR',
  'Magie!':          'USD',
  'Veridis Project': 'USD',
  'Louis Marguier':  'USD',
}

export const COLORS = {
  'NoSnow':          '#3b82f6',
  'Magie!':          '#f97316',
  'Veridis Project': '#eab308',
  'Louis Marguier':  '#a78bfa',
  'Sherfflazone':    '#22c55e',
}

export const PLAT_COLORS = [
  '#3b82f6','#f97316','#22c55e','#eab308',
  '#ef4444','#06b6d4','#ec4899','#84cc16',
  '#f59e0b','#6366f1','#14b8a6','#f43f5e',
]

export function normArtist(raw) {
  const l = (raw || '').toLowerCase()
  if (l.includes('nosnow') || l.includes('no snow')) return 'NoSnow'
  if (l.includes('sherff')) return 'Sherfflazone'
  if (l.includes('louis marguier')) return 'Louis Marguier'
  if (l.includes('magie') && l.includes('veridis')) return 'Magie!'
  if (l.includes('magie')) return 'Magie!'
  if (l.includes('veridis')) return 'Veridis Project'
  return raw
}

// ─── Formatters ─────────────────────────────────────────────
// fmt(v)            → '$X' (rétro-compat, USD par défaut)
// fmt(v, 'EUR')     → 'X €'
// fmt(v, 'USD')     → '$X'
export function fmt(v, currency = 'USD') {
  if (v === undefined || v === null || isNaN(v)) {
    return currency === 'EUR' ? '0 €' : '$0'
  }
  const rounded = Math.round(v)
  const abs = Math.abs(rounded).toLocaleString('fr-FR')
  const sign = rounded < 0 ? '-' : ''
  return currency === 'EUR' ? `${sign}${abs} €` : `${sign}$${abs}`
}

// Alias rétro-compat (si du code ailleurs s'en sert)
export function fmtEur(v) { return fmt(v, 'EUR') }
export function fmtAmount(v, currency) { return fmt(v, currency) }

export function currencySymbol(currency) {
  return currency === 'EUR' ? '€' : '$'
}

export function fmtStreams(v) {
  if (!v) return '0'
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M'
  if (v >= 1000)    return (v / 1000).toFixed(1) + 'K'
  return v.toLocaleString('fr-FR')
}

export function deltaStr(cur, prev) {
  if (!prev || prev === 0) return null
  const d = ((cur - prev) / Math.abs(prev) * 100).toFixed(1)
  return { str: (d > 0 ? '+' : '') + d + '%', positive: parseFloat(d) >= 0 }
}

// ─── Conversions de devise ──────────────────────────────────
// Convention : eurRate = combien de EUR pour 1 USD (ex: 0.92 → 1$ = 0.92€)
// EUR → USD : eur / eurRate
// USD → EUR : usd * eurRate
export function toEur(amount, currency, eurRate = 0.92) {
  if (currency === 'EUR') return amount || 0
  return (amount || 0) * eurRate
}

export function toUsd(amount, currency, eurRate = 0.92) {
  if (currency === 'USD') return amount || 0
  return (amount || 0) / eurRate
}

// Convertit un montant d'une devise à une autre
export function convertCurrency(amount, fromCurrency, toCurrency, eurRate = 0.92) {
  if (amount === undefined || amount === null) return 0
  if (fromCurrency === toCurrency) return amount
  if (fromCurrency === 'EUR' && toCurrency === 'USD') return amount / eurRate
  if (fromCurrency === 'USD' && toCurrency === 'EUR') return amount * eurRate
  return amount
}

// Helper : montant d'une ligne royalty dans une devise cible
export function rowAmountIn(row, targetCurrency, eurRate = 0.92) {
  const a = Number(row.amount ?? row.usd ?? 0)
  const c = row.currency || 'USD'
  return convertCurrency(a, c, targetCurrency, eurRate)
}

// Détecte la devise dominante d'un set de lignes (par nombre de lignes)
export function detectMajorityCurrency(rows) {
  if (!rows || !rows.length) return 'USD'
  const counts = {}
  for (const r of rows) {
    const c = r.currency || 'USD'
    counts[c] = (counts[c] || 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

// Devise d'affichage d'un artiste : map explicite > auto-detect > fallback USD
export function getArtistCurrency(artist, rows) {
  if (ARTIST_CURRENCY[artist]) return ARTIST_CURRENCY[artist]
  return detectMajorityCurrency(rows || [])
}
