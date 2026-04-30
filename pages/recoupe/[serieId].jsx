import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { useRate } from '../../lib/rateContext'
import { COLORS, fmtStreams } from '../../lib/artists'
import { computeRecoupe, fmtEur, pctColor, phaseLabel } from '../../lib/recoupe'
import MainNav from '../../components/MainNav'

export default function SerieDetail() {
  const router = useRouter()
  const { serieId } = router.query
  const { rate } = useRate()
  const [serie, setSerie] = useState(null)
  const [royalties, setRoyalties] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
  }, [])

  useEffect(() => {
    if (!serieId) return
    fetchData()
  }, [serieId])

  async function fetchData() {
    setLoading(true)
    const { data: s } = await supabase
      .from('series')
      .select('*, singles(*, budget_lines(*))')
      .eq('id', serieId)
      .single()

    if (!s) { setLoading(false); return }
    setSerie(s)

    let allRoy = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties')
        .select('title, artist, amount, currency, qty, month')
        .eq('artist', s.artist)
        .range(from, from + 999)
      if (error || !data?.length) break
      allRoy = allRoy.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setRoyalties(allRoy)
    setLoading(false)
  }

  function exportCSV() {
    if (!serie) return
    const stats = getGlobalStats()
    const rows = [
      ['Métrique', 'Valeur'],
      ['Projet', serie.name],
      ['Artiste', serie.artist],
      ['Phase', phaseLabel(stats.phase)],
      ['Total généré (€)', stats.grossRevenue.toFixed(2)],
      ['Streams', stats.totalQty],
      ['Avance distrib (€)', stats.distribPhase?.advance || 0],
      ['Avance distrib recoupée (€)', stats.distribPhase?.recouped || 0],
      ['Avance artiste (€)', stats.artistAdvance],
      ['Avance artiste recoupée (€)', stats.artistAdvanceRecouped.toFixed(2)],
      ['Cash artiste perçu (€)', stats.artistCash.toFixed(2)],
      ['Fabrication (€)', stats.fabricationCost],
      ['Fabrication recoupée (€)', stats.fabricationRecouped.toFixed(2)],
      ['Bénéfice label (€)', stats.labelNet.toFixed(2)],
      ['Bénéfice coprod (€)', stats.coprodNet.toFixed(2)],
    ]
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `recoupe_${serie.name.replace(/[^a-z0-9]/gi, '_')}.csv`
    a.click()
  }

  function getGlobalStats() {
    if (!serie) return null
    const singles = serie.singles || []
    const allBudgetLines = singles.flatMap(s => s.budget_lines || [])
    const titles = singles.map(s => s.title.toLowerCase())
    const serieRoyalties = royalties.filter(r =>
      titles.includes(r.title.toLowerCase())
    )
    return computeRecoupe(serie, allBudgetLines, serieRoyalties, rate)
  }

  // Stats par single (pour la liste détaillée — uniquement utile en mode "série de singles")
  function getSingleStats(single) {
    const rows = royalties.filter(r =>
      r.title.toLowerCase() === single.title.toLowerCase()
    )
    const totalEur = rows.reduce((s, r) => {
      const a = Number(r.amount || 0)
      return s + (r.currency === 'EUR' ? a : a * rate)
    }, 0)
    const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0)
    return { totalEur, totalQty }
  }

  if (loading || !serie) return (
    <div className="app">
      <MainNav showBack onBack={() => router.push('/recoupe')} />
      <div className="loading-screen"><div className="loading-spinner" style={{ borderTopColor: '#f59e0b' }} /></div>
    </div>
  )

  const singles = serie.singles || []
  const stats = getGlobalStats()
  const totalBudget = stats.fabricationCost + stats.artistAdvance
  const totalRecouped = stats.fabricationRecouped + stats.artistAdvanceRecouped
  const globalPct = totalBudget > 0 ? Math.min((totalRecouped / totalBudget) * 100, 100) : 0
  const color = COLORS[serie.artist] || '#f59e0b'

  return (
    <div className="app">
      <MainNav title={serie.name} showBack onBack={() => router.push('/recoupe')} />
      <div className="page">

        <div className="breadcrumb">
          <span className="bc-link" onClick={() => router.push('/recoupe')}>Recoupe</span>
          <span className="bc-sep">›</span>
          <span className="bc-current">{serie.name}</span>
        </div>

        <div className="serie-hero">
          <div className="sh-type">
            {singles.length === 1 ? 'Single' : `Série · ${singles.length} titres`} · {serie.artist}
            {stats.isWarner && <span className="warner-badge">WARNER</span>}
          </div>
          <div className="sh-title">{serie.name}</div>
          <div className="sh-meta">
            Contrat : artiste {serie.artist_rate}%
            {serie.coprod_name && ` · co-prod ${serie.coprod_name} ${serie.coprod_rate}% · label ${serie.label_rate}%`}
            {!serie.coprod_name && ` · label 100% du restant`}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={exportCSV} className="export-btn">↓ Exporter CSV</button>
        </div>

        {/* PHASE WARNER (Schéma 2) */}
        {stats.isWarner && (
          <div className="tracker-card warner-card">
            <div className="tc-head">
              <div className="tc-label">Recoupe avance {stats.distribPhase.distribName}</div>
              <div className="tc-pct" style={{ color: pctColor(stats.distribPhase.pct) }}>
                {stats.distribPhase.pct.toFixed(1)}%
              </div>
            </div>
            <div className="tc-amounts">
              <span>{fmtEur(stats.distribPhase.recouped)} générés</span>
              <span className="muted">/ {fmtEur(stats.distribPhase.advance)} d'avance</span>
            </div>
            <div className="tc-bar">
              <div className="tc-fill" style={{
                width: `${stats.distribPhase.pct}%`,
                background: stats.distribPhase.done ? 'linear-gradient(90deg,#f97316,#6ee7b7)' : '#f59e0b'
              }} />
            </div>
            {!stats.distribPhase.done ? (
              <div className="tc-info">
                ⚡ Reste {fmtEur(stats.distribPhase.remaining)} à générer pour finir la recoupe distrib.
                {stats.projectionMonthsLeft != null && stats.hasEnoughData && ` ~${stats.projectionMonthsLeft} mois au rythme actuel.`}
                <br/>Avlanche perçoit 0€ tant que cette avance n'est pas recoupée.
              </div>
            ) : (
              <div className="tc-info" style={{ color: '#6ee7b7' }}>
                ✓ Avance distrib recoupée. Avlanche commence à percevoir les royalties suivantes.
              </div>
            )}
          </div>
        )}

        {/* TRACKERS RECOUPE INTERNE (uniquement si pas Warner ou Warner recoupé) */}
        {(!stats.isWarner || stats.distribPhase?.done) && (
          <>
            {/* AVANCE ARTISTE */}
            {stats.artistAdvance > 0 && (
              <div className="tracker-card">
                <div className="tc-head">
                  <div className="tc-label">Recoupe avance artiste</div>
                  <div className="tc-pct" style={{ color: pctColor(stats.artistAdvancePct) }}>
                    {stats.artistAdvancePct.toFixed(1)}%
                  </div>
                </div>
                <div className="tc-amounts">
                  <span>{fmtEur(stats.artistAdvanceRecouped)} récupérés via {serie.artist_rate}% théoriques</span>
                  <span className="muted">/ {fmtEur(stats.artistAdvance)} d'avance</span>
                </div>
                <div className="tc-bar">
                  <div className="tc-fill" style={{
                    width: `${stats.artistAdvancePct}%`,
                    background: stats.artistAdvanceDone ? 'linear-gradient(90deg,#a78bfa,#6ee7b7)' : '#a78bfa'
                  }} />
                </div>
                {stats.artistAdvanceDone ? (
                  <div className="tc-info" style={{ color: '#6ee7b7' }}>
                    ✓ Avance recoupée. {serie.artist} a touché <strong>{fmtEur(stats.artistCash)}</strong> en cash sur ses {serie.artist_rate}%.
                  </div>
                ) : (
                  <div className="tc-info">
                    Reste {fmtEur(stats.artistAdvance - stats.artistAdvanceRecouped)} à recouper avant que {serie.artist} touche du cash.
                  </div>
                )}
              </div>
            )}

            {/* FABRICATION */}
            <div className="tracker-card">
              <div className="tc-head">
                <div className="tc-label">Recoupe fabrication</div>
                <div className="tc-pct" style={{ color: pctColor(stats.fabricationPct) }}>
                  {stats.fabricationPct.toFixed(1)}%
                </div>
              </div>
              <div className="tc-amounts">
                <span>{fmtEur(stats.fabricationRecouped)} récupérés via {100 - serie.artist_rate}% théoriques</span>
                <span className="muted">/ {fmtEur(stats.fabricationCost)} de fabrication</span>
              </div>
              <div className="tc-bar">
                <div className="tc-fill" style={{
                  width: `${stats.fabricationPct}%`,
                  background: stats.fabricationDone ? 'linear-gradient(90deg,#f97316,#6ee7b7)' : '#f97316'
                }} />
              </div>
              {stats.fabricationDone ? (
                <div className="tc-info" style={{ color: '#6ee7b7' }}>
                  ✓ Fabrication recoupée. Bénéfice label : <strong>{fmtEur(stats.labelProfit)}</strong>
                  {stats.hasCoprod && ` (Avlanche ${fmtEur(stats.labelNet)} · ${serie.coprod_name} ${fmtEur(stats.coprodNet)})`}
                </div>
              ) : (
                <div className="tc-info">
                  Reste {fmtEur(stats.fabricationCost - stats.fabricationRecouped)} à recouper.
                  {stats.projectionMonthsLeft != null && stats.hasEnoughData && stats.phase === 'recoupe' && ` ~${stats.projectionMonthsLeft} mois au rythme actuel.`}
                </div>
              )}
            </div>
          </>
        )}

        {/* SYNTHÈSE GLOBALE */}
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-l">Budget total</div>
            <div className="kpi-v">{fmtEur(totalBudget)}</div>
            <div className="kpi-s">{fmtEur(stats.fabricationCost)} fab + {fmtEur(stats.artistAdvance)} avance</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">Total généré (brut)</div>
            <div className="kpi-v" style={{ color: '#f59e0b' }}>{fmtEur(stats.grossRevenue)}</div>
            <div className="kpi-s">{fmtStreams(stats.totalQty)} streams</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">Phase actuelle</div>
            <div className="kpi-v" style={{ fontSize: 14, color: pctColor(globalPct) }}>{phaseLabel(stats.phase)}</div>
            <div className="kpi-s">{globalPct.toFixed(1)}% recoupé</div>
          </div>
        </div>

        {/* LISTE DES SINGLES */}
        {singles.length > 1 ? (
          <>
            <div className="section-label">{singles.length} titres dans le projet</div>
            {singles.map(single => {
              const ss = getSingleStats(single)
              return (
                <div key={single.id} className="single-item"
                  onClick={() => router.push(`/recoupe/single/${single.id}`)}>
                  <div className="si-left">
                    <div className="si-title">{single.title}</div>
                    <div className="si-meta">
                      {single.release_date && new Date(single.release_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                      {ss.totalQty > 0 && ` · ${fmtStreams(ss.totalQty)} streams`}
                    </div>
                  </div>
                  <div className="si-amounts">
                    <div className="si-gen" style={{ color: ss.totalEur > 0 ? '#f59e0b' : '#555' }}>{fmtEur(ss.totalEur)}</div>
                    <div className="si-sub">généré</div>
                  </div>
                  <div className="si-caret">›</div>
                </div>
              )
            })}
          </>
        ) : singles.length === 1 ? (
          <>
            <div className="section-label">Détail du titre</div>
            <div className="single-item" onClick={() => router.push(`/recoupe/single/${singles[0].id}`)}>
              <div className="si-left">
                <div className="si-title">{singles[0].title}</div>
                <div className="si-meta">
                  {singles[0].release_date && new Date(singles[0].release_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                  {' · '}{fmtStreams(stats.totalQty)} streams
                </div>
              </div>
              <div className="si-amounts">
                <div className="si-gen" style={{ color: '#f59e0b' }}>{fmtEur(stats.grossRevenue)}</div>
                <div className="si-sub">généré</div>
              </div>
              <div className="si-caret">›</div>
            </div>
          </>
        ) : null}
      </div>

      <style jsx>{`
        .breadcrumb{font-size:11px;color:#444;margin-bottom:20px;display:flex;align-items:center;gap:6px}
        .bc-link{color:#555;cursor:pointer}.bc-link:hover{color:#aaa}
        .bc-sep{color:#333}.bc-current{color:#888}
        .serie-hero{margin-bottom:18px}
        .sh-type{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;display:flex;align-items:center;gap:8px}
        .warner-badge{padding:1px 6px;border-radius:3px;background:#1a1000;color:#f59e0b;font-size:9px}
        .sh-title{font-size:22px;font-weight:700;margin-bottom:5px}
        .sh-meta{font-size:12px;color:#555;line-height:1.6}
        .export-btn{background:none;border:1px solid #1e1e1e;border-radius:6px;color:#555;font-size:12px;padding:6px 14px;cursor:pointer;font-family:inherit}
        .export-btn:hover{color:#aaa;border-color:#2a2a2a}
        .tracker-card{background:#141414;border:1px solid #1e1e1e;border-radius:10px;padding:18px 20px;margin-bottom:12px}
        .warner-card{border-color:#2a1f0a}
        .tc-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px}
        .tc-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1.5px;font-weight:700}
        .tc-pct{font-size:24px;font-weight:800;line-height:1}
        .tc-amounts{display:flex;justify-content:space-between;font-size:12px;color:#888;margin-bottom:10px}
        .tc-amounts .muted{color:#444}
        .tc-bar{height:6px;background:#1a1a1a;border-radius:3px;overflow:hidden;margin-bottom:8px}
        .tc-fill{height:100%;border-radius:3px;transition:width .4s}
        .tc-info{font-size:11px;color:#666;line-height:1.5}
        .kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}
        .kpi{background:#141414;border:1px solid #1e1e1e;border-radius:9px;padding:14px 16px}
        .kpi-l{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
        .kpi-v{font-size:18px;font-weight:700;line-height:1}
        .kpi-s{font-size:11px;color:#555;margin-top:5px}
        .section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#444;margin:20px 0 12px}
        .single-item{background:#141414;border:1px solid #1e1e1e;border-radius:10px;display:flex;align-items:center;gap:16px;padding:14px 18px;margin-bottom:6px;cursor:pointer;transition:all .2s}
        .single-item:hover{border-color:#2a2a2a;background:#181818}
        .si-left{flex:1;min-width:0}
        .si-title{font-size:14px;font-weight:700;color:#eee;margin-bottom:3px}
        .si-meta{font-size:11px;color:#555}
        .si-amounts{text-align:right;flex-shrink:0}
        .si-gen{font-size:14px;font-weight:700}
        .si-sub{font-size:10px;color:#444;margin-top:2px}
        .si-caret{color:#2a2a2a;font-size:18px;flex-shrink:0}
        @media(max-width:600px){.kpi-row{grid-template-columns:1fr}}
      `}</style>
    </div>
  )
}
