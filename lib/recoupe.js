// ╔══════════════════════════════════════════════════════════════╗
// ║  lib/recoupe.js                                              ║
// ║  Bibliothèque centralisée des calculs de recoupe             ║
// ║                                                              ║
// ║  Gère les 2 schémas :                                        ║
// ║   - Schéma 1 : Aggregator (DistroKid, TuneCore)              ║
// ║   - Schéma 2 : Distributor (Warner) avec avance distrib      ║
// ║                                                              ║
// ║  Tout est calculé en EUR (les royalties USD sont converties) ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * Convertit une ligne de royalty en EUR
 * @param {Object} row {amount, currency}
 * @param {number} eurRate taux : 1 USD = eurRate EUR
 * @returns {number} montant en EUR
 */
export function toEur(row, eurRate) {
  const a = Number(row.amount || 0)
  if (row.currency === 'EUR') return a
  if (row.currency === 'USD') return a * eurRate
  return a
}

/**
 * Calcule les statistiques de recoupe complètes pour un projet
 *
 * @param {Object} project Le projet (série) avec son contrat
 *   - currency: 'EUR' (la devise du projet est toujours EUR pour la recoupe)
 *   - distrib_advance: number | null (avance Warner si schéma 2)
 *   - artist_advance: number (avance artiste en EUR)
 *   - artist_rate: number (% artiste, ex 15)
 *   - label_rate: number (% label dans le restant après artiste, ex 60)
 *   - coprod_rate: number (% coprod dans le restant, ex 35)
 *   - mgmt_rate: number (% gestion Avlanche, prélevée sur la part coprod, ex 5)
 *   - coprod_name: string | null
 *
 * @param {Array} budgetLines Toutes les lignes de budget de fabrication
 *   - amount_eur: number
 *
 * @param {Array} royaltyRows Les lignes de royalties brutes du projet
 *   - amount: number
 *   - currency: 'EUR' | 'USD'
 *   - month: string (YYYY-MM)
 *
 * @param {number} eurRate Taux de change (1 USD = eurRate EUR)
 *
 * @returns {Object} Statistiques complètes
 */
export function computeRecoupe(project, budgetLines, royaltyRows, eurRate) {
  // ── 1. Revenus bruts en EUR ────────────────────────────────
  const grossRevenue = royaltyRows.reduce((s, r) => s + toEur(r, eurRate), 0)
  const totalQty = royaltyRows.reduce((s, r) => s + Number(r.qty || 0), 0)

  // ── 2. Fabrication = somme des budget_lines ────────────────
  const fabricationCost = budgetLines.reduce((s, l) => s + Number(l.amount_eur || 0), 0)

  // ── 3. Paramètres ──────────────────────────────────────────
  const artistRate  = Number(project.artist_rate || 0)
  const labelRate   = Number(project.label_rate || 100)
  const coprodRate  = Number(project.coprod_rate || 0)
  const artistAdvance = Number(project.artist_advance || 0)
  const distribAdvance = project.distrib_advance != null ? Number(project.distrib_advance) : null
  const isWarner = distribAdvance != null && distribAdvance > 0

  // ── 4. Phase -1 : Recoupe avance distrib (Schéma 2) ────────
  let distribPhase = null
  let avlancheRevenue = grossRevenue  // ce qui arrive à Avlanche après recoupe distrib

  if (isWarner) {
    const distribRecouped  = Math.min(grossRevenue, distribAdvance)
    const distribRemaining = Math.max(0, distribAdvance - grossRevenue)
    const distribPct = distribAdvance > 0
      ? Math.min((grossRevenue / distribAdvance) * 100, 100)
      : 100
    const distribDone = grossRevenue >= distribAdvance

    distribPhase = {
      advance: distribAdvance,
      recouped: distribRecouped,
      remaining: distribRemaining,
      pct: distribPct,
      done: distribDone,
      distribName: project.distrib_name || 'Distributeur',
    }

    // Avlanche ne perçoit que ce qui dépasse l'avance Warner
    avlancheRevenue = Math.max(0, grossRevenue - distribAdvance)
  }

  // ── 5. Phase 0 : Recoupes interne (artiste + fab) ────────
  // ⚠️ Logique différente selon schéma :
  //   - Schéma 1 (DistroKid) : Avlanche dépense de sa poche → recoupe artiste + fab nécessaire
  //   - Schéma 2 (Warner) : avance artiste + fab payés via l'avance distrib → pas de recoupe interne
  //     Sauf si Avlanche apporte de l'argent en plus (fabricationCost = apport extra)

  let artistTheoretical, artistAdvanceRecouped, artistAdvanceRemaining, artistAdvancePct, artistAdvanceDone, artistCash
  let labelTheoretical, fabricationRecouped, fabricationRemaining, fabricationPct, fabricationDone, labelProfit

  if (isWarner) {
    // Schéma 2 : l'avance artiste a été payée via l'avance distrib
    // → Pas de recoupe interne. L'artiste touche directement son % dès que Warner est recoupée.
    artistTheoretical = avlancheRevenue * artistRate / 100
    artistCash = artistTheoretical                     // direct, pas de recoupe interne
    artistAdvanceRecouped = artistAdvance              // implicit ✓ (via l'avance distrib)
    artistAdvanceRemaining = 0
    artistAdvancePct = 100
    artistAdvanceDone = true

    // Apport extra Avlanche (= fabricationCost en schéma 2, 0 par défaut)
    labelTheoretical = avlancheRevenue - artistTheoretical
    fabricationRecouped = Math.min(labelTheoretical, fabricationCost)
    fabricationRemaining = Math.max(0, fabricationCost - labelTheoretical)
    fabricationPct = fabricationCost > 0
      ? Math.min((labelTheoretical / fabricationCost) * 100, 100)
      : 100
    fabricationDone = labelTheoretical >= fabricationCost
    labelProfit = Math.max(0, labelTheoretical - fabricationCost)
  } else {
    // Schéma 1 : recoupe parallèle artiste + fab
    artistTheoretical = avlancheRevenue * artistRate / 100
    artistAdvanceRecouped = Math.min(artistTheoretical, artistAdvance)
    artistAdvanceRemaining = Math.max(0, artistAdvance - artistTheoretical)
    artistAdvancePct = artistAdvance > 0
      ? Math.min((artistTheoretical / artistAdvance) * 100, 100)
      : 100
    artistAdvanceDone = artistTheoretical >= artistAdvance
    artistCash = Math.max(0, artistTheoretical - artistAdvance)

    labelTheoretical = avlancheRevenue - artistTheoretical
    fabricationRecouped = Math.min(labelTheoretical, fabricationCost)
    fabricationRemaining = Math.max(0, fabricationCost - labelTheoretical)
    fabricationPct = fabricationCost > 0
      ? Math.min((labelTheoretical / fabricationCost) * 100, 100)
      : 100
    fabricationDone = labelTheoretical >= fabricationCost
    labelProfit = Math.max(0, labelTheoretical - fabricationCost)
  }

  // ── 6. Phase 1 : Bénéfices ─────────────────────────────────
  const profitsAvailable = (!isWarner || distribPhase.done) && artistAdvanceDone && fabricationDone

  // Répartition du profit label entre coprod et label net
  // - Si pas de coprod : labelProfit reste entièrement à Avlanche label
  // - Si coprod : labelProfit × (label_rate, coprod_rate) — somme = 100
  const hasCoprod = !!project.coprod_name && coprodRate > 0
  const totalShareRate = labelRate + coprodRate || 100

  const labelNet  = hasCoprod ? labelProfit * (labelRate / totalShareRate) : labelProfit
  const coprodNet = hasCoprod ? labelProfit * (coprodRate / totalShareRate) : 0

  // ── 7. Phase actuelle ──────────────────────────────────────
  let phase
  if (isWarner && !distribPhase.done) phase = 'distrib'
  else if (!artistAdvanceDone || !fabricationDone) phase = 'recoupe'
  else phase = 'profit'

  // ── 8. Projection (mois restants pour finir la recoupe) ────
  const byMonth = {}
  royaltyRows.forEach(r => {
    if (!byMonth[r.month]) byMonth[r.month] = 0
    byMonth[r.month] += toEur(r, eurRate)
  })
  const months = Object.keys(byMonth).sort()
  const last3 = months.slice(-3)
  const monthlyAvg = last3.length > 0
    ? last3.reduce((s, m) => s + byMonth[m], 0) / last3.length
    : 0
  const hasEnoughData = months.length >= 3

  // Projection pour la phase actuelle
  let projectionMonthsLeft = null
  if (hasEnoughData && monthlyAvg > 0) {
    if (phase === 'distrib') {
      projectionMonthsLeft = Math.ceil(distribPhase.remaining / monthlyAvg)
    } else if (phase === 'recoupe') {
      // Combien faut-il de royalties brutes pour finir les 2 recoupes ?
      // - Pour artiste : artistAdvanceRemaining / (artist_rate/100)
      // - Pour fabrication : fabricationRemaining / ((100-artist_rate)/100)
      const needForArtist = artistRate > 0 ? artistAdvanceRemaining / (artistRate / 100) : 0
      const needForFab    = artistRate < 100 ? fabricationRemaining / ((100 - artistRate) / 100) : 0
      const needTotal     = Math.max(needForArtist, needForFab)
      projectionMonthsLeft = needTotal > 0 ? Math.ceil(needTotal / monthlyAvg) : 0
    } else {
      projectionMonthsLeft = 0
    }
  }

  return {
    // Revenus
    grossRevenue,            // EUR brut généré (avant distrib)
    avlancheRevenue,         // EUR qui arrive à Avlanche (après recoupe distrib)
    totalQty,                // nb de streams cumulés

    // Fabrication
    fabricationCost,
    fabricationRecouped,
    fabricationRemaining,
    fabricationPct,
    fabricationDone,

    // Avance distrib (null si schéma 1)
    distribPhase,

    // Avance artiste
    artistAdvance,
    artistTheoretical,        // total théorique gagné par l'artiste (cumul)
    artistAdvanceRecouped,
    artistAdvanceRemaining,
    artistAdvancePct,
    artistAdvanceDone,
    artistCash,               // cash réellement perçu par l'artiste

    // Bénéfices
    profitsAvailable,
    labelProfit,              // surplus du label (avant partage coprod)
    labelNet,                 // ce que touche Avlanche label
    coprodNet,                // ce que touche le coprod
    hasCoprod,

    // État
    phase,                    // 'distrib' | 'recoupe' | 'profit'
    isWarner,

    // Projection
    monthlyAvg,
    hasEnoughData,
    projectionMonthsLeft,

    // Données mensuelles pour graphes
    byMonth,
    months,
  }
}

/**
 * Calcule les stats agrégées pour un artiste (somme de toutes ses séries)
 */
export function computeArtistStats(seriesStats) {
  return seriesStats.reduce((acc, s) => ({
    grossRevenue: acc.grossRevenue + s.grossRevenue,
    avlancheRevenue: acc.avlancheRevenue + s.avlancheRevenue,
    totalQty: acc.totalQty + s.totalQty,
    fabricationCost: acc.fabricationCost + s.fabricationCost,
    fabricationRecouped: acc.fabricationRecouped + s.fabricationRecouped,
    artistAdvance: acc.artistAdvance + s.artistAdvance,
    artistAdvanceRecouped: acc.artistAdvanceRecouped + s.artistAdvanceRecouped,
    artistCash: acc.artistCash + s.artistCash,
    labelNet: acc.labelNet + s.labelNet,
    coprodNet: acc.coprodNet + s.coprodNet,
    labelProfit: acc.labelProfit + s.labelProfit,
    seriesCount: acc.seriesCount + 1,
    recoupedCount: acc.recoupedCount + (s.phase === 'profit' ? 1 : 0),
  }), {
    grossRevenue: 0, avlancheRevenue: 0, totalQty: 0,
    fabricationCost: 0, fabricationRecouped: 0,
    artistAdvance: 0, artistAdvanceRecouped: 0, artistCash: 0,
    labelNet: 0, coprodNet: 0, labelProfit: 0,
    seriesCount: 0, recoupedCount: 0,
  })
}

/**
 * Helpers d'affichage
 */
export const fmtEur = v => {
  if (v == null || isNaN(v)) return '€0'
  const rounded = Math.round(v)
  return '€' + rounded.toLocaleString('fr-FR')
}

export const fmtEurDec = v => {
  if (v == null || isNaN(v)) return '€0'
  return '€' + v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export const pctColor = pct => {
  if (pct >= 100) return '#6ee7b7'
  if (pct >= 60) return '#f59e0b'
  if (pct > 0) return '#f87171'
  return '#444'
}

export const phaseLabel = phase => {
  if (phase === 'distrib') return 'Recoupe avance distributeur'
  if (phase === 'recoupe') return 'Recoupe en cours'
  if (phase === 'profit') return 'Bénéfices'
  return ''
}
