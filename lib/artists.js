export const ARTISTS = ['NoSnow', 'Magie!', 'Veridis Project', 'Louis Marguier']

export const COLORS = {
  'NoSnow':          '#3b82f6',
  'Magie!':          '#f97316',
  'Veridis Project': '#eab308',
  'Louis Marguier':  '#a78bfa',
}

export const PLAT_COLORS = [
  '#3b82f6','#f97316','#22c55e','#eab308',
  '#ef4444','#06b6d4','#ec4899','#84cc16',
  '#f59e0b','#6366f1','#14b8a6','#f43f5e',
]

export function normArtist(raw) {
  const l = raw.toLowerCase()
  if (l.includes('nosnow') || l.includes('no snow')) return 'NoSnow'
  if (l.includes('sherff')) return 'Sherfflazone'
  if (l.includes('louis marguier')) return 'Louis Marguier'
  if (l.includes('magie') && l.includes('veridis')) return 'Magie!'
  if (l.includes('magie')) return 'Magie!'
  if (l.includes('veridis')) return 'Veridis Project'
  return raw
}

export function fmt(v, rate = 1) {
  return '$' + Math.round(v).toLocaleString('fr-FR')
}
export function fmtE(v, rate) {
  return '€' + Math.round(v * rate).toLocaleString('fr-FR')
}
export function deltaStr(cur, prev) {
  if (!prev || prev === 0) return null
  const d = ((cur - prev) / prev * 100).toFixed(1)
  return { str: (d > 0 ? '+' : '') + d + '%', positive: parseFloat(d) >= 0 }
}
