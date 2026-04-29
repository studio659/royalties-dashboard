import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useRate } from '../lib/rateContext'
import { ARTISTS, COLORS, PLAT_COLORS, fmtEur, fmtStreams, deltaStr } from '../lib/artists'
import MainNav from '../components/MainNav'

// Convertit n'importe quelle ligne en EUR
function toEur(r, rate) {
  if (r.currency === 'EUR') return Number(r.amount || 0)
  return Number(r.amount || 0) * rate
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
  const [rows, setRows] = useState([])
  const [allArtists, setAllArtists] = useState(ARTISTS)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Revenus')
  const [yearFilter, setYearFilter] = useState('Tout')

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{if(!data.session)router.replace('/login')})
    fetchData()
  },[])

  async function fetchData() {
    setLoading(true)

    // Charge la liste dynamique des artistes depuis la DB
    const { data: artistsData } = await supabase.from('artists').select('name, color').order('created_at')
    if (artistsData?.length) setAllArtists(artistsData.map(a => a.name))

    let all=[], from=0
    while(true){
      const {data,error} = await supabase.from('royalties')
        .select('month,artist,title,store,country,amount,currency,qty')
        .order('month',{ascending:true}).range(from,from+999)
      if(error||!data||!data.length) break
      all=all.concat(data)
      if(data.length<1000) break
      from+=1000
    }
    setRows(all)
    setLoading(false)
  }

  const months   = useMemo(()=>[...new Set(rows.map(r=>r.month))].sort(),[rows])
  const years    = useMemo(()=>[...new Set(months.map(m=>m.slice(0,4)))].sort().reverse(),[months])
  const lastM    = months[months.length-1]
  const prevM    = months[months.length-2]
  const filtered = useMemo(()=>yearFilter==='Tout'?rows:rows.filter(r=>r.month.startsWith(yearFilter)),[rows,yearFilter])

  const eur = r => toEur(r, eurRate)

  const totalEur = useMemo(()=>rows.reduce((s,r)=>s+eur(r),0),[rows,eurRate])
  const totalQty = useMemo(()=>rows.reduce((s,r)=>s+Number(r.qty||0),0),[rows])
  const lastEur  = useMemo(()=>rows.filter(r=>r.month===lastM).reduce((s,r)=>s+eur(r),0),[rows,lastM,eurRate])
  const prevEur  = useMemo(()=>rows.filter(r=>r.month===prevM).reduce((s,r)=>s+eur(r),0),[rows,prevM,eurRate])
  const lastQty  = useMemo(()=>rows.filter(r=>r.month===lastM).reduce((s,r)=>s+Number(r.qty||0),0),[rows,lastM])
  const prevQty  = useMemo(()=>rows.filter(r=>r.month===prevM).reduce((s,r)=>s+Number(r.qty||0),0),[rows,prevM])
  const dEur = deltaStr(lastEur,prevEur)
  const dQty = deltaStr(lastQty,prevQty)

  const monthlyData = useMemo(()=>{
    const ms=[...new Set(filtered.map(r=>r.month))].sort()
    return ms.map(m=>{
      const obj={month:m.slice(2)}
      allArtists.forEach(a=>{ obj[a]=Math.round(filtered.filter(r=>r.month===m&&r.artist===a).reduce((s,r)=>s+eur(r),0)) })
      obj['Total']=Math.round(filtered.filter(r=>r.month===m).reduce((s,r)=>s+eur(r),0))
      return obj
    })
  },[filtered,eurRate])

  const monthlyQtyData = useMemo(()=>{
    const ms=[...new Set(filtered.map(r=>r.month))].sort()
    return ms.map(m=>{
      const obj={month:m.slice(2)}
      allArtists.forEach(a=>{ obj[a]=filtered.filter(r=>r.month===m&&r.artist===a).reduce((s,r)=>s+Number(r.qty||0),0) })
      obj['Total']=filtered.filter(r=>r.month===m).reduce((s,r)=>s+Number(r.qty||0),0)
      return obj
    })
  },[filtered])

  const byArtist = useMemo(()=>allArtists.map(a=>({
    artist:a,
    eur:filtered.filter(r=>r.artist===a).reduce((s,r)=>s+eur(r),0),
    qty:filtered.filter(r=>r.artist===a).reduce((s,r)=>s+Number(r.qty||0),0),
  })).sort((a,b)=>b.eur-a.eur),[filtered,eurRate])

  const byTitle = useMemo(()=>{
    const m={},ma={}
    filtered.forEach(r=>{
      if(!m[r.title]){m[r.title]={eur:0,qty:0};ma[r.title]=r.artist}
      m[r.title].eur+=eur(r); m[r.title].qty+=Number(r.qty||0)
    })
    return Object.entries(m).sort((a,b)=>b[1].eur-a[1].eur).slice(0,10)
      .map(([t,v])=>({title:t,...v,artist:ma[t]}))
  },[filtered,eurRate])

  const byPlat = useMemo(()=>{
    const m={}
    filtered.forEach(r=>{
      if(!m[r.store])m[r.store]={eur:0,qty:0}
      m[r.store].eur+=eur(r); m[r.store].qty+=Number(r.qty||0)
    })
    return Object.entries(m).sort((a,b)=>b[1].eur-a[1].eur)
  },[filtered,eurRate])

  const yearlyData = useMemo(()=>years.map(y=>{
    const yr=rows.filter(r=>r.month.startsWith(y))
    return {year:y,eur:yr.reduce((s,r)=>s+eur(r),0),qty:yr.reduce((s,r)=>s+Number(r.qty||0),0)}
  }),[rows,years,eurRate])

  const maxArtistEur=Math.max(...byArtist.map(a=>a.eur),1)
  const maxPlatEur=Math.max(...byPlat.map(([,v])=>Math.abs(v.eur)),1)
  const platPie=byPlat.slice(0,8).map(([name,v],i)=>({name,value:Math.round(v.eur),color:PLAT_COLORS[i]}))

  if(loading) return (
    <div className="loading-screen"><div className="loading-spinner"/><span>Chargement…</span></div>
  )

  return (
    <div className="app">
      <MainNav title="Avlanche Music" showBack onBack={()=>router.push('/')}/>
      <div className="page">

        <div className="kpi-grid">
          <KPI label="Total royalties" value={fmtEur(totalEur)} sub={`${months.length} mois`}/>
          <KPI label="Total streams"   value={fmtStreams(totalQty)} sub={`${months.length} mois`}/>
          <KPI label={`Royalties ${lastM||'—'}`} value={fmtEur(lastEur)} sub={dEur?.str} subClass={dEur?.positive?'pos':'neg'}/>
          <KPI label={`Streams ${lastM||'—'}`}   value={fmtStreams(lastQty)} sub={dQty?.str} subClass={dQty?.positive?'pos':'neg'}/>
        </div>

        <div className="pills">
          {['Tout',...years].map(y=>(
            <button key={y} className={`pill ${yearFilter===y?'active':''}`} onClick={()=>setYearFilter(y)}>{y}</button>
          ))}
        </div>

        <div className="tabs">
          {TABS.map(t=>(
            <button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}
              style={tab===t?{borderBottomColor:'#f97316',color:'#eee'}:{}}>{t}</button>
          ))}
        </div>

        {tab==='Revenus'&&(
          <div>
            <div className="chart-label">Revenus mensuels par artiste (EUR)</div>
            <div style={{height:260}}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>'€'+Math.round(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}}
                    formatter={(v,n)=>[fmtEur(v),n]} labelStyle={{color:'#888'}}/>
                  <Legend wrapperStyle={{fontSize:11,color:'#666'}}/>
                  {allArtists.map(a=>(
                    <Line key={a} type="monotone" dataKey={a} stroke={COLORS[a]} strokeWidth={2}
                      dot={{r:2}} activeDot={{r:4}} connectNulls/>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {yearlyData.map(({year,eur:e,qty})=>(
                <div key={year} className="year-row">
                  <span className="year-label">{year}</span>
                  <span className="year-usd">{fmtEur(e)}</span>
                  <span className="year-qty">{fmtStreams(qty)} streams</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='Streams'&&(
          <div>
            <div className="chart-label">Streams mensuels par artiste</div>
            <div style={{height:260}}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyQtyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtStreams(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}}
                    formatter={(v,n)=>[fmtStreams(v),n]} labelStyle={{color:'#888'}}/>
                  <Legend wrapperStyle={{fontSize:11,color:'#666'}}/>
                  {allArtists.map(a=><Bar key={a} dataKey={a} stackId="a" fill={COLORS[a]}/>)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {yearlyData.map(({year,eur:e,qty})=>(
                <div key={year} className="year-row">
                  <span className="year-label">{year}</span>
                  <span className="year-usd">{fmtStreams(qty)} streams</span>
                  <span className="year-qty">{fmtEur(e)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='Artistes'&&(
          <div>
            <div className="chart-label">Royalties par artiste (EUR)</div>
            {byArtist.map(({artist,eur:e,qty})=>(
              <div key={artist} className="artist-row-click" onClick={()=>router.push(`/artist/${encodeURIComponent(artist)}`)}>
                <HBar name={artist} value={e} maxValue={maxArtistEur} color={COLORS[artist]}
                  formatVal={fmtEur} right={fmtStreams(qty)+' str'}/>
                <span className="row-arrow">→</span>
              </div>
            ))}
          </div>
        )}

        {tab==='Titres'&&(
          <div>
            <div className="chart-label">Top 10 titres — royalties (EUR)</div>
            {byTitle.map(({title,eur:e,qty,artist})=>(
              <HBar key={title}
                name={<span>{title.length>26?title.slice(0,24)+'…':title} <span className="badge">{artist}</span></span>}
                value={e} maxValue={byTitle[0]?.eur||1} color={COLORS[artist]||'#666'}
                formatVal={fmtEur} right={fmtStreams(qty)}/>
            ))}
          </div>
        )}

        {tab==='Plateformes'&&(
          <div>
            <div className="two-col">
              <div>
                <div className="chart-label">Royalties par plateforme (EUR)</div>
                {byPlat.map(([p,v],i)=>(
                  <HBar key={p} name={p} value={v.eur} maxValue={maxPlatEur}
                    color={PLAT_COLORS[i%PLAT_COLORS.length]} formatVal={fmtEur} right={fmtStreams(v.qty)}/>
                ))}
              </div>
              <div>
                <div className="chart-label">Répartition</div>
                <div style={{height:220}}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={platPie} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" stroke="none">
                        {platPie.map(({name,color})=><Cell key={name} fill={color}/>)}
                      </Pie>
                      <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:11}}
                        formatter={v=>[fmtEur(v)]}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="plat-legend">
                  {platPie.map(({name,color})=>(
                    <div key={name} className="plat-item"><span className="plat-dot" style={{background:color}}/>{name}</div>
                  ))}
                </div>
              </div>
            </div>
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
        .badge{display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;background:#1e1e1e;color:#555;margin-left:4px}
      `}</style>
    </div>
  )
}
