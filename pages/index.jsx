import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/router'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, Legend, AreaChart, Area,
  PieChart, Pie, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS, PLAT_COLORS, fmt, fmtE, deltaStr } from '../lib/artists'
import ImportModal from '../components/ImportModal'

// ─── helpers ──────────────────────────────────────────────
function getMonths(rows) {
  return [...new Set(rows.map(r => r.month))].sort()
}
function sumBy(rows, key) {
  const m = {}
  rows.forEach(r => { m[r[key]] = (m[r[key]] || 0) + r.usd })
  return m
}

// ─── sub-components ───────────────────────────────────────
function KPI({ label, value, sub, subClass }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className={`kpi-sub ${subClass || ''}`}>{sub}</div>}
    </div>
  )
}

function SectionTitle({ title, meta }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {meta && <span className="section-meta">{meta}</span>}
    </div>
  )
}

function HBar({ name, value, maxValue, color, right, pct }) {
  const w = maxValue > 0 ? (value / maxValue * 100).toFixed(1) : 0
  return (
    <div className="hbar-row">
      <div className="hbar-name">{name}</div>
      <div className="hbar-wrap">
        <div className="hbar-fill" style={{ width: `${w}%`, background: color }}>
          {fmt(value)}
        </div>
      </div>
      {right && <div className="hbar-right">{right}</div>}
      {pct !== undefined && <div className="hbar-pct">{pct}%</div>}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [rate, setRate] = useState(0.92)
  const [selectedYear, setSelectedYear] = useState('Tout')
  const [showImport, setShowImport] = useState(false)

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/login'); return }
      setUser(data.session.user)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) router.replace('/login')
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // Load rate from settings
  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'eur_rate').single()
      .then(({ data }) => { if (data) setRate(parseFloat(data.value)) })
  }, [])

  // Fetch royalties
const fetchData = useCallback(async () => {
  setLoading(true)
  let allData = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('royalties')
      .select('month, artist, title, store, usd')
      .order('month', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    allData = allData.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  setRows(allData)
  setLoading(false)
}, [])

  useEffect(() => { if (user) fetchData() }, [user])

  // Save rate
  async function handleRateChange(v) {
    setRate(v)
    await supabase.from('settings').upsert({ key: 'eur_rate', value: String(v) })
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  // ── Computed data ──────────────────────────────────────
  const months = useMemo(() => getMonths(rows), [rows])
  const lastM  = months[months.length - 1]
  const prevM  = months[months.length - 2]

  const filteredRows = useMemo(() =>
    selectedYear === 'Tout' ? rows : rows.filter(r => r.month.startsWith(selectedYear))
  , [rows, selectedYear])

  const years = useMemo(() =>
    [...new Set(rows.map(r => r.month.slice(0, 4)))].sort().reverse()
  , [rows])

  // Global KPIs
  const totalAll = useMemo(() => rows.reduce((s, r) => s + r.usd, 0), [rows])
  const lastMonthTotal = useMemo(() => rows.filter(r => r.month === lastM).reduce((s,r)=>s+r.usd,0), [rows, lastM])
  const prevMonthTotal = useMemo(() => rows.filter(r => r.month === prevM).reduce((s,r)=>s+r.usd,0), [rows, prevM])
  const lastDelta = useMemo(() => deltaStr(lastMonthTotal, prevMonthTotal), [lastMonthTotal, prevMonthTotal])

  const byArtistTotal = useMemo(() => sumBy(rows, 'artist'), [rows])
  const topArtist = useMemo(() => Object.entries(byArtistTotal).sort((a,b)=>b[1]-a[1])[0], [byArtistTotal])
  const byTitleTotal = useMemo(() => sumBy(rows, 'title'), [rows])
  const topTitle  = useMemo(() => Object.entries(byTitleTotal).sort((a,b)=>b[1]-a[1])[0], [byTitleTotal])

  // MoM per artist
  const momData = useMemo(() => ARTISTS.map(a => {
    const cur = rows.filter(r=>r.month===lastM&&r.artist===a).reduce((s,r)=>s+r.usd,0)
    const prv = rows.filter(r=>r.month===prevM&&r.artist===a).reduce((s,r)=>s+r.usd,0)
    return { artist: a, cur, prv, delta: deltaStr(cur, prv) }
  }), [rows, lastM, prevM])

  // Line chart data
  const lineData = useMemo(() => {
    const monthSet = [...new Set(filteredRows.map(r=>r.month))].sort()
    return monthSet.map(m => {
      const obj = { month: m.slice(2) }
      ARTISTS.forEach(a => {
        obj[a] = Math.round(filteredRows.filter(r=>r.month===m&&r.artist===a).reduce((s,r)=>s+r.usd,0)*100)/100
      })
      return obj
    })
  }, [filteredRows])

  // Artist sections
  const artistData = useMemo(() => ARTISTS.map(a => {
    const ar = rows.filter(r => r.artist === a)
    const total = ar.reduce((s,r)=>s+r.usd,0)
    const mos = getMonths(ar)
    const lm = mos[mos.length-1], pm = mos[mos.length-2]
    const lv = ar.filter(r=>r.month===lm).reduce((s,r)=>s+r.usd,0)
    const pv = ar.filter(r=>r.month===pm).reduce((s,r)=>s+r.usd,0)
    const topTitles = Object.entries(sumBy(ar,'title')).sort((a,b)=>b[1]-a[1]).slice(0,5)
    const topPlats  = Object.entries(sumBy(ar,'store')).sort((a,b)=>b[1]-a[1]).slice(0,4)
    const miniData  = mos.map(m => ({ month: m.slice(2), usd: ar.filter(r=>r.month===m).reduce((s,r)=>s+r.usd,0) }))
    return { artist:a, total, months:mos, lastVal:lv, prevVal:pv, delta:deltaStr(lv,pv), topTitles, topPlats, miniData }
  }), [rows])

  // Top titles global
  const topTitlesGlobal = useMemo(() => {
    const byTA = {}
    rows.forEach(r => { if (!byTA[r.title]) byTA[r.title] = r.artist })
    return Object.entries(byTitleTotal).sort((a,b)=>b[1]-a[1]).slice(0,10)
      .map(([t,v]) => ({ title:t, usd:v, artist: byTA[t]||'' }))
  }, [rows, byTitleTotal])

  // Platform donut
  const platData = useMemo(() => {
    const byP = sumBy(rows,'store')
    return Object.entries(byP).sort((a,b)=>b[1]-a[1]).map(([name,value],i) => ({ name, value, color: PLAT_COLORS[i%PLAT_COLORS.length] }))
  }, [rows])

  // Artist bar max
  const artistBarMax = useMemo(() => Math.max(...ARTISTS.map(a=>byArtistTotal[a]||0), 1), [byArtistTotal])

  if (!user || loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        {loading ? 'Chargement des données…' : ''}
      </div>
    )
  }

  return (
    <div className="app">
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="nav-brand">
          <span className="nav-dot" />
          <span>Royalties</span>
        </div>
        <div className="nav-right">
          <div className="rate-control">
            <span>EUR/USD</span>
            <input
              type="number" step="0.01" min="0.1" max="3"
              value={rate}
              onChange={e => handleRateChange(parseFloat(e.target.value) || 0.92)}
            />
          </div>
          <button className="btn-import" onClick={() => setShowImport(true)}>
            ↑ Importer CSV
          </button>
          <button className="btn-logout" onClick={handleLogout} title="Déconnexion">⎋</button>
        </div>
      </nav>

      <div className="page">

        {/* ① GLOBAL KPIs */}
        <SectionTitle title="Vue globale" meta={months.length ? `${months[0]} → ${lastM}` : ''} />
        <div className="kpi-grid kpi-4">
          <KPI label="Total perçu" value={fmt(totalAll)} sub={fmtE(totalAll, rate)} />
          <KPI
            label={`Dernier mois (${lastM || '—'})`}
            value={fmt(lastMonthTotal)}
            sub={lastDelta?.str}
            subClass={lastDelta?.positive ? 'pos' : 'neg'}
          />
          <KPI label="Meilleur artiste" value={topArtist?.[0] || '—'} sub={topArtist ? fmt(topArtist[1]) : ''} />
          <KPI label="Top titre" value={topTitle?.[0]?.slice(0,20) || '—'} sub={topTitle ? fmt(topTitle[1]) : ''} />
        </div>

        {/* ② MOM */}
        <SectionTitle title="Mois en cours vs précédent" meta={prevM && lastM ? `${prevM} → ${lastM}` : ''} />
        <div className="mom-grid">
          {momData.map(({ artist, cur, prv, delta }) => (
            <div key={artist} className="mom-card">
              <div className="mom-artist" style={{ color: COLORS[artist] }}>{artist}</div>
              <div className="mom-val">{fmt(cur)}</div>
              {delta && <div className={`mom-delta ${delta.positive ? 'pos' : 'neg'}`}>{delta.str}</div>}
              <div className="mom-prev">{prv > 0 ? `vs ${fmt(prv)}` : '—'}</div>
            </div>
          ))}
        </div>

        <hr className="divider" />

        {/* ③ ARTIST BARS */}
        <SectionTitle title="Revenus par artiste" meta="total cumulé" />
        <div style={{ marginBottom: 24 }}>
          {ARTISTS.slice().sort((a,b)=>(byArtistTotal[b]||0)-(byArtistTotal[a]||0)).map(a => (
            <HBar
              key={a}
              name={a}
              value={byArtistTotal[a] || 0}
              maxValue={artistBarMax}
              color={COLORS[a]}
              right={fmtE(byArtistTotal[a]||0, rate)}
              pct={totalAll > 0 ? ((byArtistTotal[a]||0) / totalAll * 100).toFixed(1) : '0'}
            />
          ))}
        </div>

        <hr className="divider" />

        {/* ④ LINE CHART */}
        <SectionTitle title="Évolution mensuelle" />
        <div className="pills">
          {['Tout', ...years].map(y => (
            <button key={y} className={`pill ${selectedYear === y ? 'active' : ''}`} onClick={() => setSelectedYear(y)}>{y}</button>
          ))}
        </div>
        <div style={{ height: 260, marginBottom: 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fill: '#444', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#444', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => '$'+Math.round(v)} />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#888' }}
                formatter={(v, name) => [fmt(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#666' }} />
              {ARTISTS.map(a => (
                <Line key={a} type="monotone" dataKey={a} stroke={COLORS[a]} strokeWidth={2} dot={{ r: 2, fill: COLORS[a] }} activeDot={{ r: 4 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <hr className="divider" />

        {/* ⑤ ARTIST SECTIONS */}
        <SectionTitle title="Détail par artiste" />
        {artistData.map(({ artist, total, months: mos, lastVal, delta, topTitles, topPlats, miniData }) => (
          <div key={artist} className="artist-card">
            <div className="ac-header">
              <span className="ac-dot" style={{ background: COLORS[artist] }} />
              <span className="ac-name">{artist}</span>
              <span className="ac-total">{fmt(total)} · {fmtE(total, rate)}</span>
            </div>
            <div className="kpi-grid kpi-3" style={{ marginBottom: 16 }}>
              <KPI label="Total" value={fmt(total)} sub={fmtE(total, rate)} />
              <KPI
                label="Dernier mois"
                value={fmt(lastVal)}
                sub={delta?.str}
                subClass={delta?.positive ? 'pos' : 'neg'}
              />
              <KPI label="Mois actifs" value={mos.length} sub={mos.length ? `${mos[0]} → ${mos[mos.length-1]}` : ''} />
            </div>
            <div className="ac-body">
              <div>
                <div className="sub-label">Top titres</div>
                {topTitles.map(([t,v]) => (
                  <HBar key={t} name={t.length>22?t.slice(0,20)+'…':t} value={v} maxValue={topTitles[0]?.[1]||1} color={COLORS[artist]} right={fmtE(v,rate)} />
                ))}
              </div>
              <div>
                <div className="sub-label">Plateformes</div>
                {topPlats.map(([p,v],i) => (
                  <HBar key={p} name={p.length>20?p.slice(0,18)+'…':p} value={v} maxValue={total||1} color={COLORS[artist]} right={fmtE(v,rate)} />
                ))}
                <div className="sub-label" style={{ marginTop: 14 }}>Mensuel</div>
                <div style={{ height: 80 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={miniData} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
                      <XAxis dataKey="month" tick={{ fill: '#333', fontSize: 8 }} axisLine={false} tickLine={false} />
                      <YAxis tick={false} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 4, fontSize: 11 }}
                        formatter={v => [fmt(v)]}
                        labelStyle={{ color: '#666' }}
                      />
                      <defs>
                        <linearGradient id={`grad-${artist}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS[artist]} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={COLORS[artist]} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="usd" stroke={COLORS[artist]} strokeWidth={1.5} fill={`url(#grad-${artist})`} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        ))}

        <hr className="divider" />

        {/* ⑥ TOP TITRES */}
        <SectionTitle title="Top titres" meta="tous artistes" />
        <div style={{ marginBottom: 24 }}>
          {topTitlesGlobal.map(({ title, usd, artist }) => (
            <HBar
              key={title}
              name={<span>{title.length>28?title.slice(0,26)+'…':title} <span className="badge">{artist}</span></span>}
              value={usd}
              maxValue={topTitlesGlobal[0]?.usd || 1}
              color={COLORS[artist] || '#666'}
              right={fmtE(usd, rate)}
            />
          ))}
        </div>

        <hr className="divider" />

        {/* ⑦ PLATFORMS */}
        <SectionTitle title="Revenus par plateforme" meta="tous artistes" />
        <div className="plat-legend">
          {platData.map(({ name, value, color }) => (
            <div key={name} className="plat-item">
              <span className="plat-dot" style={{ background: color }} />
              {name} — {fmt(value)}
            </div>
          ))}
        </div>
        <div style={{ height: 280, maxWidth: 280, margin: '0 auto' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={platData} cx="50%" cy="50%" innerRadius={70} outerRadius={110} dataKey="value" stroke="none">
                {platData.map(({ name, color }) => <Cell key={name} fill={color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 6, fontSize: 12 }}
                formatter={v => [fmt(v)]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ height: 40 }} />
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={fetchData} />}
    </div>
  )
}
