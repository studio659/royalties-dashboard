import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../../lib/supabase'
import { useRate } from '../../../lib/rateContext'
import { COLORS, fmtStreams } from '../../../lib/artists'
import { computeRecoupe, fmtEur, pctColor, phaseLabel, toEur } from '../../../lib/recoupe'
import MainNav from '../../../components/MainNav'

export default function SingleDetail() {
  const router = useRouter()
  const { singleId } = router.query
  const { rate } = useRate()
  const [single, setSingle] = useState(null)
  const [serie, setSerie] = useState(null)
  const [royaltyRows, setRoyaltyRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
  }, [])

  useEffect(() => {
    if (!singleId) return
    fetchData()
  }, [singleId])

  async function fetchData() {
    setLoading(true)
    const { data: s } = await supabase
      .from('singles')
      .select('*, budget_lines(*), series(*)')
      .eq('id', singleId)
      .single()

    if (!s) { setLoading(false); return }
    setSingle(s)
    setSerie(s.series)

    let allRoy = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties')
        .select('month, amount, currency, qty, store, title')
        .eq('artist', s.artist)
        .ilike('title', s.title)
        .range(from, from + 999)
      if (error || !data?.length) break
      allRoy = allRoy.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    allRoy.sort((a, b) => a.month.localeCompare(b.month))
    setRoyaltyRows(allRoy)
    setLoading(false)
  }

  if (loading || !single) return (
    <div className="app">
      <MainNav showBack onBack={() => router.back()} />
      <div className="loading-screen"><div className="loading-spinner" style={{ borderTopColor: '#f59e0b' }} /></div>
    </div>
  )

  // ⚠️ ICI : pour un single dans une série multi-titres, on calcule la recoupe
  // sur ce single uniquement (sa fabrication, sa contribution aux revenus).
  // Pour ça on construit un "pseudo-projet" avec uniquement ses budget_lines
  // et l'avance artiste proportionnée si la série a plus d'un titre.
  const singleProject = {
    ...serie,
    artist_advance: serie?.singles_count > 1
      ? (serie.artist_advance || 0) / serie.singles_count
      : (serie?.artist_advance || 0),
    distrib_advance: null, // l'avance distrib est au niveau série, pas single
  }
  const stats = computeRecoupe(singleProject, single.budget_lines || [], royaltyRows, rate)

  const totalEur = stats.grossRevenue
  const budgetLines = single.budget_lines || []
  const fabricationCost = stats.fabricationCost
  const totalBudget = fabricationCost + stats.artistAdvance

  const artistRate  = serie?.artist_rate || 0
  const coprodRate  = serie?.coprod_rate || 0
  const labelRate   = serie?.label_rate  || 100
  const coprodName  = serie?.coprod_name || ''

  // Évolution mensuelle
  const byMonth = stats.byMonth
  const months = stats.months
  const maxMonthly = Math.max(...Object.values(byMonth), 1)

  // Top plateformes
  const byPlat = {}
  royaltyRows.forEach(r => {
    if (!byPlat[r.store]) byPlat[r.store] = 0
    byPlat[r.store] += toEur(r, rate)
  })
  const topPlats = Object.entries(byPlat).sort((a, b) => b[1] - a[1]).slice(0, 5)

  function exportCSV() {
    const rows = [['Mois', 'Revenus €', '% du budget recoupé']]
    months.forEach(m => {
      rows.push([m, (byMonth[m] || 0).toFixed(2), totalBudget > 0 ? ((byMonth[m] || 0) / totalBudget * 100).toFixed(1) : '0'])
    })
    rows.push(['', '', ''])
    rows.push(['BUDGET LIGNES', '€', ''])
    budgetLines.forEach(l => rows.push([l.label, l.amount_eur, '']))
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `recoupe_${single.title.replace(/[^a-z0-9]/gi, '_')}.csv`
    a.click()
  }

  const color = COLORS[single.artist] || '#a78bfa'

  return (
    <div className="app">
      <MainNav title={single.title} showBack onBack={() => router.push(`/recoupe/${serie?.id}`)} />
      <div className="page">

        <div className="breadcrumb">
          <span className="bc-link" onClick={() => router.push('/recoupe')}>Recoupe</span>
          <span className="bc-sep">›</span>
          <span className="bc-link" onClick={() => router.push(`/recoupe/${serie?.id}`)}>{serie?.name}</span>
          <span className="bc-sep">›</span>
          <span className="bc-current">{single.title}</span>
        </div>

        <div className="single-hero">
          <div className="sh-type">Single · {single.artist}</div>
          <div className="sh-title">{single.title}</div>
          <div className="sh-meta">
            {single.release_date && new Date(single.release_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
            {stats.totalQty > 0 && ` · ${fmtStreams(stats.totalQty)} streams`}
            {coprodName && ` · co-prod ${coprodName}`}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={exportCSV} className="export-btn">↓ Exporter CSV</button>
        </div>

        {/* TRACKER PRINCIPAL */}
        <div className="tracker-card">
          <div className="tc-top">
            <div>
              <div className="tc-label">Phase</div>
              <div className="tc-phase" style={{ color: pctColor(stats.fabricationPct) }}>{phaseLabel(stats.phase)}</div>
            </div>
            <div className="tc-right">
              <div className="tc-gen">{fmtEur(totalEur)} générés</div>
              <div className="tc-bud">budget total {fmtEur(totalBudget)}</div>
            </div>
          </div>
        </div>

        {/* RECOUPES PARALLÈLES */}
        <div className="two-col">
          {stats.artistAdvance > 0 && (
            <div className="mini-tracker">
              <div className="mt-label">Avance artiste · {fmtEur(stats.artistAdvance)}</div>
              <div className="mt-bar">
                <div className="mt-fill" style={{ width: `${stats.artistAdvancePct}%`, background: stats.artistAdvanceDone ? 'linear-gradient(90deg,#a78bfa,#6ee7b7)' : '#a78bfa' }} />
              </div>
              <div className="mt-info">
                <span style={{ color: pctColor(stats.artistAdvancePct), fontWeight: 700 }}>{stats.artistAdvancePct.toFixed(1)}%</span>
                <span>{fmtEur(stats.artistAdvanceRecouped)} / {fmtEur(stats.artistAdvance)}</span>
              </div>
              {stats.artistAdvanceDone && (
                <div className="mt-cash" style={{ color: '#6ee7b7' }}>
                  ✓ {single.artist} touche {fmtEur(stats.artistCash)} en cash
                </div>
              )}
            </div>
          )}

          <div className="mini-tracker">
            <div className="mt-label">Fabrication · {fmtEur(fabricationCost)}</div>
            <div className="mt-bar">
              <div className="mt-fill" style={{ width: `${stats.fabricationPct}%`, background: stats.fabricationDone ? 'linear-gradient(90deg,#f97316,#6ee7b7)' : '#f97316' }} />
            </div>
            <div className="mt-info">
              <span style={{ color: pctColor(stats.fabricationPct), fontWeight: 700 }}>{stats.fabricationPct.toFixed(1)}%</span>
              <span>{fmtEur(stats.fabricationRecouped)} / {fmtEur(fabricationCost)}</span>
            </div>
            {stats.fabricationDone && (
              <div className="mt-cash" style={{ color: '#6ee7b7' }}>
                ✓ Bénéfice : {fmtEur(stats.labelProfit)}
              </div>
            )}
          </div>
        </div>

        {/* BUDGET DETAIL + RÉPARTITION */}
        <div className="two-col" style={{ marginTop: 14 }}>
          <div className="inner-card">
            <div className="ic-title">Budget fabrication · {fmtEur(fabricationCost)}</div>
            {budgetLines.length === 0 ? (
              <div style={{ color: '#444', fontSize: 12, padding: '12px 0' }}>Aucune ligne de budget</div>
            ) : budgetLines.map(line => (
              <div key={line.id} className="bl-row">
                <span className="bl-name">{line.label}</span>
                <span className="bl-amount">{fmtEur(line.amount_eur)}</span>
              </div>
            ))}
            <div className="bl-total"><span>Total</span><span>{fmtEur(fabricationCost)}</span></div>
          </div>

          <div className="inner-card">
            <div className="ic-title">Répartition après recoupe</div>
            <PartRow name={`${single.artist}`} pct={artistRate} color={color} val={`${artistRate}%`} valColor="#aaa" />
            {coprodName ? (
              <>
                <PartRow name="Avlanche label" pct={labelRate} color="#f97316" val={`${labelRate}% du restant`} valColor="#aaa" />
                <PartRow name={coprodName} pct={coprodRate} color="#eab308" val={`${coprodRate}% du restant`} valColor="#eab308" />
              </>
            ) : (
              <PartRow name="Avlanche label" pct={100 - artistRate} color="#f97316" val={`${100 - artistRate}%`} valColor="#aaa" />
            )}
            <div className="rep-info">
              {stats.profitsAvailable
                ? `Bénéfice actuel : ${fmtEur(stats.labelNet)} label${coprodName ? ` · ${fmtEur(stats.coprodNet)} ${coprodName}` : ''}`
                : 'En cours de recoupe — pas encore de bénéfice à répartir'}
            </div>
          </div>
        </div>

        {/* ÉVOLUTION MENSUELLE */}
        {months.length > 0 && (
          <div className="inner-card" style={{ marginTop: 14 }}>
            <div className="ic-title">Évolution mensuelle</div>
            {months.map(m => {
              const v = byMonth[m]
              const w = (v / maxMonthly * 100).toFixed(1)
              return (
                <div key={m} className="sim-row">
                  <div className="sim-month">{m}</div>
                  <div className="sim-bar-bg">
                    <div className="sim-bar" style={{ width: `${w}%`, background: '#f97316' }}>{fmtEur(v)}</div>
                  </div>
                  <div className="sim-pct">{totalBudget > 0 ? ((v / totalBudget) * 100).toFixed(1) : 0}%</div>
                </div>
              )
            })}
            {!stats.fabricationDone && stats.monthlyAvg > 0 && stats.hasEnoughData && (
              <div className="sim-row sim-est">
                <div className="sim-month" style={{ color: '#f59e0b' }}>prochain</div>
                <div className="sim-bar-bg">
                  <div className="sim-bar" style={{ width: `${Math.min(stats.monthlyAvg / maxMonthly * 100, 100).toFixed(1)}%`, background: '#f59e0b55', border: '1px dashed #f59e0b66' }}>≈ {fmtEur(stats.monthlyAvg)}</div>
                </div>
                <div className="sim-pct" style={{ color: '#f59e0b' }}>est.</div>
              </div>
            )}
          </div>
        )}

        {/* TOP PLATEFORMES */}
        {topPlats.length > 0 && (
          <div className="inner-card" style={{ marginTop: 14 }}>
            <div className="ic-title">Top plateformes</div>
            {topPlats.map(([plat, val]) => (
              <div key={plat} className="sim-row">
                <div className="sim-month" style={{ width: 120 }}>{plat.length > 14 ? plat.slice(0, 12) + '…' : plat}</div>
                <div className="sim-bar-bg">
                  <div className="sim-bar" style={{ width: `${(val / topPlats[0][1] * 100).toFixed(1)}%`, background: '#f97316' }}>{fmtEur(val)}</div>
                </div>
                <div className="sim-pct">{((val / totalEur) * 100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .breadcrumb{font-size:11px;color:#444;margin-bottom:20px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .bc-link{color:#555;cursor:pointer}.bc-link:hover{color:#aaa}
        .bc-sep{color:#333}.bc-current{color:#888}
        .single-hero{margin-bottom:18px}
        .sh-type{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
        .sh-title{font-size:22px;font-weight:700;margin-bottom:4px}
        .sh-meta{font-size:12px;color:#555}
        .export-btn{background:none;border:1px solid #1e1e1e;border-radius:6px;color:#555;font-size:12px;padding:6px 14px;cursor:pointer;font-family:inherit}
        .tracker-card{background:#141414;border:1px solid #1e1e1e;border-radius:10px;padding:18px 22px;margin-bottom:14px}
        .tc-top{display:flex;justify-content:space-between;align-items:flex-end}
        .tc-label{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}
        .tc-phase{font-size:18px;font-weight:700}
        .tc-right{text-align:right}
        .tc-gen{font-size:18px;font-weight:700;color:#eee;margin-bottom:2px}
        .tc-bud{font-size:11px;color:#555}
        .two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        @media(max-width:600px){.two-col{grid-template-columns:1fr}}
        .mini-tracker{background:#141414;border:1px solid #1e1e1e;border-radius:9px;padding:14px 16px}
        .mt-label{font-size:11px;color:#888;font-weight:700;margin-bottom:8px}
        .mt-bar{height:6px;background:#1a1a1a;border-radius:3px;overflow:hidden;margin-bottom:6px}
        .mt-fill{height:100%;border-radius:3px;transition:width .4s}
        .mt-info{display:flex;justify-content:space-between;font-size:11px;color:#666;margin-bottom:6px}
        .mt-cash{font-size:11px;font-weight:600;margin-top:4px}
        .inner-card{background:#141414;border:1px solid #1e1e1e;border-radius:9px;padding:14px 16px}
        .ic-title{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;font-weight:700}
        .bl-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #191919;font-size:12px}
        .bl-name{flex:1;color:#bbb}
        .bl-amount{font-weight:600;color:#eee;flex-shrink:0}
        .bl-total{display:flex;justify-content:space-between;padding-top:10px;margin-top:6px;border-top:1px solid #222;font-size:13px;font-weight:700;color:#f97316}
        .rep-info{margin-top:10px;font-size:11px;color:#555;line-height:1.5;padding-top:10px;border-top:1px solid #1a1a1a}
        .sim-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
        .sim-month{width:60px;font-size:11px;color:#666;flex-shrink:0}
        .sim-bar-bg{flex:1;height:18px;background:#1a1a1a;border-radius:3px;overflow:hidden}
        .sim-bar{height:100%;border-radius:3px;display:flex;align-items:center;padding:0 7px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap}
        .sim-pct{width:40px;text-align:right;font-size:10px;color:#555;flex-shrink:0}
        .sim-est{background:#1a1400;border:1px solid #f59e0b22;border-radius:5px;padding:4px 6px}
      `}</style>
    </div>
  )
}

function PartRow({ name, pct, color, val, valColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: 130, fontSize: 12, color, lineHeight: 1.3 }}>{name}</div>
      <div style={{ flex: 1, height: 16, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(pct, 0)}%`, height: '100%', background: color, borderRadius: 3, minWidth: 4 }} />
      </div>
      <div style={{ width: 100, textAlign: 'right', fontSize: 12, fontWeight: 600, color: valColor }}>{val}</div>
    </div>
  )
}
