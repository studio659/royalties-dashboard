import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS, fmt, fmtStreams } from '../lib/artists'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, BarChart, Bar } from 'recharts'
import MainNav from '../components/MainNav'

const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

export default function ForecastPage() {
  const router = useRouter()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [horizon, setHorizon] = useState(12)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
    fetchData()
  }, [])

  async function fetchData() {
    let all = [], from = 0
    while (true) {
      const { data } = await supabase.from('royalties').select('month,artist,usd,qty').range(from, from+999)
      if (!data?.length) break
      all = all.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setRows(all)
    setLoading(false)
  }

  const forecast = useMemo(() => {
    if (!rows.length) return []
    const allMonths = [...new Set(rows.map(r => r.month))].sort()
    const last6 = allMonths.slice(-6)

    // Compute monthly avg per artist over last 6 months
    const avgPerArtist = {}
    for (const artist of ARTISTS) {
      const ar = rows.filter(r => r.artist === artist)
      const monthly = last6.map(m => ar.filter(r => r.month === m).reduce((s,r) => s+r.usd, 0))
      avgPerArtist[artist] = monthly.reduce((s,v) => s+v, 0) / (monthly.filter(v=>v>0).length || 1)
    }

    // Generate next N months
    const lastMonth = allMonths[allMonths.length - 1]
    const [ly, lm] = lastMonth.split('-').map(Number)
    const projected = []
    for (let i = 1; i <= horizon; i++) {
      let m = lm + i, y = ly
      while (m > 12) { m -= 12; y++ }
      const label = `${MONTHS_FR[m-1]} ${y}`
      const entry = { month: label, total: 0 }
      for (const artist of ARTISTS) {
        // Apply slight decay factor (0.98 per month to be conservative)
        const decay = Math.pow(0.98, i)
        entry[artist] = Math.round(avgPerArtist[artist] * decay * 100) / 100
        entry.total += entry[artist]
      }
      entry.total = Math.round(entry.total * 100) / 100
      projected.push(entry)
    }
    return projected
  }, [rows, horizon])

  const totalForecast = forecast.reduce((s, m) => s + m.total, 0)

  // Historical last 12 months for comparison
  const historical = useMemo(() => {
    if (!rows.length) return []
    const allMonths = [...new Set(rows.map(r => r.month))].sort().slice(-12)
    return allMonths.map(m => {
      const entry = { month: `${MONTHS_FR[parseInt(m.split('-')[1])-1]} ${m.split('-')[0].slice(2)}` }
      for (const artist of ARTISTS) {
        entry[artist] = rows.filter(r => r.artist === artist && r.month === m).reduce((s,r) => s+r.usd, 0)
      }
      entry.total = ARTISTS.reduce((s,a) => s + (entry[a]||0), 0)
      return entry
    })
  }, [rows])

  return (
    <div className="app">
      <MainNav title="Prévisionnel" showBack onBack={() => router.push('/')} />
      <div className="page" style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px' }}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#eee', marginBottom: 4 }}>Prévisionnel</div>
            <div style={{ fontSize: 12, color: '#555' }}>Projection basée sur la moyenne des 6 derniers mois · décroissance conservative de 2%/mois</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[3,6,12].map(h => (
              <button key={h} onClick={() => setHorizon(h)}
                style={{ background: horizon===h ? '#f59e0b' : 'none', border: '1px solid ' + (horizon===h ? '#f59e0b' : '#2a2a2a'), borderRadius: 6, color: horizon===h ? '#000' : '#555', fontSize: 12, fontWeight: 600, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                {h} mois
              </button>
            ))}
          </div>
        </div>

        {/* KPI TOTAL */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:24 }}>
          <div style={{ background:'#141414', border:'1px solid #1e1e1e', borderRadius:9, padding:'16px 18px' }}>
            <div style={{ fontSize:10, color:'#444', textTransform:'uppercase', letterSpacing:'1.5px', marginBottom:6 }}>Prévision {horizon} mois</div>
            <div style={{ fontSize:22, fontWeight:700, color:'#f59e0b' }}>{fmt(totalForecast)}</div>
          </div>
          <div style={{ background:'#141414', border:'1px solid #1e1e1e', borderRadius:9, padding:'16px 18px' }}>
            <div style={{ fontSize:10, color:'#444', textTransform:'uppercase', letterSpacing:'1.5px', marginBottom:6 }}>Mensuel moyen prévu</div>
            <div style={{ fontSize:22, fontWeight:700, color:'#eee' }}>{fmt(totalForecast / horizon)}</div>
          </div>
          <div style={{ background:'#141414', border:'1px solid #1e1e1e', borderRadius:9, padding:'16px 18px' }}>
            <div style={{ fontSize:10, color:'#444', textTransform:'uppercase', letterSpacing:'1.5px', marginBottom:6 }}>Vs mois passés (6m avg)</div>
            <div style={{ fontSize:22, fontWeight:700, color:'#eee' }}>{fmt(historical.slice(-6).reduce((s,m)=>s+m.total,0)/6)}</div>
          </div>
        </div>

        {/* CHART PRÉVISIONNEL */}
        <div style={{ background:'#141414', border:'1px solid #1e1e1e', borderRadius:10, padding:'18px', marginBottom:16 }}>
          <div style={{ fontSize:12, color:'#555', marginBottom:14 }}>Revenus mensuels projetés par artiste</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={forecast} margin={{ top:4, right:8, left:-10, bottom:0 }}>
              <XAxis dataKey="month" tick={{ fontSize:10, fill:'#444' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:10, fill:'#444' }} axisLine={false} tickLine={false} tickFormatter={v=>`$${Math.round(v)}`} />
              <Tooltip contentStyle={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:6, fontSize:11 }} formatter={(v,n)=>[fmt(v), n]} />
              <Legend wrapperStyle={{ fontSize:11, color:'#666' }} />
              {ARTISTS.map(a => (
                <Area key={a} type="monotone" dataKey={a} stackId="1" stroke={COLORS[a]} fill={COLORS[a]} fillOpacity={0.2} strokeWidth={1.5} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* CHART HISTORIQUE */}
        <div style={{ background:'#141414', border:'1px solid #1e1e1e', borderRadius:10, padding:'18px' }}>
          <div style={{ fontSize:12, color:'#555', marginBottom:14 }}>Historique réel — 12 derniers mois</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={historical} margin={{ top:4, right:8, left:-10, bottom:0 }}>
              <XAxis dataKey="month" tick={{ fontSize:10, fill:'#444' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:10, fill:'#444' }} axisLine={false} tickLine={false} tickFormatter={v=>`$${Math.round(v)}`} />
              <Tooltip contentStyle={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:6, fontSize:11 }} formatter={(v,n)=>[fmt(v), n]} />
              {ARTISTS.map(a => (
                <Bar key={a} dataKey={a} stackId="1" fill={COLORS[a]} fillOpacity={0.85} radius={[0,0,0,0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
