import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { COLORS, fmt, fmtStreams } from '../../lib/artists'
import MainNav from '../../components/MainNav'

export default function SerieDetail() {
  const router = useRouter()
  const { serieId } = router.query
  const [serie, setSerie] = useState(null)
  const [royalties, setRoyalties] = useState([])
  const [rate, setRate] = useState(0.92)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
    supabase.from('settings').select('value').eq('key', 'eur_rate').single()
      .then(({ data }) => { if (data) setRate(parseFloat(data.value)) })
  }, [])

  useEffect(() => {
    if (!serieId) return
    fetchData()
  }, [serieId])

  async function fetchData() {
    setLoading(true)
    const { data: s } = await supabase.from('series').select('*, singles(*, budget_lines(*))').eq('id', serieId).single()

    // Paginate royalties
    let allRoy = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties').select('title, artist, usd, qty, month')
        .range(from, from + 999)
      if (error || !data || data.length === 0) break
      allRoy = allRoy.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setSerie(s)
    setRoyalties(allRoy)
    setLoading(false)
  }

  function getSingleStats(single) {
    const rows = royalties.filter(r =>
      r.artist === single.artist &&
      r.title.toLowerCase().includes(single.title.toLowerCase().substring(0, 10))
    )
    const totalUsd = rows.reduce((s, r) => s + r.usd, 0)
    const totalQty = rows.reduce((s, r) => s + r.qty, 0)
    const budgetUsd = (single.budget_eur || 0) / rate
    const pct = budgetUsd > 0 ? Math.min((totalUsd / budgetUsd) * 100, 100) : 0
    const remaining = Math.max(budgetUsd - totalUsd, 0)
    const byMonth = {}
    rows.forEach(r => { byMonth[r.month] = (byMonth[r.month] || 0) + r.usd })
    const months = Object.keys(byMonth).sort()
    const last3 = months.slice(-3)
    const avg = last3.length > 0 ? last3.reduce((s, m) => s + byMonth[m], 0) / last3.length : 0
    const monthsLeft = avg > 0 && remaining > 0 ? Math.ceil(remaining / avg) : null
    return { totalUsd, totalQty, budgetUsd, pct, remaining, monthsLeft, months }
  }

  if (loading || !serie) return (
    <div className="app">
      <MainNav showBack onBack={() => router.push('/recoupe')} />
      <div className="loading-screen"><div className="loading-spinner" style={{ borderTopColor: '#f59e0b' }} /></div>
    </div>
  )

  const singles = serie.singles || []
  const totalBudgetEur = singles.reduce((s, x) => s + (x.budget_eur || 0), 0)
  const totalUsd = singles.reduce((s, x) => s + getSingleStats(x).totalUsd, 0)
  const totalQty = singles.reduce((s, x) => s + getSingleStats(x).totalQty, 0)
  const totalBudgetUsd = totalBudgetEur / rate
  const globalPct = totalBudgetUsd > 0 ? Math.min((totalUsd / totalBudgetUsd) * 100, 100) : 0
  const globalRemaining = Math.max(totalBudgetUsd - totalUsd, 0)

  return (
    <div className="app">
      <MainNav
        title={serie.name}
        showBack
        onBack={() => router.push('/recoupe')}
      />

      <div className="page">
        {/* BREADCRUMB */}
        <div className="breadcrumb">
          <span className="bc-link" onClick={() => router.push('/recoupe')}>Recoupe</span>
          <span className="bc-sep">›</span>
          <span className="bc-link" onClick={() => router.push('/recoupe')}>
            {serie.artist}
          </span>
          <span className="bc-sep">›</span>
          <span className="bc-current">{serie.name}</span>
        </div>

        {/* HERO */}
        <div className="serie-hero">
          <div className="sh-type">{singles.length === 1 ? 'Single' : 'Série de singles'} · {serie.artist}</div>
          <div className="sh-title">{serie.name}</div>
          <div className="sh-meta">
            {serie.coprod_name && `co-prod ${serie.coprod_name} · `}
            {serie.artist} {serie.artist_rate}% · Avlanche {serie.label_rate}% + {serie.mgmt_rate}% gestion
            {serie.coprod_name && ` · ${serie.coprod_name} ${serie.coprod_rate}% après recoupe`}
          </div>
        </div>

        {/* KPIs */}
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-l">Budget total investi</div>
            <div className="kpi-v">€{Math.round(totalBudgetEur).toLocaleString('fr-FR')}</div>
            <div className="kpi-s">≈ ${Math.round(totalBudgetUsd).toLocaleString('fr-FR')} · par Avlanche</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">Généré · Recoupe globale</div>
            <div className="kpi-v">
              <span className="pos">{fmt(totalUsd)}</span>
              {' '}
              <span style={{ fontSize: 15, color: globalPct >= 90 ? '#6ee7b7' : '#f59e0b' }}>
                {globalPct.toFixed(1)}%
              </span>
            </div>
            <div className="kpi-s">{fmt(globalRemaining)} restants · {fmtStreams(totalQty)} streams</div>
          </div>
          <div className="kpi">
            <div className="kpi-l">{serie.coprod_name || 'Co-prod'} a perçu</div>
            <div className="kpi-v muted">$0</div>
            <div className="kpi-s">Après recoupe complète de chaque single</div>
          </div>
        </div>

        {/* SINGLES LIST */}
        <div className="section-label">{singles.length} single{singles.length > 1 ? 's' : ''} — cliquez pour le détail</div>

        {singles.map(single => {
          const s = getSingleStats(single)
          const pctColor = s.pct >= 90 ? '#6ee7b7' : s.pct >= 50 ? '#f59e0b' : '#f87171'
          return (
            <div
              key={single.id}
              className="single-item"
              onClick={() => router.push(`/recoupe/single/${single.id}`)}
            >
              <div className="si-left">
                <div className="si-title">{single.title}</div>
                <div className="si-meta">
                  {single.release_date && new Date(single.release_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                  {s.totalQty > 0 && ` · ${fmtStreams(s.totalQty)} streams`}
                  {single.budget_eur > 0 && ` · budget €${Math.round(single.budget_eur).toLocaleString('fr-FR')}`}
                </div>
              </div>
              <div className="si-progress">
                <div className="si-bar-bg">
                  <div className="si-bar-fill" style={{
                    width: `${s.pct}%`,
                    background: s.pct >= 90 ? 'linear-gradient(90deg,#f97316,#6ee7b7)' : '#f97316'
                  }} />
                </div>
                <div className="si-bar-label" style={{ color: pctColor }}>
                  {s.pct.toFixed(1)}%
                  {s.monthsLeft === 0 ? ' · recoupé !' : s.monthsLeft ? ` · ~${s.monthsLeft} mois` : s.months.length < 3 ? ' · titre récent' : ''}
                </div>
              </div>
              <div className="si-amounts">
                <div className="si-gen" style={{ color: s.totalUsd > 0 ? '#6ee7b7' : '#555' }}>{fmt(s.totalUsd)}</div>
                <div className="si-budget">/ €{Math.round(single.budget_eur).toLocaleString('fr-FR')}</div>
              </div>
              <div className="si-caret">›</div>
            </div>
          )
        })}
      </div>

      <style jsx>{`
        .breadcrumb { font-size:11px; color:#444; margin-bottom:20px; display:flex; align-items:center; gap:6px; }
        .bc-link { color:#555; cursor:pointer; transition:color .2s; }
        .bc-link:hover { color:#aaa; }
        .bc-sep { color:#333; }
        .bc-current { color:#888; }
        .serie-hero { margin-bottom:22px; }
        .sh-type { font-size:10px; color:#555; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:6px; }
        .sh-title { font-size:22px; font-weight:700; margin-bottom:5px; }
        .sh-meta { font-size:12px; color:#555; line-height:1.6; }
        .kpi-row { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:24px; }
        .kpi { background:#141414; border:1px solid #1e1e1e; border-radius:9px; padding:16px 18px; }
        .kpi-l { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:6px; }
        .kpi-v { font-size:20px; font-weight:700; line-height:1; }
        .kpi-s { font-size:11px; color:#555; margin-top:5px; }
        .pos { color:#6ee7b7 !important; }
        .muted { color:#444 !important; }
        .section-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:#444; margin-bottom:12px; }
        .single-item {
          background:#141414; border:1px solid #1e1e1e; border-radius:10px;
          display:flex; align-items:center; gap:16px; padding:16px 20px;
          margin-bottom:8px; cursor:pointer; transition:border-color .2s,background .2s;
        }
        .single-item:hover { border-color:#2a2a2a; background:#181818; }
        .si-left { flex:1; min-width:0; }
        .si-title { font-size:15px; font-weight:700; color:#eee; margin-bottom:3px; }
        .si-meta { font-size:11px; color:#555; }
        .si-progress { width:190px; flex-shrink:0; }
        .si-bar-bg { height:4px; background:#1e1e1e; border-radius:2px; overflow:hidden; margin-bottom:5px; }
        .si-bar-fill { height:100%; border-radius:2px; }
        .si-bar-label { font-size:11px; }
        .si-amounts { text-align:right; width:100px; flex-shrink:0; }
        .si-gen { font-size:15px; font-weight:700; margin-bottom:2px; }
        .si-budget { font-size:10px; color:#555; }
        .si-caret { color:#2a2a2a; font-size:18px; flex-shrink:0; }
      `}</style>
    </div>
  )
}
