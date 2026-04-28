import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS, PLAT_COLORS, fmt, fmtStreams, deltaStr } from '../lib/artists'

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
        <div className="hbar-fill" style={{ width: `${w}%`, background: color }}>
          {typeof value === 'number' && value > 999 ? fmtStreams(value) : fmt(value)}
        </div>
      </div>
      {right && <div className="hbar-right">{right}</div>}
    </div>
  )
}

const TABS = ['Revenus', 'Streams', 'Artistes', 'Titres', 'Plateformes']

export default function LabelPage() {
  const router = useRouter()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Revenus')
  const [yearFilter, setYearFilter] = useState('Tout')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    let all = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties')
        .select('month, artist, title, store, country, usd, qty')
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

  const months  = useMemo(() => [...new Set(rows.map(r => r.month))].sort(), [rows])
  const years   = useMemo(() => [...new Set(months.map(m => m.slice(0,4)))].sort().reverse(), [months])
  const lastM   = months[months.length-1]
  const prevM   = months[months.length-2]

  const filtered = useMemo(() =>
    yearFilter === 'Tout' ? rows : rows.filter(r => r.month.startsWith(yearFilter))
  , [rows, yearFilter])

  const totalUsd  = useMemo(() => rows.reduce((s,r) => s+r.usd, 0), [rows])
  const totalQty  = useMemo(() => rows.reduce((s,r) => s+r.qty, 0), [rows])
  const lastUsd   = useMemo(() => rows.filter(r=>r.month===lastM).reduce((s,r)=>s+r.usd,0), [rows,lastM])
  const prevUsd   = useMemo(() => rows.filter(r=>r.month===prevM).reduce((s,r)=>s+r.usd,0), [rows,prevM])
  const lastQty   = useMemo(() => rows.filter(r=>r.month===lastM).reduce((s,r)=>s+r.qty,0), [rows,lastM])
  const prevQty   = useMemo(() => rows.filter(r=>r.month===prevM).reduce((s,r)=>s+r.qty,0), [rows,prevM])
  const dUsd = deltaStr(lastUsd, prevUsd)
  const dQty = deltaStr(lastQty, prevQty)

  // Monthly chart — tous artistes + total
  const monthlyData = useMemo(() => {
    const ms = [...new Set(filtered.map(r=>r.month))].sort()
    return ms.map(m => {
      const obj = { month: m.slice(2) }
      ARTISTS.forEach(a => {
        obj[a] = Math.round(filtered.filter(r=>r.month===m&&r.artist===a).reduce((s,r)=>s+r.usd,0))
      })
      obj['Total'] = Math.round(filtered.filter(r=>r.month===m).reduce((s,r)=>s+r.usd,0))
      return obj
    })
  }, [filtered])

  const monthlyQtyData = useMemo(() => {
    const ms = [...new Set(filtered.map(r=>r.month))].sort()
    return ms.map(m => {
      const obj = { month: m.slice(2) }
      ARTISTS.forEach(a => {
        obj[a] = filtered.filter(r=>r.month===m&&r.artist===a).reduce((s,r)=>s+r.qty,0)
      })
      obj['Total'] = filtered.filter(r=>r.month===m).reduce((s,r)=>s+r.qty,0)
      return obj
    })
  }, [filtered])

  // By artist
  const byArtist = useMemo(() => {
    return ARTISTS.map(a => ({
      artist: a,
      usd: filtered.filter(r=>r.artist===a).reduce((s,r)=>s+r.usd,0),
      qty: filtered.filter(r=>r.artist===a).reduce((s,r)=>s+r.qty,0),
    })).sort((a,b) => b.usd-a.usd)
  }, [filtered])

  const maxArtistUsd = byArtist[0]?.usd || 1

  // By title
  const byTitle = useMemo(() => {
    const m = {}
    const ma = {}
    filtered.forEach(r => {
      if (!m[r.title]) { m[r.title] = { usd:0, qty:0 }; ma[r.title] = r.artist }
      m[r.title].usd += r.usd
      m[r.title].qty += r.qty
    })
    return Object.entries(m).sort((a,b)=>b[1].usd-a[1].usd).slice(0,10)
      .map(([t,v]) => ({ title:t, ...v, artist: ma[t] }))
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

  const maxPlatUsd = byPlat[0]?.[1].usd || 1
  const platPie = byPlat.slice(0,8).map(([name,v],i) => ({ name, value: Math.round(v.usd), color: PLAT_COLORS[i] }))

  // Yearly breakdown
  const yearlyData = useMemo(() => {
    return years.map(y => {
      const yr = rows.filter(r=>r.month.startsWith(y))
      return {
        year: y,
        usd: yr.reduce((s,r)=>s+r.usd,0),
        qty: yr.reduce((s,r)=>s+r.qty,0),
      }
    })
  }, [rows, years])

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <span>Chargement…</span>
    </div>
  )

  return (
    <div className="app">
      <nav className="navbar">
        <button className="back-btn" onClick={() => router.push('/')}>← Retour</button>
        <div className="nav-brand">
          <span className="nav-dot" style={{ background: 'linear-gradient(135deg, #3b82f6, #f97316)' }} />
          <span>Avlanche Music</span>
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
            <button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}
              style={tab===t?{borderBottomColor:'#f97316',color:'#eee'}:{}}>{t}</button>
          ))}
        </div>

        {/* ── REVENUS ── */}
        {tab === 'Revenus' && (
          <div>
            <div className="chart-label">Revenus mensuels par artiste (USD)</div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>'$'+Math.round(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}} formatter={(v,n)=>[fmt(v),n]} labelStyle={{color:'#888'}}/>
                  <Legend wrapperStyle={{fontSize:11,color:'#666'}}/>
                  {ARTISTS.map(a => (
                    <Line key={a} type="monotone" dataKey={a} stroke={COLORS[a]} strokeWidth={2} dot={{r:2}} activeDot={{r:4}} connectNulls/>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {yearlyData.map(({year,usd,qty}) => (
                <div key={year} className="year-row">
                  <span className="year-label">{year}</span>
                  <span className="year-usd">{fmt(usd)}</span>
                  <span className="year-qty">{fmtStreams(qty)} streams</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STREAMS ── */}
        {tab === 'Streams' && (
          <div>
            <div className="chart-label">Streams mensuels par artiste</div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyQtyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtStreams(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}} formatter={(v,n)=>[fmtStreams(v),n]} labelStyle={{color:'#888'}}/>
                  <Legend wrapperStyle={{fontSize:11,color:'#666'}}/>
                  {ARTISTS.map(a => (
                    <Bar key={a} dataKey={a} stackId="a" fill={COLORS[a]}/>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {yearlyData.map(({year,usd,qty}) => (
                <div key={year} className="year-row">
                  <span className="year-label">{year}</span>
                  <span className="year-usd">{fmtStreams(qty)} streams</span>
                  <span className="year-qty">{fmt(usd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ARTISTES ── */}
        {tab === 'Artistes' && (
          <div>
            <div className="chart-label">Royalties par artiste</div>
            {byArtist.map(({artist,usd,qty}) => (
              <div key={artist} className="artist-row-click" onClick={() => router.push(`/artist/${encodeURIComponent(artist)}`)}>
                <HBar name={artist} value={usd} maxValue={maxArtistUsd} color={COLORS[artist]} right={fmtStreams(qty)+' str'} />
                <span className="row-arrow">→</span>
              </div>
            ))}
            <div style={{height:20}}/>
            <div className="chart-label">Streams par artiste</div>
            {[...byArtist].sort((a,b)=>b.qty-a.qty).map(({artist,usd,qty}) => (
              <div key={artist} className="artist-row-click" onClick={() => router.push(`/artist/${encodeURIComponent(artist)}`)}>
                <HBar name={artist} value={qty} maxValue={Math.max(...byArtist.map(a=>a.qty))||1} color={COLORS[artist]} right={fmt(usd)} />
                <span className="row-arrow">→</span>
              </div>
            ))}
          </div>
        )}

        {/* ── TITRES ── */}
        {tab === 'Titres' && (
          <div>
            <div className="chart-label">Top 10 titres — royalties</div>
            {byTitle.map(({title,usd,qty,artist}) => (
              <HBar
                key={title}
                name={<span>{title.length>26?title.slice(0,24)+'…':title} <span className="badge">{artist}</span></span>}
                value={usd}
                maxValue={byTitle[0]?.usd||1}
                color={COLORS[artist]||'#666'}
                right={fmtStreams(qty)}
              />
            ))}
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
                        {platPie.map(({name,color}) => <Cell key={name} fill={color}/>)}
                      </Pie>
                      <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:11}} formatter={v=>[fmt(v)]}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="plat-legend">
                  {platPie.map(({name,color}) => (
                    <div key={name} className="plat-item"><span className="plat-dot" style={{background:color}}/>{name}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; }
        @media(max-width:640px) { .kpi-grid { grid-template-columns:repeat(2,1fr); } }
        .kpi { background:#141414; border:1px solid #1e1e1e; border-radius:8px; padding:13px 14px; }
        .kpi-label { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }
        .kpi-val { font-size:20px; font-weight:700; color:#eee; line-height:1; }
        .kpi-sub { font-size:11px; color:#444; margin-top:4px; }
        .pos { color:#6ee7b7!important; } .neg { color:#f87171!important; }
        .pills { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; }
        .pill { padding:4px 13px; border-radius:20px; border:1px solid #1e1e1e; cursor:pointer; font-size:12px; color:#555; background:transparent; font-family:inherit; transition:all .2s; }
        .pill.active { background:#eee; color:#111; border-color:#eee; font-weight:700; }
        .tabs { display:flex; gap:2px; border-bottom:1px solid #1a1a1a; margin-bottom:20px; }
        .tab { background:none; border:none; border-bottom:2px solid transparent; padding:8px 14px; cursor:pointer; font-size:13px; color:#444; font-family:inherit; margin-bottom:-1px; }
        .chart-label { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:1px; margin-bottom:12px; }
        .two-col { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
        @media(max-width:600px) { .two-col { grid-template-columns:1fr; } }
        .hbar-row { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
        .hbar-name { width:120px; font-size:12px; color:#bbb; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .hbar-wrap { flex:1; height:18px; background:#1a1a1a; border-radius:3px; overflow:hidden; }
        .hbar-fill { height:100%; border-radius:3px; min-width:4px; display:flex; align-items:center; padding:0 6px; font-size:10px; font-weight:700; color:#fff; white-space:nowrap; }
        .hbar-right { width:60px; text-align:right; font-size:10px; color:#444; flex-shrink:0; }
        .artist-row-click { display:flex; align-items:center; cursor:pointer; border-radius:4px; padding:2px 4px; transition:background .15s; }
        .artist-row-click:hover { background:#1a1a1a; }
        .artist-row-click .hbar-row { flex:1; margin-bottom:0; }
        .row-arrow { color:#333; font-size:12px; margin-left:6px; flex-shrink:0; }
        .yearly-breakdown { margin-top:20px; border-top:1px solid #1a1a1a; padding-top:16px; display:flex; flex-direction:column; gap:8px; }
        .year-row { display:flex; align-items:center; gap:12px; }
        .year-label { width:40px; font-size:12px; color:#555; font-weight:600; }
        .year-usd { font-size:14px; font-weight:700; color:#eee; flex:1; }
        .year-qty { font-size:12px; color:#444; }
        .plat-legend { display:flex; flex-wrap:wrap; gap:4px 12px; margin-top:8px; font-size:11px; color:#888; }
        .plat-item { display:flex; align-items:center; gap:4px; }
        .plat-dot { width:7px; height:7px; border-radius:2px; flex-shrink:0; }
        .badge { display:inline-block; padding:1px 5px; border-radius:3px; font-size:10px; background:#1e1e1e; color:#555; margin-left:4px; }
        .back-btn { background:none; border:none; color:#555; font-size:13px; cursor:pointer; font-family:inherit; transition:color .2s; }
        .back-btn:hover { color:#eee; }
      `}</style>
    </div>
  )
}
