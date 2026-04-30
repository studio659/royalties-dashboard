import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/router'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useRate } from '../lib/rateContext'
import { ARTISTS, COLORS, PLAT_COLORS, fmtEur, fmtStreams, deltaStr } from '../lib/artists'
import MainNav from '../components/MainNav'

function toEurRow(r, rate) {
  return Number(r.amount_eur || 0) + Number(r.amount_usd || 0) * rate
}

function KPI({ label, value, sub, subClass }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-val">{value}</div>
      {sub && <div className={`kpi-sub ${subClass||''}`}>{sub}</div>}
    </div>
  )
}

function HBar({ name, value, maxValue, color, right, formatVal }) {
  const w = maxValue > 0 ? Math.min((Math.abs(value)/maxValue*100),100).toFixed(1) : 0
  const display = formatVal ? formatVal(value) : fmtEur(value)
  return (
    <div className="hbar-row">
      <div className="hbar-name">{typeof name==='string'&&name.length>24?name.slice(0,22)+'…':name}</div>
      <div className="hbar-wrap">
        <div className="hbar-fill" style={{width:`${w}%`,background:color}}>{display}</div>
      </div>
      {right&&<div className="hbar-right">{right}</div>}
    </div>
  )
}

const TABS = ['Revenus','Streams','Artistes','Titres','Plateformes']

export default function LabelPage() {
  const router = useRouter()
  const { rate: eurRate } = useRate()

  // Vue agrégée — petite, chargée immédiatement
  const [viewRows, setViewRows] = useState([])
  // Données brutes — chargées lazily pour Titres/Plateformes
  const [detailRows, setDetailRows] = useState([])
  const [detailYear, setDetailYear] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [allArtists, setAllArtists] = useState(ARTISTS)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Revenus')
  const [yearFilter, setYearFilter] = useState('Tout')

  useEffect(() => {
    supabase.auth.getSession().then(({data}) => { if (!data.session) router.replace('/login') })
    fetchViewData()
  }, [])

  // Charge la vue agrégée (très rapide — quelques centaines de lignes)
  async function fetchViewData() {
    setLoading(true)
    const [{ data: artistsData }, { data: viewData }] = await Promise.all([
      supabase.from('artists').select('name, color').order('created_at'),
      supabase.from('royalties_monthly').select('artist, month, amount_eur, amount_usd, qty').order('month', { ascending: true })
    ])
    if (artistsData?.length) setAllArtists(artistsData.map(a => a.name))
    setViewRows(viewData || [])
    setLoading(false)
  }

  // Charge les données brutes pour Titres/Plateformes (lazy, par année)
  const fetchDetailData = useCallback(async (year) => {
    if (detailYear === year && detailRows.length > 0) return // déjà chargé
    setDetailLoading(true)
    let all = [], from = 0
    let query = supabase.from('royalties').select('month, artist, title, store, amount, currency, qty')
    if (year !== 'Tout') query = query.like('month', `${year}-%`)
    while (true) {
      const { data, error } = await query.range(from, from + 999)
      if (error || !data?.length) break
      all = all.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setDetailRows(all)
    setDetailYear(year)
    setDetailLoading(false)
  }, [detailYear, detailRows.length])

  // Quand l'onglet ou le filtre change, charge les détails si nécessaire
  useEffect(() => {
    if (tab === 'Titres' || tab === 'Plateformes') {
      fetchDetailData(yearFilter)
    }
  }, [tab, yearFilter])

  // ── Calculs sur la vue (KPIs, Revenus, Streams, Artistes) ──
  const months  = useMemo(() => [...new Set(viewRows.map(r => r.month))].sort(), [viewRows])
  const years   = useMemo(() => [...new Set(months.map(m => m.slice(0,4)))].sort().reverse(), [months])
  const lastM   = months[months.length-1]
  const prevM   = months[months.length-2]

  const filteredView = useMemo(() =>
    yearFilter === 'Tout' ? viewRows : viewRows.filter(r => r.month.startsWith(yearFilter))
  , [viewRows, yearFilter])

  const eur = r => toEurRow(r, eurRate)

  const totalEur = useMemo(() => viewRows.reduce((s,r) => s + eur(r), 0), [viewRows, eurRate])
  const totalQty = useMemo(() => viewRows.reduce((s,r) => s + Number(r.qty||0), 0), [viewRows])
  const lastEur  = useMemo(() => viewRows.filter(r=>r.month===lastM).reduce((s,r) => s + eur(r), 0), [viewRows, lastM, eurRate])
  const prevEur  = useMemo(() => viewRows.filter(r=>r.month===prevM).reduce((s,r) => s + eur(r), 0), [viewRows, prevM, eurRate])
  const lastQty  = useMemo(() => viewRows.filter(r=>r.month===lastM).reduce((s,r) => s + Number(r.qty||0), 0), [viewRows, lastM])
  const prevQty  = useMemo(() => viewRows.filter(r=>r.month===prevM).reduce((s,r) => s + Number(r.qty||0), 0), [viewRows, prevM])
  const dEur = deltaStr(lastEur, prevEur)
  const dQty = deltaStr(lastQty, prevQty)

  const monthlyData = useMemo(() => {
    const ms = [...new Set(filteredView.map(r => r.month))].sort()
    return ms.map(m => {
      const obj = { month: m.slice(2) }
      allArtists.forEach(a => {
        obj[a] = Math.round(filteredView.filter(r => r.month===m && r.artist===a).reduce((s,r) => s + eur(r), 0))
      })
      obj['Total'] = Math.round(filteredView.filter(r => r.month===m).reduce((s,r) => s + eur(r), 0))
      return obj
    })
  }, [filteredView, allArtists, eurRate])

  const monthlyQtyData = useMemo(() => {
    const ms = [...new Set(filteredView.map(r => r.month))].sort()
    return ms.map(m => {
      const obj = { month: m.slice(2) }
      allArtists.forEach(a => {
        obj[a] = filteredView.filter(r => r.month===m && r.artist===a).reduce((s,r) => s + Number(r.qty||0), 0)
      })
      return obj
    })
  }, [filteredView, allArtists])

  const byArtist = useMemo(() => allArtists.map(a => ({
    artist: a,
    eur: filteredView.filter(r => r.artist===a).reduce((s,r) => s + eur(r), 0),
    qty: filteredView.filter(r => r.artist===a).reduce((s,r) => s + Number(r.qty||0), 0),
  })).sort((a,b) => b.eur - a.eur), [filteredView, allArtists, eurRate])

  const yearlyData = useMemo(() => years.map(y => {
    const yr = viewRows.filter(r => r.month.startsWith(y))
    return { year: y, eur: yr.reduce((s,r) => s + eur(r), 0), qty: yr.reduce((s,r) => s + Number(r.qty||0), 0) }
  }), [viewRows, years, eurRate])

  // ── Calculs sur les données brutes (Titres, Plateformes) ──
  const detailFiltered = useMemo(() =>
    yearFilter === 'Tout' ? detailRows : detailRows.filter(r => r.month.startsWith(yearFilter))
  , [detailRows, yearFilter])

  const detailEur = r => r.currency === 'EUR' ? Number(r.amount||0) : Number(r.amount||0) * eurRate

  const byTitle = useMemo(() => {
    const m = {}, ma = {}
    detailFiltered.forEach(r => {
      if (!m[r.title]) { m[r.title] = { eur: 0, qty: 0 }; ma[r.title] = r.artist }
      m[r.title].eur += detailEur(r); m[r.title].qty += Number(r.qty||0)
    })
    return Object.entries(m).sort((a,b) => b[1].eur - a[1].eur)
      .map(([t,v]) => ({ title: t, ...v, artist: ma[t] }))
  }, [detailFiltered, eurRate])

  const byPlat = useMemo(() => {
    const m = {}
    detailFiltered.forEach(r => {
      if (!m[r.store]) m[r.store] = { eur: 0, qty: 0 }
      m[r.store].eur += detailEur(r); m[r.store].qty += Number(r.qty||0)
    })
    return Object.entries(m).sort((a,b) => b[1].eur - a[1].eur)
  }, [detailFiltered, eurRate])

  const maxArtistEur = Math.max(...byArtist.map(a => a.eur), 1)
  const maxPlatEur   = Math.max(...byPlat.map(([,v]) => Math.abs(v.eur)), 1)
  const platPie = byPlat.slice(0,8).map(([name,v],i) => ({ name, value: Math.round(v.eur), color: PLAT_COLORS[i] }))

  if (loading) return (
    <div className="loading-screen"><div className="loading-spinner"/><span>Chargement…</span></div>
  )

  return (
    <div className="app">
      <MainNav title="Avlanche Music" showBack onBack={() => router.push('/')}/>
      <div className="page">

        <div className="kpi-grid">
          <KPI label="Total royalties" value={fmtEur(totalEur)} sub={`${months.length} mois`}/>
          <KPI label="Total streams" value={fmtStreams(totalQty)} sub={`${months.length} mois`}/>
          <KPI label={`Royalties ${lastM||'—'}`} value={fmtEur(lastEur)} sub={dEur?.str} subClass={dEur?.positive?'pos':'neg'}/>
          <KPI label={`Streams ${lastM||'—'}`} value={fmtStreams(lastQty)} sub={dQty?.str} subClass={dQty?.positive?'pos':'neg'}/>
        </div>

        <div className="pills">
          {['Tout',...years].map(y => (
            <button key={y} className={`pill ${yearFilter===y?'active':''}`} onClick={() => setYearFilter(y)}>{y}</button>
          ))}
        </div>

        <div className="tabs">
          {TABS.map(t => (
            <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}
              style={tab===t?{borderBottomColor:'#f97316',color:'#eee'}:{}}>{t}</button>
          ))}
        </div>

        {tab==='Revenus' && (
          <div>
            <div className="chart-label">Revenus mensuels par artiste (EUR)</div>
            <div style={{height:260}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>'€'+Math.round(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}}
                    formatter={(v,n) => [fmtEur(v),n]} labelStyle={{color:'#888'}}/>
                  <Legend wrapperStyle={{fontSize:11,color:'#666'}}/>
                  {allArtists.map(a => (
                    <Line key={a} type="monotone" dataKey={a} stroke={COLORS[a]||'#888'} strokeWidth={2}
                      dot={{r:2}} activeDot={{r:4}} connectNulls/>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {yearlyData.map(({year,eur:e,qty}) => (
                <div key={year} className="year-row">
                  <span className="year-label">{year}</span>
                  <span className="year-usd">{fmtEur(e)}</span>
                  <span className="year-qty">{fmtStreams(qty)} streams</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='Streams' && (
          <div>
            <div className="chart-label">Streams mensuels par artiste</div>
            <div style={{height:260}}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyQtyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtStreams(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}}
                    formatter={(v,n) => [fmtStreams(v),n]} labelStyle={{color:'#888'}}/>
                  <Legend wrapperStyle={{fontSize:11,color:'#666'}}/>
                  {allArtists.map(a => <Bar key={a} dataKey={a} stackId="a" fill={COLORS[a]||'#888'}/>)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {yearlyData.map(({year,eur:e,qty}) => (
                <div key={year} className="year-row">
                  <span className="year-label">{year}</span>
                  <span className="year-usd">{fmtStreams(qty)} streams</span>
                  <span className="year-qty">{fmtEur(e)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='Artistes' && (
          <div>
            <div className="plat-table-header">
              <span className="pt-name">Artiste</span>
              <span className="pt-bar"/>
              <span className="pt-streams">Streams</span>
              <span className="pt-rev">Revenus</span>
            </div>
            {byArtist.map(({artist,eur:e,qty}) => {
              const w = maxArtistEur > 0 ? Math.min(e/maxArtistEur*100,100) : 0
              const c = COLORS[artist]||'#888'
              return (
                <div key={artist} className="plat-row" style={{cursor:'pointer'}}
                  onClick={() => router.push(`/artist/${encodeURIComponent(artist)}`)}>
                  <span className="pt-name" style={{color:'#eee',fontWeight:600}}>{artist}</span>
                  <div className="pt-bar">
                    <div style={{width:`${w}%`,height:'100%',background:c,borderRadius:2,minWidth:3}}/>
                  </div>
                  <span className="pt-streams">{fmtStreams(qty)}</span>
                  <span className="pt-rev" style={{color:c}}>{fmtEur(e)}</span>
                </div>
              )
            })}
          </div>
        )}

        {tab==='Titres' && (
          <div>
            {detailLoading ? (
              <div style={{textAlign:'center',padding:'40px 0',color:'#444'}}>
                <div className="loading-spinner" style={{margin:'0 auto 12px'}}/>
                Chargement des titres…
              </div>
            ) : (
              <>
                {/* Top 5 par artiste */}
                {allArtists.map(artist => {
                  const artistTitles = byTitle.filter(t => t.artist === artist).slice(0, 5)
                  if (!artistTitles.length) return null
                  const maxEur = artistTitles[0]?.eur || 1
                  const c = COLORS[artist]||'#888'
                  return (
                    <div key={artist} style={{marginBottom:20}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                        <span style={{width:8,height:8,borderRadius:'50%',background:c,flexShrink:0,display:'inline-block'}}/>
                        <span style={{fontSize:11,fontWeight:700,color:'#888',textTransform:'uppercase',letterSpacing:'1px'}}>{artist}</span>
                      </div>
                      <div className="plat-table-header">
                        <span className="pt-name">Titre</span>
                        <span className="pt-bar"/>
                        <span className="pt-streams">Streams</span>
                        <span className="pt-rev">Revenus</span>
                      </div>
                      {artistTitles.map(({title,eur:e,qty}) => {
                        const w = maxEur > 0 ? Math.min(e/maxEur*100,100) : 0
                        return (
                          <div key={title} className="plat-row">
                            <span className="pt-name">{title.length>20?title.slice(0,18)+'…':title}</span>
                            <div className="pt-bar">
                              <div style={{width:`${w}%`,height:'100%',background:c,borderRadius:2,minWidth:3}}/>
                            </div>
                            <span className="pt-streams">{fmtStreams(qty)}</span>
                            <span className="pt-rev" style={{color:c}}>{fmtEur(e)}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
        {tab==='Plateformes' && (
          <div>
            {detailLoading ? (
              <div style={{textAlign:'center',padding:'40px 0',color:'#444'}}>
                <div className="loading-spinner" style={{margin:'0 auto 12px'}}/>
                Chargement des plateformes…
              </div>
            ) : (
              <>
                <div style={{display:'flex',gap:20,alignItems:'center',marginBottom:20}}>
                  <div style={{width:140,height:140,flexShrink:0}}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={platPie} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
                          {platPie.map(({name,color}) => <Cell key={name} fill={color}/>)}
                        </Pie>
                        <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:11}}
                          formatter={v => [fmtEur(v)]}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="plat-legend-inline">
                    {platPie.map(({name,color}) => (
                      <div key={name} className="plat-legend-item">
                        <span className="plat-dot" style={{background:color}}/>
                        <span>{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="plat-table-header">
                  <span className="pt-name">Plateforme</span>
                  <span className="pt-bar"/>
                  <span className="pt-streams">Streams</span>
                  <span className="pt-rev">Revenus</span>
                </div>
                {byPlat.map(([p,v],i) => {
                  const w = maxPlatEur > 0 ? Math.min(Math.abs(v.eur)/maxPlatEur*100,100) : 0
                  const c = PLAT_COLORS[i%PLAT_COLORS.length]
                  return (
                    <div key={p} className="plat-row">
                      <span className="pt-name">{p.length>20?p.slice(0,18)+'…':p}</span>
                      <div className="pt-bar">
                        <div style={{width:`${w}%`,height:'100%',background:c,borderRadius:2,minWidth:3}}/>
                      </div>
                      <span className="pt-streams">{fmtStreams(v.qty)}</span>
                      <span className="pt-rev" style={{color:c}}>{fmtEur(v.eur)}</span>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
        @media(max-width:640px){.kpi-grid{grid-template-columns:repeat(2,1fr)}}
        .kpi{background:#141414;border:1px solid #1e1e1e;border-radius:8px;padding:13px 14px}
        .kpi-label{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
        .kpi-val{font-size:20px;font-weight:700;color:#eee;line-height:1}
        .kpi-sub{font-size:11px;color:#444;margin-top:4px}
        .pos{color:#6ee7b7!important}.neg{color:#f87171!important}
        .pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
        .pill{padding:4px 13px;border-radius:20px;border:1px solid #1e1e1e;cursor:pointer;font-size:12px;color:#555;background:transparent;font-family:inherit;transition:all .2s}
        .pill.active{background:#eee;color:#111;border-color:#eee;font-weight:700}
        .tabs{display:flex;gap:2px;border-bottom:1px solid #1a1a1a;margin-bottom:20px}
        .tab{background:none;border:none;border-bottom:2px solid transparent;padding:8px 14px;cursor:pointer;font-size:13px;color:#444;font-family:inherit;margin-bottom:-1px}
        .chart-label{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}
        .two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px}
        @media(max-width:600px){.two-col{grid-template-columns:1fr}}
        .hbar-row{display:flex;align-items:center;gap:8px;margin-bottom:7px}
        .hbar-name{width:120px;font-size:12px;color:#bbb;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .hbar-wrap{flex:1;height:18px;background:#1a1a1a;border-radius:3px;overflow:hidden}
        .hbar-fill{height:100%;border-radius:3px;min-width:4px;display:flex;align-items:center;padding:0 6px;font-size:10px;font-weight:700;color:#fff;white-space:nowrap}
        .hbar-right{width:60px;text-align:right;font-size:10px;color:#444;flex-shrink:0}
        .artist-row-click{display:flex;align-items:center;cursor:pointer;border-radius:4px;padding:2px 4px;transition:background .15s}
        .artist-row-click:hover{background:#1a1a1a}
        .artist-row-click .hbar-row{flex:1;margin-bottom:0}
        .row-arrow{color:#333;font-size:12px;margin-left:6px;flex-shrink:0}
        .yearly-breakdown{margin-top:20px;border-top:1px solid #1a1a1a;padding-top:16px;display:flex;flex-direction:column;gap:8px}
        .year-row{display:flex;align-items:center;gap:12px}
        .year-label{width:40px;font-size:12px;color:#555;font-weight:600}
        .year-usd{font-size:14px;font-weight:700;color:#eee;flex:1}
        .year-qty{font-size:12px;color:#444}
        .plat-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font-size:11px;color:#888}
        .plat-item{display:flex;align-items:center;gap:4px}
        .plat-dot{width:7px;height:7px;border-radius:2px;flex-shrink:0}
        .plat-legend-inline{display:flex;flex-wrap:wrap;gap:4px 14px;align-content:flex-start}
        .plat-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:#888}
        .plat-table-header{display:grid;grid-template-columns:130px 1fr 64px 80px;gap:8px;padding:4px 0 6px;border-bottom:1px solid #1e1e1e;margin-bottom:4px}
        .plat-table-header span{font-size:9px;color:#444;text-transform:uppercase;letter-spacing:1px}
        .plat-row{display:grid;grid-template-columns:130px 1fr 64px 80px;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #141414}
        .plat-row:hover{background:#1a1a1a;border-radius:4px}
        .pt-name{font-size:12px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pt-bar{height:6px;background:#1a1a1a;border-radius:2px;overflow:hidden}
        .pt-streams{font-size:11px;color:#555;text-align:right}
        .pt-rev{font-size:12px;font-weight:700;text-align:right}
        .badge{display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;background:#1e1e1e;color:#555;margin-left:4px}
        .loading-spinner{width:22px;height:22px;border:2px solid #1e1e1e;border-top-color:#f97316;border-radius:50%;animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  )
}
