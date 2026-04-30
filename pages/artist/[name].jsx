import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, PieChart, Pie, Cell
} from 'recharts'
import { supabase } from '../../lib/supabase'
import { useRate } from '../../lib/rateContext'
import { COLORS, PLAT_COLORS, fmtAmount, fmtEur, fmt, fmtStreams, deltaStr, currencySymbol } from '../../lib/artists'
import MainNav from '../../components/MainNav'

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
  const display = formatVal ? formatVal(value) : (typeof value==='number'&&Math.abs(value)>999?fmtStreams(value):String(value))
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

const TABS = ['Revenus','Streams','Titres','Plateformes','Pays']

export default function ArtistPage() {
  const router = useRouter()
  const { name } = router.query
  const artist = name ? decodeURIComponent(name) : ''
  const color = COLORS[artist] || '#888'
  const { rate } = useRate()

  // Données agrégées (vue) — KPIs + graphiques Revenus/Streams
  const [viewRows, setViewRows] = useState([])
  const [loading, setLoading] = useState(true)

  // Données brutes — Titres, Plateformes, Pays (lazy)
  const [detailRows, setDetailRows] = useState([])
  const [detailYear, setDetailYear] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [tab, setTab] = useState('Revenus')
  const [yearFilter, setYearFilter] = useState('Tout')

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{if(!data.session)router.replace('/login')})
  },[])

  useEffect(()=>{ if(artist) fetchViewData() },[artist])

  // Charge la vue agrégée (quelques dizaines de lignes — instantané)
  async function fetchViewData() {
    setLoading(true)
    const { data, error } = await supabase
      .from('royalties_monthly')
      .select('month, amount_eur, amount_usd, qty, currency')
      .eq('artist', artist)
      .order('month', { ascending: true })
    setViewRows(error ? [] : (data || []))
    setLoading(false)
  }

  // Charge les lignes brutes à la demande (Titres/Plateformes/Pays)
  async function fetchDetailData(year) {
    if (detailYear === year && detailRows.length > 0) return
    setDetailLoading(true)
    let all=[], from=0
    let query = supabase.from('royalties')
      .select('month,title,store,country,amount,currency,qty')
      .eq('artist', artist)
    if (year !== 'Tout') query = query.like('month', `${year}-%`)
    while(true){
      const {data,error} = await query.range(from,from+999)
      if(error||!data?.length) break
      all=all.concat(data)
      if(data.length<1000) break
      from+=1000
    }
    setDetailRows(all)
    setDetailYear(year)
    setDetailLoading(false)
  }

  useEffect(()=>{
    if((tab==='Titres'||tab==='Plateformes'||tab==='Pays') && artist) {
      fetchDetailData(yearFilter)
    }
  },[tab, yearFilter, artist])

  // ── Devise native ──────────────────────────────────────────
  const { isMixed, currency } = useMemo(()=>{
    const hasEur = viewRows.some(r => Number(r.amount_eur||0) > 0)
    const hasUsd = viewRows.some(r => Number(r.amount_usd||0) > 0)
    const mixed = hasEur && hasUsd
    return { isMixed: mixed, currency: mixed ? 'EUR' : (viewRows[0]?.currency || 'USD') }
  },[viewRows])

  // Convertit une ligne de la vue dans la devise d'affichage
  const amtView = r => {
    const eur = Number(r.amount_eur||0)
    const usd = Number(r.amount_usd||0)
    if (currency === 'EUR') return eur + usd * rate
    return usd + eur / rate
  }

  // Convertit une ligne brute dans la devise d'affichage
  const amtDetail = r => {
    const a = Number(r.amount||0)
    if (isMixed) return r.currency === 'EUR' ? a : a * rate
    return a
  }

  const fmtNative = v => fmtAmount(v, currency)
  const sym = currencySymbol(currency)

  // ── Calculs sur la vue (Revenus, Streams, KPIs) ─────────────
  const months  = useMemo(()=>[...new Set(viewRows.map(r=>r.month))].sort(),[viewRows])
  const years   = useMemo(()=>[...new Set(months.map(m=>m.slice(0,4)))].sort().reverse(),[months])
  const filteredView = useMemo(()=>yearFilter==='Tout'?viewRows:viewRows.filter(r=>r.month.startsWith(yearFilter)),[viewRows,yearFilter])

  const lastM = months[months.length-1]
  const prevM = months[months.length-2]

  const totalAmt = useMemo(()=>viewRows.reduce((s,r)=>s+amtView(r),0),[viewRows,rate])
  const totalQty = useMemo(()=>viewRows.reduce((s,r)=>s+Number(r.qty||0),0),[viewRows])
  const lastAmt  = useMemo(()=>viewRows.filter(r=>r.month===lastM).reduce((s,r)=>s+amtView(r),0),[viewRows,lastM,rate])
  const prevAmt  = useMemo(()=>viewRows.filter(r=>r.month===prevM).reduce((s,r)=>s+amtView(r),0),[viewRows,prevM,rate])
  const lastQty  = useMemo(()=>viewRows.filter(r=>r.month===lastM).reduce((s,r)=>s+Number(r.qty||0),0),[viewRows,lastM])
  const prevQty  = useMemo(()=>viewRows.filter(r=>r.month===prevM).reduce((s,r)=>s+Number(r.qty||0),0),[viewRows,prevM])
  const dAmt = deltaStr(lastAmt,prevAmt)
  const dQty = deltaStr(lastQty,prevQty)

  const monthlyData = useMemo(()=>{
    const ms=[...new Set(filteredView.map(r=>r.month))].sort()
    return ms.map(m=>({
      month:m.slice(2),
      amt:Math.round(filteredView.filter(r=>r.month===m).reduce((s,r)=>s+amtView(r),0)),
      qty:filteredView.filter(r=>r.month===m).reduce((s,r)=>s+Number(r.qty||0),0),
    }))
  },[filteredView,rate])

  // ── Calculs sur les données brutes (Titres, Plateformes, Pays) ─
  const filteredDetail = useMemo(()=>yearFilter==='Tout'?detailRows:detailRows.filter(r=>r.month.startsWith(yearFilter)),[detailRows,yearFilter])

  const byTitle = useMemo(()=>{
    const m={}
    filteredDetail.forEach(r=>{
      if(!m[r.title])m[r.title]={amt:0,qty:0}
      m[r.title].amt+=amtDetail(r); m[r.title].qty+=Number(r.qty||0)
    })
    return Object.entries(m).sort((a,b)=>b[1].amt-a[1].amt)
  },[filteredDetail,rate])

  const byPlat = useMemo(()=>{
    const m={}
    filteredDetail.forEach(r=>{
      if(!m[r.store])m[r.store]={amt:0,qty:0}
      m[r.store].amt+=amtDetail(r); m[r.store].qty+=Number(r.qty||0)
    })
    return Object.entries(m).sort((a,b)=>b[1].amt-a[1].amt)
  },[filteredDetail,rate])

  const byCountry = useMemo(()=>{
    const m={}
    filteredDetail.forEach(r=>{
      if(!r.country)return
      if(!m[r.country])m[r.country]={amt:0,qty:0}
      m[r.country].amt+=amtDetail(r); m[r.country].qty+=Number(r.qty||0)
    })
    return Object.entries(m).sort((a,b)=>b[1].qty-a[1].qty).slice(0,15)
  },[filteredDetail,rate])

  const maxTitleAmt=Math.max(...byTitle.map(([,v])=>Math.abs(v.amt)),1)
  const maxTitleQty=Math.max(...byTitle.map(([,v])=>v.qty),1)
  const maxPlatAmt =Math.max(...byPlat.map(([,v])=>Math.abs(v.amt)),1)
  const maxCountryQty=Math.max(...byCountry.map(([,v])=>v.qty),1)
  const platPie=byPlat.slice(0,8).map(([name,v],i)=>({name,value:Math.round(v.amt),color:PLAT_COLORS[i]}))

  // yearly breakdown depuis la vue
  const yearlyData = useMemo(()=>years.map(y=>{
    const yr=viewRows.filter(r=>r.month.startsWith(y))
    return { y, amt: yr.reduce((s,r)=>s+amtView(r),0), qty: yr.reduce((s,r)=>s+Number(r.qty||0),0) }
  }),[viewRows,years,rate])

  if(loading) return (
    <div className="loading-screen">
      <div className="loading-spinner" style={{borderTopColor:color}}/>
      <span>Chargement…</span>
    </div>
  )

  return (
    <div className="app">
      <MainNav title={artist} showBack onBack={()=>router.push('/')} />
      <div className="page">

        <div className="kpi-grid">
          <KPI label="Total royalties"          value={fmtNative(totalAmt)}   sub={`${months.length} mois`}/>
          <KPI label="Total streams"             value={fmtStreams(totalQty)}   sub={`${months.length} mois`}/>
          <KPI label={`Royalties ${lastM||'—'}`} value={fmtNative(lastAmt)}    sub={dAmt?.str} subClass={dAmt?.positive?'pos':'neg'}/>
          <KPI label={`Streams ${lastM||'—'}`}   value={fmtStreams(lastQty)}   sub={dQty?.str} subClass={dQty?.positive?'pos':'neg'}/>
        </div>

        <div className="pills">
          {['Tout',...years].map(y=>(
            <button key={y} className={`pill ${yearFilter===y?'active':''}`} onClick={()=>setYearFilter(y)}>{y}</button>
          ))}
        </div>

        <div className="tabs">
          {TABS.map(t=>(
            <button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}
              style={tab===t?{borderBottomColor:color,color:'#eee'}:{}}>{t}</button>
          ))}
        </div>

        {tab==='Revenus'&&(
          <div>
            <div className="chart-label">Revenus mensuels ({currency})</div>
            <div style={{height:240}}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={color} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>sym+Math.round(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}}
                    formatter={v=>[fmtNative(v),'Royalties']} labelStyle={{color:'#888'}}/>
                  <Area type="monotone" dataKey="amt" stroke={color} strokeWidth={2} fill="url(#grad)"
                    dot={{r:2,fill:color}} activeDot={{r:4}}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {yearlyData.map(({y,amt:a,qty})=>(
                <div key={y} className="year-row">
                  <span className="year-label">{y}</span>
                  <span className="year-usd" style={{color}}>{fmtNative(a)}</span>
                  <span className="year-qty">{fmtStreams(qty)} streams</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='Streams'&&(
          <div>
            <div className="chart-label">Streams mensuels</div>
            <div style={{height:240}}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{top:8,right:8,left:-10,bottom:0}}>
                  <XAxis dataKey="month" tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:'#444',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtStreams(v)}/>
                  <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:12}}
                    formatter={v=>[fmtStreams(v),'Streams']} labelStyle={{color:'#888'}}/>
                  <Bar dataKey="qty" fill={color} radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="yearly-breakdown">
              {yearlyData.map(({y,amt:a,qty})=>(
                <div key={y} className="year-row">
                  <span className="year-label">{y}</span>
                  <span className="year-usd" style={{color}}>{fmtStreams(qty)} streams</span>
                  <span className="year-qty">{fmtNative(a)}</span>
                return (
                  <div key={y} className="year-row">
                    <span className="year-label">{y}</span>
                    <span className="year-usd" style={{color}}>{fmtStreams(qty)} streams</span>
                    <span className="year-qty">{fmtNative(a)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab==='Titres'&&(
          <div>
            {detailLoading ? (
              <div style={{textAlign:'center',padding:'40px 0',color:'#444'}}>
                <div className="detail-spinner" style={{borderTopColor:color}}/>
                Chargement…
              </div>
            ) : (
            <div className="two-col">
              <div>
                <div className="plat-table-header">
                  <span className="pt-name">Titre</span>
                  <span className="pt-bar"/>
                  <span className="pt-streams">Streams</span>
                  <span className="pt-rev">Revenus</span>
                </div>
                {byTitle.map(([t,v])=>{
                  const w = maxTitleAmt > 0 ? Math.min(Math.abs(v.amt)/maxTitleAmt*100,100) : 0
                  return (
                    <div key={t} className="plat-row">
                      <span className="pt-name">{t.length>20?t.slice(0,18)+'…':t}</span>
                      <div className="pt-bar">
                        <div style={{width:`${w}%`,height:'100%',background:color,borderRadius:2,minWidth:3}}/>
                      </div>
                      <span className="pt-streams">{fmtStreams(v.qty)}</span>
                      <span className="pt-rev" style={{color}}>{fmtNative(v.amt)}</span>
                    </div>
                  )
                })}
              </div>
              <div>
                <div className="plat-table-header">
                  <span className="pt-name">Titre</span>
                  <span className="pt-bar"/>
                  <span className="pt-streams">Revenus</span>
                  <span className="pt-rev">Streams</span>
                </div>
                {[...byTitle].sort((a,b)=>b[1].qty-a[1].qty).slice(0,10).map(([t,v])=>{
                  const w = maxTitleQty > 0 ? Math.min(v.qty/maxTitleQty*100,100) : 0
                  return (
                    <div key={t} className="plat-row">
                      <span className="pt-name">{t.length>20?t.slice(0,18)+'…':t}</span>
                      <div className="pt-bar">
                        <div style={{width:`${w}%`,height:'100%',background:color,borderRadius:2,minWidth:3}}/>
                      </div>
                      <span className="pt-streams">{fmtNative(v.amt)}</span>
                      <span className="pt-rev" style={{color}}>{fmtStreams(v.qty)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            )}
          </div>
        )}

        {tab==='Plateformes'&&(
          <div>
            {detailLoading ? (
              <div style={{textAlign:'center',padding:'40px 0',color:'#444'}}>
                <div className="detail-spinner" style={{borderTopColor:color}}/>
                Chargement…
              </div>
            ) : (<>
            {/* Donut chart compact en haut */}
            <div style={{display:'flex',gap:20,alignItems:'center',marginBottom:20}}>
              <div style={{width:140,height:140,flexShrink:0}}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={platPie} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
                      {platPie.map(({name,color:c})=><Cell key={name} fill={c}/>)}
                    </Pie>
                    <Tooltip contentStyle={{background:'#1a1a1a',border:'1px solid #222',borderRadius:6,fontSize:11}}
                      formatter={v=>[fmtNative(v)]}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="plat-legend-inline">
                {platPie.map(({name,color:c},i)=>(
                  <div key={name} className="plat-legend-item">
                    <span className="plat-dot" style={{background:c}}/>
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tableau compact — tout sur une ligne */}
            <div className="plat-table-header">
              <span className="pt-name">Plateforme</span>
              <span className="pt-bar" />
              <span className="pt-streams">Streams</span>
              <span className="pt-rev">Revenus</span>
            </div>
            {byPlat.map(([p,v],i)=>{
              const w = maxPlatAmt > 0 ? Math.min(Math.abs(v.amt)/maxPlatAmt*100,100) : 0
              const c = PLAT_COLORS[i%PLAT_COLORS.length]
              return (
                <div key={p} className="plat-row">
                  <span className="pt-name">{p.length>20?p.slice(0,18)+'…':p}</span>
                  <div className="pt-bar">
                    <div style={{width:`${w}%`,height:'100%',background:c,borderRadius:2,minWidth:3}}/>
                  </div>
                  <span className="pt-streams">{fmtStreams(v.qty)}</span>
                  <span className="pt-rev" style={{color:c}}>{fmtNative(v.amt)}</span>
                </div>
              )
            })}
            </>)}
          </div>
        )}

        {tab==='Pays'&&(
          <div>
            {detailLoading ? (
              <div style={{textAlign:'center',padding:'40px 0',color:'#444'}}>
                <div className="detail-spinner" style={{borderTopColor:color}}/>
                Chargement…
              </div>
            ) : (<>
            <div className="plat-table-header">
              <span className="pt-name">Pays</span>
              <span className="pt-bar"/>
              <span className="pt-streams">Streams</span>
              <span className="pt-rev">Revenus</span>
            </div>
            {byCountry.map(([c,v])=>{
              const w = maxCountryQty > 0 ? Math.min(v.qty/maxCountryQty*100,100) : 0
              return (
                <div key={c} className="plat-row">
                  <span className="pt-name">{c||'—'}</span>
                  <div className="pt-bar">
                    <div style={{width:`${w}%`,height:'100%',background:color,borderRadius:2,minWidth:3}}/>
                  </div>
                  <span className="pt-streams">{fmtStreams(v.qty)}</span>
                  <span className="pt-rev" style={{color}}>{fmtNative(v.amt)}</span>
                </div>
              )
            })}
            </>)}
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
        .pill{padding:4px 13px;border-radius:20px;border:1px solid #1e1e1e;cursor:pointer;font-size:12px;color:#555;background:transparent;transition:all .2s;font-family:inherit}
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
        .yearly-breakdown{margin-top:20px;border-top:1px solid #1a1a1a;padding-top:16px;display:flex;flex-direction:column;gap:8px}
        .year-row{display:flex;align-items:center;gap:12px}
        .year-label{width:40px;font-size:12px;color:#555;font-weight:600}
        .year-usd{font-size:14px;font-weight:700;flex:1}
        .year-qty{font-size:12px;color:#444}
        .plat-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px;font-size:11px;color:#888}
        .plat-item{display:flex;align-items:center;gap:4px}
        .plat-dot{width:7px;height:7px;border-radius:2px;flex-shrink:0}
        .detail-spinner{width:22px;height:22px;border:2px solid #1e1e1e;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 10px}
        @keyframes spin{to{transform:rotate(360deg)}}
        .plat-legend-inline{display:flex;flex-wrap:wrap;gap:4px 14px;align-content:flex-start}
        .plat-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:#888}
        .plat-table-header{display:grid;grid-template-columns:120px 1fr 64px 80px;gap:8px;padding:4px 0 6px;border-bottom:1px solid #1e1e1e;margin-bottom:4px}
        .plat-table-header span{font-size:9px;color:#444;text-transform:uppercase;letter-spacing:1px}
        .pt-streams{text-align:right}.pt-rev{text-align:right}
        .plat-row{display:grid;grid-template-columns:120px 1fr 64px 80px;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #141414}
        .plat-row:hover{background:#1a1a1a;border-radius:4px}
        .pt-name{font-size:12px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pt-bar{height:6px;background:#1a1a1a;border-radius:2px;overflow:hidden}
        .pt-streams{font-size:11px;color:#555;text-align:right}
        .pt-rev{font-size:12px;font-weight:700;text-align:right}
      `}</style>
    </div>
  )
}
