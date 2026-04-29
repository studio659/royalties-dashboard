import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../../lib/supabase'
import { COLORS, fmt, fmtStreams } from '../../../lib/artists'
import MainNav from '../../../components/MainNav'

export default function SingleDetail() {
  const router = useRouter()
  const { singleId } = router.query
  const [single, setSingle] = useState(null)
  const [serie, setSerie] = useState(null)
  const [royaltyRows, setRoyaltyRows] = useState([])
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

    // Fetch all royalties for this artist then filter by title
    let allRoy = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties')
        .select('month, usd, qty, store, title')
        .eq('artist', s.artist)
        .range(from, from + 999)
      if (error || !data || data.length === 0) break
      allRoy = allRoy.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    // Filter by title similarity
    const filtered = allRoy.filter(r => r.title.toLowerCase() === s.title.toLowerCase())
    filtered.sort((a,b) => a.month.localeCompare(b.month))
    setRoyaltyRows(filtered)
    setLoading(false)
  }

  if (loading || !single) return (
    <div className="app">
      <MainNav showBack onBack={() => router.back()} />
      <div className="loading-screen"><div className="loading-spinner" style={{ borderTopColor: '#f59e0b' }} /></div>
    </div>
  )

  const budgetLines = single.budget_lines || []
  const totalUsd = royaltyRows.reduce((s, r) => s + r.usd, 0)
  const totalQty = royaltyRows.reduce((s, r) => s + r.qty, 0)
  const budgetUsd = (single.budget_eur || 0) / rate
  const pct = budgetUsd > 0 ? Math.min((totalUsd / budgetUsd) * 100, 100) : 0
  const remaining = Math.max(budgetUsd - totalUsd, 0)
  const pctColor = pct >= 90 ? '#6ee7b7' : pct >= 50 ? '#f59e0b' : '#f87171'

  // Contract (use single override or inherit from serie)
  const artistRate = single.artist_rate ?? serie?.artist_rate ?? 12
  const coprodRate = single.coprod_rate ?? serie?.coprod_rate ?? 40
  const labelRate  = single.label_rate  ?? serie?.label_rate  ?? 60
  const mgmtRate   = single.mgmt_rate   ?? serie?.mgmt_rate   ?? 5
  const coprodName = single.coprod_name ?? serie?.coprod_name ?? ''

  // Distribution calculation (recoupe phase)
  const artistShare = totalUsd * (artistRate / 100)
  const mgmtShare   = totalUsd * (mgmtRate / 100)
  const afterArtistAndMgmt = totalUsd - artistShare - mgmtShare
  const labelShare  = afterArtistAndMgmt  // all to label during recoup
  const coprodShare = 0                   // nothing to coprod during recoup

  // Post-recoupe rates
  const afterArtistMgmtPct = (100 - artistRate - mgmtRate)
  const labelBenefPct  = afterArtistMgmtPct * (labelRate / 100)
  const coprodBenefPct = afterArtistMgmtPct * (coprodRate / 100)

  // Monthly breakdown
  const byMonth = {}
  royaltyRows.forEach(r => { byMonth[r.month] = (byMonth[r.month] || 0) + r.usd })
  const months = Object.keys(byMonth).sort()
  const last3 = months.slice(-3)
  const avg = last3.length > 0 ? last3.reduce((s, m) => s + byMonth[m], 0) / last3.length : 0
  const hasEnoughData = months.length >= 3
  const monthsLeft = hasEnoughData && avg > 0 && remaining > 0 ? Math.ceil(remaining / avg) : null

  // By platform
  const byPlat = {}
  royaltyRows.forEach(r => { byPlat[r.store] = (byPlat[r.store] || 0) + r.usd })
  const topPlats = Object.entries(byPlat).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const maxMonthly = Math.max(...Object.values(byMonth), 1)

  function exportCSV() {
    const rows = [['Mois','Revenus $','Streams','% du budget recoupé']]
    months.forEach(m => {
      rows.push([m, (byMonth[m]||0).toFixed(2), byMonth[m] ? '—' : 0, ((byMonth[m]||0)/budgetUsd*100).toFixed(1)])
    })
    // Also add budget lines
    rows.push(['','','',''])
    rows.push(['BUDGET LIGNES','€','',''])
    budgetLines.forEach(l => rows.push([l.label, l.amount_eur, '', '']))
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `recoupe_${single.title.replace(/[^a-z0-9]/gi,'_')}.csv`
    a.click()
  }

  return (
    <div className="app">
      <MainNav
        title={single.title}
        showBack
        onBack={() => router.push(`/recoupe/${serie?.id}`)}
      />

      <div className="page">
        {/* BREADCRUMB */}
        <div className="breadcrumb">
          <span className="bc-link" onClick={() => router.push('/recoupe')}>Recoupe</span>
          <span className="bc-sep">›</span>
          <span className="bc-link" onClick={() => router.push(`/recoupe/${serie?.id}`)}>
            {serie?.name}
          </span>
          <span className="bc-sep">›</span>
          <span className="bc-current">{single.title}</span>
        </div>

        {/* HERO */}
        <div className="single-hero">
          <div className="sh-type">Single · {single.artist}</div>
          <div className="sh-title">{single.title}</div>
          <div className="sh-meta">
            {single.release_date && new Date(single.release_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
            {totalQty > 0 && ` · ${fmtStreams(totalQty)} streams`}
            {coprodName && ` · co-prod ${coprodName}`}
          </div>
        </div>

        {/* TRACKER */}
        <div className="tracker-card">
          <div className="tc-top">
            <div>
              <div className="tc-label">Recoupe</div>
              <div className="tc-pct" style={{ color: pctColor }}>{pct.toFixed(1)}%</div>
            </div>
            <div className="tc-right">
              <div className="tc-gen">{fmt(totalUsd)} générés</div>
              <div className="tc-bud">
                sur €{Math.round(single.budget_eur || 0).toLocaleString('fr-FR')} investis (≈ {fmt(budgetUsd)})
              </div>
              <div className="tc-reste" style={{ color: remaining > 0 ? '#f59e0b' : '#6ee7b7' }}>
                {remaining > 0
                  ? `⚡ Il reste ${fmt(remaining)}${monthsLeft ? ` · ~${monthsLeft} mois` : !hasEnoughData ? ' · données insuffisantes (<3 mois)' : ''}`
                  : '✓ Recoupé !'}
              </div>
            </div>
          </div>
          <div className="tc-bar">
            <div className="tc-fill" style={{
              width: `${pct}%`,
              background: pct >= 90 ? 'linear-gradient(90deg,#f97316,#6ee7b7)' : '#f97316'
            }} />
          </div>
          <div className="tc-foot">
            <span>$0</span>
            <span style={{ color: pctColor }}>● {pct.toFixed(1)}%</span>
            <span>{fmt(budgetUsd)} → {coprodName || 'co-prod'} entre en jeu</span>
          </div>
        </div>

        <div className="two-col">
          {/* BUDGET */}
          <div className="inner-card">
            <div className="ic-title">Budget · €{Math.round(single.budget_eur || 0).toLocaleString('fr-FR')}</div>
            {budgetLines.length === 0 ? (
              <div style={{ color: '#444', fontSize: 12, padding: '12px 0' }}>Aucune ligne de budget</div>
            ) : (
              budgetLines.map(line => (
                <div key={line.id} className="bl-row">
                  <span className="bl-name">{line.label}</span>
                  <span className="bl-amount">€{Math.round(line.amount_eur).toLocaleString('fr-FR')}</span>
                  <span className={`bl-status ${line.status === 'paid' ? 's-paid' : 's-pending'}`}>
                    {line.status === 'paid' ? 'payé' : 'en attente'}
                  </span>
                </div>
              ))
            )}
            <div className="bl-total">
              <span>Total</span>
              <span>€{Math.round(single.budget_eur || 0).toLocaleString('fr-FR')}</span>
            </div>
          </div>

          <div>
            {/* RÉPARTITION PHASE RECOUPE */}
            <div className="inner-card" style={{ marginBottom: 12 }}>
              <div className="ic-title">
                Ce que chacun a perçu
                <span className="ic-badge badge-recoupe">Phase recoupe · en cours</span>
              </div>
              <PartRow name={`${single.artist} (${artistRate}%)`} color={COLORS[single.artist] || '#a78bfa'}
                pct={artistRate} val={fmt(artistShare)} valColor="#6ee7b7" />
              <PartRow name={`Avlanche gestion (${mgmtRate}%)`} color="#6366f1"
                pct={mgmtRate} val={fmt(mgmtShare)} valColor="#6ee7b7" />
              <PartRow name={`Avlanche recoupe (${100 - artistRate - mgmtRate}%)`} color="#f97316"
                pct={100 - artistRate - mgmtRate} val={fmt(labelShare)} valColor="#6ee7b7"
                barLabel={`${fmt(labelShare)} → remboursement`} />
              {coprodName && (
                <PartRow name={coprodName} color="#2a2a2a"
                  pct={0} val="$0" valColor="#444" barLabel="En attente de recoupe" isEmpty />
              )}
            </div>

            {/* RÉPARTITION PHASE BÉNÉFICE */}
            <div className="inner-card">
              <div className="ic-title">
                Après recoupe
                <span className="ic-badge badge-benef">Phase bénéfice</span>
              </div>
              <PartRow name={`${single.artist} (${artistRate}%)`} color={COLORS[single.artist] || '#a78bfa'}
                pct={artistRate} val={`${artistRate}%`} valColor="#666" />
              <PartRow name={`Avlanche gestion (${mgmtRate}%)`} color="#6366f1"
                pct={mgmtRate} val={`${mgmtRate}%`} valColor="#666" />
              <PartRow name={`Avlanche label (${labelBenefPct.toFixed(1)}%)`} color="#f97316"
                pct={labelBenefPct} val={`${labelBenefPct.toFixed(1)}%`} valColor="#666" />
              {coprodName && (
                <PartRow name={`${coprodName} (${coprodBenefPct.toFixed(1)}%)`} color="#eab308"
                  pct={coprodBenefPct} val={`${coprodBenefPct.toFixed(1)}%`} valColor="#eab308" />
              )}
            </div>
          </div>
        </div>

        {/* ÉVOLUTION MENSUELLE */}
        {months.length > 0 && (
          <div className="inner-card" style={{ marginBottom: 12 }}>
            <div className="ic-title">Évolution mensuelle</div>
            {months.map(m => {
              const v = byMonth[m]
              const w = (v / maxMonthly * 100).toFixed(1)
              return (
                <div key={m} className="sim-row">
                  <div className="sim-month">{m}</div>
                  <div className="sim-bar-bg">
                    <div className="sim-bar" style={{ width: `${w}%`, background: '#f97316' }}>{fmt(v)}</div>
                  </div>
                  <div className="sim-pct">{((v / budgetUsd) * 100).toFixed(1)}%</div>
                </div>
              )
            })}
            {remaining > 0 && avg > 0 && (
              <div className="sim-row sim-est">
                <div className="sim-month" style={{ color: '#f59e0b' }}>prochain</div>
                <div className="sim-bar-bg">
                  <div className="sim-bar" style={{ width: `${Math.min(avg / maxMonthly * 100, 100).toFixed(1)}%`, background: '#f59e0b55', border: '1px dashed #f59e0b66' }}>≈ {fmt(avg)}</div>
                </div>
                <div className="sim-pct" style={{ color: '#f59e0b' }}>estimé</div>
              </div>
            )}
          </div>
        )}

        {/* PLATEFORMES */}
        {topPlats.length > 0 && (
          <div className="inner-card">
            <div className="ic-title">Top plateformes</div>
            {topPlats.map(([plat, val]) => (
              <div key={plat} className="sim-row">
                <div className="sim-month" style={{ width: 120 }}>{plat.length > 14 ? plat.slice(0,12)+'…' : plat}</div>
                <div className="sim-bar-bg">
                  <div className="sim-bar" style={{ width: `${(val / topPlats[0][1] * 100).toFixed(1)}%`, background: '#f97316' }}>{fmt(val)}</div>
                </div>
                <div className="sim-pct">{((val / totalUsd) * 100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .breadcrumb { font-size:11px; color:#444; margin-bottom:20px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .bc-link { color:#555; cursor:pointer; } .bc-link:hover { color:#aaa; }
        .bc-sep { color:#333; } .bc-current { color:#888; }
        .single-hero { margin-bottom:22px; }
        .sh-type { font-size:10px; color:#555; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:6px; }
        .sh-title { font-size:22px; font-weight:700; margin-bottom:4px; }
        .sh-meta { font-size:12px; color:#555; }
        .tracker-card { background:#141414; border:1px solid #1e1e1e; border-radius:10px; padding:22px; margin-bottom:16px; }
        .tc-label { font-size:11px; color:#555; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }
        .tc-top { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:14px; }
        .tc-pct { font-size:48px; font-weight:800; line-height:1; }
        .tc-right { text-align:right; }
        .tc-gen { font-size:18px; font-weight:700; color:#eee; margin-bottom:3px; }
        .tc-bud { font-size:12px; color:#555; margin-bottom:3px; }
        .tc-reste { font-size:12px; font-weight:600; }
        .tc-bar { height:8px; background:#1e1e1e; border-radius:4px; overflow:hidden; margin-bottom:8px; }
        .tc-fill { height:100%; border-radius:4px; }
        .tc-foot { display:flex; justify-content:space-between; font-size:10px; color:#333; }
        .two-col { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:12px; }
        .inner-card { background:#141414; border:1px solid #1e1e1e; border-radius:9px; padding:16px; }
        .ic-title { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:14px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .ic-badge { font-size:9px; padding:2px 7px; border-radius:10px; }
        .badge-recoupe { background:#1a1000; color:#f59e0b; }
        .badge-benef { background:#0a1a0a; color:#6ee7b7; }
        .bl-row { display:flex; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid #191919; font-size:12px; }
        .bl-row:last-of-type { border-bottom:none; }
        .bl-name { flex:1; color:#bbb; }
        .bl-amount { font-weight:600; color:#eee; flex-shrink:0; }
        .bl-status { font-size:9px; padding:2px 7px; border-radius:3px; flex-shrink:0; }
        .s-paid { background:#0a1a0a; color:#6ee7b7; }
        .s-pending { background:#1a1000; color:#f59e0b; }
        .bl-total { display:flex; justify-content:space-between; padding-top:10px; margin-top:6px; border-top:1px solid #222; font-size:13px; font-weight:700; }
        .sim-row { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
        .sim-month { width:60px; font-size:11px; color:#666; flex-shrink:0; }
        .sim-bar-bg { flex:1; height:18px; background:#1a1a1a; border-radius:3px; overflow:hidden; }
        .sim-bar { height:100%; border-radius:3px; display:flex; align-items:center; padding:0 7px; font-size:10px; font-weight:700; color:#fff; white-space:nowrap; }
        .sim-pct { width:38px; text-align:right; font-size:10px; color:#555; flex-shrink:0; }
        .sim-est { background:#1a1400; border:1px solid #f59e0b22; border-radius:5px; padding:4px 6px; }
        @media(max-width:600px) { .two-col { grid-template-columns:1fr; } }
      `}</style>
    </div>
  )
}

function PartRow({ name, color, pct, val, valColor, barLabel, isEmpty }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
      <div style={{ width:140, fontSize:12, color, flexShrink:0, lineHeight:1.3 }}>{name}</div>
      <div style={{ flex:1, height:20, background:'#1a1a1a', borderRadius:4, overflow:'hidden' }}>
        {isEmpty ? (
          <div style={{ height:'100%', display:'flex', alignItems:'center', padding:'0 8px', fontSize:11, color:'#2a2a2a' }}>
            En attente de recoupe
          </div>
        ) : (
          <div style={{ width:`${Math.max(pct,0)}%`, height:'100%', background:color, display:'flex', alignItems:'center', padding:'0 8px', fontSize:11, fontWeight:700, color:'#fff', whiteSpace:'nowrap', minWidth:4 }}>
            {barLabel || `${pct}%`}
          </div>
        )}
      </div>
      <div style={{ width:50, textAlign:'right', fontSize:12, fontWeight:600, color:valColor, flexShrink:0 }}>{val}</div>
    </div>
  )
}
