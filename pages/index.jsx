import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import {
  ARTISTS, COLORS, ARTIST_SOURCES,
  fmt, fmtEur, fmtAmount, fmtStreams, deltaStr
} from '../lib/artists'
import ImportModal from '../components/ImportModal'
import MainNav from '../components/MainNav'
import AddArtistModal from '../components/AddArtistModal'

export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [artistStats, setArtistStats] = useState({})
  const [importTarget, setImportTarget] = useState(null)
  const [dynamicArtists, setDynamicArtists] = useState(null)
  const [showAddArtist, setShowAddArtist] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/login'); return }
      setUser(data.session.user)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.replace('/login')
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) { loadAll() }
  }, [user])

  async function loadAll() {
    // Fetch artists FIRST, then pass the result directly to fetchStats
    // (ne pas dépendre du state dynamicArtists qui n'est pas encore mis à jour)
    const { data: artistData } = await supabase.from('artists').select('name, color, sources').order('created_at')
    if (artistData?.length) setDynamicArtists(artistData)
    await fetchStats(artistData)
  }

  async function fetchStats(artistData) {
    setLoading(true)
    const { data: rateSetting } = await supabase.from('settings').select('value').eq('key', 'eur_rate').single()
    const rate = rateSetting ? parseFloat(rateSetting.value) : 0.92

    let data = [], from = 0
    while (true) {
      const { data: chunk, error } = await supabase
        .from('royalties_monthly')
        .select('month, artist, amount_eur, amount_usd, qty, currency')
        .order('month', { ascending: false })
        .range(from, from + 999)
      if (error || !chunk?.length) break
      data = data.concat(chunk)
      if (chunk.length < 1000) break
      from += 1000
    }
    if (!data.length) { setLoading(false); return }

    const stats = {}
    const resolved = artistData || dynamicArtists
    const artistList = (resolved || []).map(a => a.name)
    for (const artist of artistList.length ? artistList : ARTISTS) {
      const ar = data.filter(r => r.artist === artist)
      const months = [...new Set(ar.map(r => r.month))].sort().reverse()
      const lastM = months[0], prevM = months[1]
      const hasEur = ar.some(r => Number(r.amount_eur||0) !== 0)
      const hasUsd = ar.some(r => Number(r.amount_usd||0) !== 0)
      const isMixed = hasEur && hasUsd
      const currency = isMixed ? 'EUR' : (ar[0]?.currency || 'USD')
      const native = (r) => isMixed
        ? Number(r.amount_eur||0) + Number(r.amount_usd||0) * rate
        : currency === 'EUR' ? Number(r.amount_eur||0) : Number(r.amount_usd||0)
      const lastAmount  = ar.filter(r=>r.month===lastM).reduce((s,r)=>s+native(r),0)
      const prevAmount  = ar.filter(r=>r.month===prevM).reduce((s,r)=>s+native(r),0)
      const totalAmount = ar.reduce((s,r)=>s+native(r),0)
      const lastQty  = ar.filter(r=>r.month===lastM).reduce((s,r)=>s+Number(r.qty||0),0)
      const prevQty  = ar.filter(r=>r.month===prevM).reduce((s,r)=>s+Number(r.qty||0),0)
      const totalQty = ar.reduce((s,r)=>s+Number(r.qty||0),0)

      // EUR (pour la carte label)
      const eurVal = (r) => Number(r.amount_eur||0) + Number(r.amount_usd||0) * rate
      const lastEur  = ar.filter(r=>r.month===lastM).reduce((s,r)=>s+eurVal(r),0)
      const prevEur  = ar.filter(r=>r.month===prevM).reduce((s,r)=>s+eurVal(r),0)
      const totalEur = ar.reduce((s,r)=>s+eurVal(r),0)

      stats[artist] = {
        lastMonth: lastM, currency,
        lastAmount, prevAmount, totalAmount,
        lastEur, prevEur, totalEur,
        lastQty, prevQty, totalQty,
        deltaAmount: deltaStr(lastAmount, prevAmount),
        deltaQty:    deltaStr(lastQty, prevQty),
        hasData: ar.length > 0,
      }
    }

    setArtistStats(stats)
    const latest = [...new Set(data.map(r=>r.month))].sort().reverse()[0]
    if (latest) setLastUpdated(latest)
    setLoading(false)
  }

  return (
    <div className="app">
      <MainNav />
      <div className="page">
        <div className="page-header">
          <h1>Tableau de bord</h1>
          <p className="page-sub">Royalties & streams par artiste</p>
        </div>

        {loading ? (
          <div className="loading-grid">
            <div className="artist-card skeleton full-width" />
            {ARTISTS.map(a => <div key={a} className="artist-card skeleton" />)}
          </div>
        ) : (<>

          {/* CARTE LABEL en EUR */}
          {(() => {
            const labelStats = Object.values(artistStats)
            const totalEur = labelStats.reduce((s,v)=>s+(v.totalEur||0),0)
            const totalQty = labelStats.reduce((s,v)=>s+(v.totalQty||0),0)
            const lastEur  = labelStats.reduce((s,v)=>s+(v.lastEur||0),0)
            const prevEur  = labelStats.reduce((s,v)=>s+(v.prevEur||0),0)
            const lastQty  = labelStats.reduce((s,v)=>s+(v.lastQty||0),0)
            const prevQty  = labelStats.reduce((s,v)=>s+(v.prevQty||0),0)
            const dEur = deltaStr(lastEur, prevEur)
            const dQty = deltaStr(lastQty, prevQty)
            return (
              <div className="artist-card label-card" onClick={()=>router.push('/label')}>
                <div className="ac-top">
                  <div className="ac-dot" style={{background:'linear-gradient(135deg,#3b82f6,#f97316,#eab308,#a78bfa)'}}/>
                  <div className="ac-name">Avlanche Music</div>
                  {lastUpdated && <div className="ac-month">{lastUpdated}</div>}
                </div>
                <div className="ac-stats label-stats">
                  <div className="ac-stat">
                    <div className="ac-stat-label">Royalties ce mois</div>
                    <div className="ac-stat-val" style={{color:'#fff'}}>{fmtEur(lastEur)}</div>
                    {dEur && <div className={`ac-delta ${dEur.positive?'pos':'neg'}`}>{dEur.str}</div>}
                  </div>
                  <div className="ac-stat">
                    <div className="ac-stat-label">Streams ce mois</div>
                    <div className="ac-stat-val">{fmtStreams(lastQty)}</div>
                    {dQty && <div className={`ac-delta ${dQty.positive?'pos':'neg'}`}>{dQty.str}</div>}
                  </div>
                  <div className="ac-stat">
                    <div className="ac-stat-label">Total royalties</div>
                    <div className="ac-stat-val" style={{color:'#fff'}}>{fmtEur(totalEur)}</div>
                  </div>
                  <div className="ac-stat">
                    <div className="ac-stat-label">Total streams</div>
                    <div className="ac-stat-val">{fmtStreams(totalQty)}</div>
                  </div>
                </div>
                <div className="ac-footer">
                  <div className="label-artists-dots">
                    {ARTISTS.map(a=><span key={a} className="mini-dot" style={{background:COLORS[a]}}/>)}
                  </div>
                  <span className="ac-arrow">→</span>
                </div>
              </div>
            )
          })()}

          {/* GRILLE ARTISTES — devise native par artiste */}
          <div className="artist-grid">
            {(dynamicArtists||ARTISTS.map(a=>({name:a,color:COLORS[a],sources:ARTIST_SOURCES[a]||['distrokid']})))
              .slice()
              .sort((a,b)=>{
                const na=typeof a==='string'?a:a.name, nb=typeof b==='string'?b:b.name
                return (artistStats[nb]?.totalEur||0)-(artistStats[na]?.totalEur||0)
              })
              .map(artistObj=>{
                const artist = typeof artistObj==='string'?artistObj:artistObj.name
                const s = artistStats[artist]||{}
                const color = typeof artistObj==='string'?COLORS[artist]:(artistObj.color||COLORS[artist]||'#888')
                const currency = s.currency||'USD'
                return (
                  <div key={artist} className="artist-card" onClick={()=>router.push(`/artist/${encodeURIComponent(artist)}`)}>
                    <div className="ac-top">
                      <div className="ac-dot" style={{background:color}}/>
                      <div className="ac-name">{artist}</div>
                      {s.lastMonth && <div className="ac-month">{s.lastMonth}</div>}
                    </div>
                    {s.hasData ? (<>
                      <div className="ac-stats">
                        <div className="ac-stat">
                          <div className="ac-stat-label">Royalties ce mois</div>
                          <div className="ac-stat-val" style={{color}}>{fmtAmount(s.lastAmount,currency)}</div>
                          {s.deltaAmount && <div className={`ac-delta ${s.deltaAmount.positive?'pos':'neg'}`}>{s.deltaAmount.str}</div>}
                        </div>
                        <div className="ac-stat">
                          <div className="ac-stat-label">Streams ce mois</div>
                          <div className="ac-stat-val">{fmtStreams(s.lastQty)}</div>
                          {s.deltaQty && <div className={`ac-delta ${s.deltaQty.positive?'pos':'neg'}`}>{s.deltaQty.str}</div>}
                        </div>
                      </div>
                      <div className="ac-totals">
                        <span>Total : {fmtAmount(s.totalAmount,currency)}</span>
                        <span>{fmtStreams(s.totalQty)} streams</span>
                      </div>
                    </>) : (
                      <div className="ac-nodata">Aucune donnée</div>
                    )}
                    <div className="ac-footer">
                      {((typeof artistObj==='object'?artistObj.sources:ARTIST_SOURCES[artist])||['distrokid']).map(source=>(
                        <button key={source} className="btn-import-small"
                          style={{borderColor:color+'44',color}}
                          onClick={e=>{e.stopPropagation();setImportTarget({artist,source})}}>
                          ↑ {source==='distrokid'?'DistroKid':source==='tunecore'?'TuneCore':'Warner'}
                        </button>
                      ))}
                      <span className="ac-arrow">→</span>
                    </div>
                  </div>
                )
              })}

            <div className="artist-card add-artist-card" onClick={()=>setShowAddArtist(true)}>
              <div className="add-icon">+</div>
              <div className="add-label">Ajouter un artiste</div>
              <div className="add-sub">Importer ses CSV DistroKid, TuneCore…</div>
            </div>
          </div>
        </>)}
      </div>

      {importTarget && (
        <ImportModal artist={importTarget.artist} source={importTarget.source}
          onClose={()=>setImportTarget(null)} onSuccess={()=>{setImportTarget(null);loadAll()}} />
      )}

      <style jsx>{`
        .page-header{margin-bottom:20px} h1{font-size:24px;font-weight:700;color:#eee;margin-bottom:4px} .page-sub{font-size:13px;color:#444}
        .label-card{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:20px;margin-bottom:16px}
        .artist-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
        @media(max-width:600px){.artist-grid{grid-template-columns:1fr}}
        .loading-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
        .skeleton{height:200px;background:#141414;border-radius:10px;animation:pulse 1.5s ease infinite}
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
        .artist-card{background:#141414;border:1px solid #1e1e1e;border-radius:10px;padding:18px;cursor:pointer;transition:border-color .2s,transform .15s;display:flex;flex-direction:column;gap:14px}
        .add-artist-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:120px;border:1.5px dashed #1e1e1e !important}
        .add-artist-card:hover{border-color:#444 !important}
        .add-icon{font-size:24px;font-weight:300;color:#444;line-height:1}
        .add-label{font-size:14px;font-weight:700;color:#555}
        .add-sub{font-size:11px;color:#333;text-align:center}
        .artist-card:hover{border-color:#2a2a2a;transform:translateY(-1px)}
        .ac-top{display:flex;align-items:center;gap:9px}
        .ac-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
        .ac-name{font-size:16px;font-weight:700;color:#eee;flex:1}
        .ac-month{font-size:11px;color:#333}
        .ac-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .ac-stat-label{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
        .ac-stat-val{font-size:20px;font-weight:700;line-height:1;margin-bottom:3px}
        .ac-delta{font-size:12px;font-weight:600}
        .pos{color:#6ee7b7} .neg{color:#f87171}
        .ac-totals{display:flex;justify-content:space-between;font-size:11px;color:#333;padding-top:10px;border-top:1px solid #1a1a1a}
        .ac-nodata{font-size:13px;color:#333;padding:16px 0}
        .ac-footer{display:flex;align-items:center;gap:8px}
        .btn-import-small{background:transparent;border:1px solid;border-radius:5px;font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer;transition:opacity .2s;font-family:inherit}
        .btn-import-small:hover{opacity:.7}
        .ac-arrow{margin-left:auto;color:#333;font-size:14px}
        .full-width{grid-column:1/-1}
        .label-stats{grid-template-columns:repeat(4,1fr) !important}
        @media(max-width:600px){.label-stats{grid-template-columns:repeat(2,1fr) !important}}
        .label-artists-dots{display:flex;gap:5px;align-items:center}
        .mini-dot{width:7px;height:7px;border-radius:50%;display:inline-block}
      `}</style>
    </div>
  )
}
