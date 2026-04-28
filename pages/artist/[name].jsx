import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts'
import { supabase } from '../../lib/supabase'
import { COLORS, PLAT_COLORS, fmt, fmtStreams, deltaStr } from '../../lib/artists'

function KPI({ label, value, sub, subClass }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-val">{value}</div>
      {sub && <div className={`kpi-sub ${subClass || ''}`}>{sub}</div>}
    </div>
  )
}

function HBar({ name, value, maxValue, color, right }) {
  const w = maxValue > 0 ? Math.min((value / maxValue * 100), 100).toFixed(1) : 0
  return (
    <div className="hbar-row">
      <div className="hbar-name">{typeof name === 'string' && name.length > 24 ? name.slice(0,22)+'…' : name}</div>
      <div className="hbar-wrap">
        <div className="hbar-fill" style={{ width: `${w}%`, background: color }}>{typeof value === 'number' ? (value > 999 ? fmtStreams(value) : fmt(value)) : value}</div>
      </div>
      {right && <div className="hbar-right">{right}</div>}
    </div>
  )
}

const TABS = ['Revenus', 'Streams', 'Titres', 'Plateformes', 'Pays']

export default function ArtistPage() {
  const router = useRouter()
  const { name } = router.query
  const artist = name ? decodeURIComponent(name) : ''
  const color = COLORS[artist] || '#888'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Revenus')
  const [yearFilter, setYearFilter] = useState('Tout')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
  }, [])

  useEffect(() => {
    if (!artist) return
    fetchData()
  }, [artist])

  async function fetchData() {
    setLoading(true)
    let all = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties')
        .select('month, title, store, country, isrc, usd, qty')
        .eq('artist', artist)
        .order('month', { ascending: true })
        .range(from, from + 999)
      if (error || !data || data.length === 0) break
      all = all.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setRows(all)
    setLoading(false)
  }

  // ── Computed ──────────────────────────────────────────
  const months = useMemo(() => [...new Set(rows.map(r => r.month))].sort(), [rows])
  const years  = useMemo(() => [...new Set(months.map(m => m.slice(0,4)))].sort().reverse(), [months])

  const filtered = useMemo(() =>
    yearFilter === 'Tout' ? rows : rows.filter(r => r.month.startsWith(yearFilter))
  , [rows, yearFilter])

  const lastM = months[months.length-1]
  const prevM = months[months.length-2]

  const totalUsd = useMemo(() => rows.reduce((s,r) => s+r.usd, 0), [rows])
  const totalQty = useMemo(() => rows.reduce((s,r) => s+r.qty, 0), [rows])
  const lastUsd  = useMemo(() => rows.filter(r=>r.month===lastM).reduce((s,r)=>s+r.usd,0), [rows,lastM])
  const prevUsd  = useMemo(() => rows.filter(r=>r.month===prevM).reduce((s,r)=>s+r.usd,0), [rows,prevM])
  const lastQty  = useMemo(() => rows.filter(r=>r.month===lastM).reduce((s,r)=>s+r.qty,0), [rows,lastM])
  const prevQty  = useMemo(() => rows.filter(r=>r.month===prevM).reduce((s,r)=>s+r.qty,0), [rows,prevM])
  const dUsd = deltaStr(lastUsd, prevUsd)
  const dQty = deltaStr(lastQty, prevQty)

  // Monthly chart data
  const monthlyData = useMemo(() => {
    const ms = [...new Set(filtered.map(r=>r.month))].sort()
    return ms.map(m => ({
      month: m.slice(2),
      usd: Math.round(filtered.filter(r=>r.month===m).reduce((s,r)=>s+r.usd,0)),
      qty: filtered.filter(r=>r.month===m).reduce((s,r)=>s+r.qty,0),
    }))
  }, [filtered])

  // By title
  const byTitle = useMemo(() => {
    const m = {}
    filtered.forEach(r => {
      if (!m[r.title]) m[r.title] = { usd:0, qty:0 }
      m[r.title].usd += r.usd
      m[r.title].qty += r.qty
    })
    return Object.entries(m).sort((a,b)=>b[1].usd-a[1].usd)
  }, [filtered])

  // By platform
  const byPlat = useMemo(() => {
    const m = {}
    filtered.forEach(r => {
      if (!m[r.store]) m[r.store] = { usd:0, qty:0 }
      m[r.store].usd += r.usd
      m[r.store].qty += r.qty
    })
    return Object.entries(m).sort((a,b)=>b[1].usd-a[1].usd)
  }, [filtered])

  // By country
  const byCountry = useMemo(() => {
    const m = {}
    filtered.forEach(r => {
      if (!r.country) return
      if (!m[r.country]) m[r.country] = { usd:0, qty:0 }
      m[r.country].usd += r.usd
      m[r.country].qty += r.qty
    })
    return Object.entries(m).sort((a,b)=>b[1].qty-a[1].qty).slice(0,15)
  }, [filtered])

  const maxTitleUsd = byTitle[0]?.[1].usd || 1
  const maxTitleQty = byTitle[0]?.[1].qty || 1
  const maxPlatUsd  = byPlat[0]?.[1].usd || 1
  const maxCountryQty = byCountry[0]?.[1].qty || 1

  const platPie = byPlat.slice(0,8).map(([name,v],i) => ({ name, value: Math.round(v.usd), color: PLAT_COLORS[i] }))

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner" style={{ borderTopColor: color }} />
      <span>Chargement…</span>
    </div>
  )

  return (
    <div className="app">
      <nav className="navbar">
        <button className="back-btn" onClick={() => router.push('/')}>← Retour</button>
        <div className="nav-brand">
          <span className="nav-dot" style={{ background: color }} />
          <span>{artist}</span>
        </div>
        <div style={{ width: 80 }} />
      </nav>

      <div className="page">
        {/* KPIs */}
        <div className="kpi-grid">
          <KPI label="Total royalties" value={fmt(totalUsd)} sub={`${months.length} mois`} />
          <KPI label="Total streams" value={fmtStreams(totalQty)} sub={`${months.length} mois`} />
          <KPI label={`Royalties ${lastM||'—'}`} value={fmt(lastUsd)} sub={dUsd?.str} subClass={dUsd?.positive?'pos':'neg'} />
          <KPI label={`Streams ${lastM||'—'}`} value={fmtStreams(lastQty)} sub={dQty?.str} subClass={dQty?.positive?'pos':'neg'} />
        </div>

        {/* Year pills */}
        <div className="pills">
          {['Tout',...years].map(y => (
            <button key={y} className={`pill ${yearFilter===y?'active':''}`} onClick={()=>setYearFilter(y)}>{y}</button>
          ))}
        </div>

        {/* Tabs */}
        <div className="tabs">
          {TABS.map(t => (
            <button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)} style={tab===t?{borderBottomColor:color,color:'#eee'}:{}}>{t}</button>
          ))}
        </div>

        {/* ── REVENUS ── */}
        {tab === 'Revenus' && (
          <div>
            <div className="chart-label">Revenus mensuels (USD)</div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={color} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>'$'+Math.round(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}} formatter={v=>[fmt(v),'Royalties']} labelStyle={{color:'#888'}}/>
                  <Area type="monotone" dataKey="usd" stroke={color} strokeWidth={2} fill="url(#grad)" dot={{r:2,fill:color}} activeDot={{r:4}}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {years.map(y => {
                const yr = rows.filter(r=>r.month.startsWith(y))
                const usd = yr.reduce((s,r)=>s+r.usd,0)
                const qty = yr.reduce((s,r)=>s+r.qty,0)
                return (
                  <div key={y} className="year-row">
                    <span className="year-label">{y}</span>
                    <span className="year-usd" style={{color}}>{fmt(usd)}</span>
                    <span className="year-qty">{fmtStreams(qty)} streams</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── STREAMS ── */}
        {tab === 'Streams' && (
          <div>
            <div className="chart-label">Streams mensuels</div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtStreams(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}} formatter={v=>[fmtStreams(v),'Streams']} labelStyle={{color:'#888'}}/>
                  <Bar dataKey="qty" fill={color} radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {years.map(y => {
                const yr = rows.filter(r=>r.month.startsWith(y))
                const qty = yr.reduce((s,r)=>s+r.qty,0)
                const usd = yr.reduce((s,r)=>s+r.usd,0)
                return (
                  <div key={y} className="year-row">
                    <span className="year-label">{y}</span>
                    <span className="year-usd" style={{color}}>{fmtStreams(qty)} streams</span>
                    <span className="year-qty">{fmt(usd)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── TITRES ── */}
        {tab === 'Titres' && (
          <div>
            <div className="two-col">
              <div>
                <div className="chart-label">Par royalties</div>
                {byTitle.slice(0,10).map(([t,v]) => (
                  <HBar key={t} name={t} value={v.usd} maxValue={maxTitleUsd} color={color} right={fmtStreams(v.qty)+' str'} />
                ))}
              </div>
              <div>
                <div className="chart-label">Par streams</div>
                {[...byTitle].sort((a,b)=>b[1].qty-a[1].qty).slice(0,10).map(([t,v]) => (
                  <HBar key={t} name={t} value={v.qty} maxValue={maxTitleQty} color={color} right={fmt(v.usd)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── PLATEFORMES ── */}
        {tab === 'Plateformes' && (
          <div>
            <div className="two-col">
              <div>
                <div className="chart-label">Royalties par plateforme</div>
                {byPlat.map(([p,v],i) => (
                  <HBar key={p} name={p} value={v.usd} maxValue={maxPlatUsd} color={PLAT_COLORS[i%PLAT_COLORS.length]} right={fmtStreams(v.qty)} />
                ))}
              </div>
              <div>
                <div className="chart-label">Répartition</div>
                <div style={{height:220}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={platPie} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" stroke="none">
                        {platPie.map(({name,color:c}) => <Cell key={name} fill={c}/>)}
                      </Pie>
                      <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:11}} formatter={v=>[fmt(v)]}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="plat-legend">
                  {platPie.map(({name,color:c}) => (
                    <div key={name} className="plat-item"><span className="plat-dot" style={{background:c}}/>{name}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PAYS ── */}
        {tab === 'Pays' && (
          <div>
            <div className="chart-label">Top pays par streams</div>
            {byCountry.map(([c,v]) => (
              <HBar key={c} name={c} value={v.qty} maxValue={maxCountryQty} color={color} right={fmt(v.usd)} />
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 20px; }
        @media(max-width:640px) { .kpi-grid { grid-template-columns: repeat(2,1fr); } }
        .kpi { background:#141414; border:1px solid #1e1e1e; border-radius:8px; padding:13px 14px; }
        .kpi-label { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }
        .kpi-val { font-size:20px; font-weight:700; color:#eee; line-height:1; }
        .kpi-sub { font-size:11px; color:#444; margin-top:4px; }
        .pos { color:#6ee7b7!important; } .neg { color:#f87171!important; }
        .pills { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; }
        .pill { padding:4px 13px; border-radius:20px; border:1px solid #1e1e1e; cursor:pointer; font-size:12px; color:#555; background:transparent; transition:all .2s; font-family:inherit; }
        .pill.active { background:#eee; color:#111; border-color:#eee; font-weight:700; }
        .tabs { display:flex; gap:2px; border-bottom:1px solid #1a1a1a; margin-bottom:20px; }
        .tab { background:none; border:none; border-bottom:2px solid transparent; padding:8px 14px; cursor:pointer; font-size:13px; color:#444; font-family:inherit; transition:color .2s; margin-bottom:-1px; }
        .tab.active { color:#eee; }
        .chart-label { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:1px; margin-bottom:12px; }
        .two-col { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
        @media(max-width:600px) { .two-col { grid-template-columns:1fr; } }
        .hbar-row { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
        .hbar-name { width:120px; font-size:12px; color:#bbb; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .hbar-wrap { flex:1; height:18px; background:#1a1a1a; border-radius:3px; overflow:hidden; }
        .hbar-fill { height:100%; border-radius:3px; min-width:4px; display:flex; align-items:center; padding:0 6px; font-size:10px; font-weight:700; color:#fff; white-space:nowrap; }
        .hbar-right { width:60px; text-align:right; font-size:10px; color:#444; flex-shrink:0; }
        .yearly-breakdown { margin-top:20px; border-top:1px solid #1a1a1a; padding-top:16px; display:flex; flex-direction:column; gap:8px; }
        .year-row { display:flex; align-items:center; gap:12px; }
        .year-label { width:40px; font-size:12px; color:#555; font-weight:600; }
        .year-usd { font-size:14px; font-weight:700; flex:1; }
        .year-qty { font-size:12px; color:#444; }
        .plat-legend { display:flex; flex-wrap:wrap; gap:4px 12px; margin-top:8px; font-size:11px; color:#888; }
        .plat-item { display:flex; align-items:center; gap:4px; }
        .plat-dot { width:7px; height:7px; border-radius:2px; flex-shrink:0; }
        .back-btn { background:none; border:none; color:#555; font-size:13px; cursor:pointer; padding:0; font-family:inherit; transition:color .2s; }
        .back-btn:hover { color:#eee; }
      `}</style>
    </div>
  )
}
