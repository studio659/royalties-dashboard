import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS, ARTIST_SOURCES, fmt, fmtStreams, deltaStr } from '../lib/artists'
import ImportModal from '../components/ImportModal'
import MainNav from '../components/MainNav'

export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [artistStats, setArtistStats] = useState({})
  const [importTarget, setImportTarget] = useState(null) // { artist, source }
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
    if (user) fetchStats()
  }, [user])

  async function fetchStats() {
    setLoading(true)
    // Fetch last 2 months per artist efficiently
    const { data, error } = await supabase
      .from('royalties')
      .select('month, artist, usd, qty')
      .order('month', { ascending: false })

    if (error || !data) { setLoading(false); return }

    const stats = {}
    for (const artist of ARTISTS) {
      const ar = data.filter(r => r.artist === artist)
      const months = [...new Set(ar.map(r => r.month))].sort().reverse()
      const lastM = months[0], prevM = months[1]

      const lastUsd = ar.filter(r => r.month === lastM).reduce((s,r) => s+r.usd, 0)
      const prevUsd = ar.filter(r => r.month === prevM).reduce((s,r) => s+r.usd, 0)
      const lastQty = ar.filter(r => r.month === lastM).reduce((s,r) => s+r.qty, 0)
      const prevQty = ar.filter(r => r.month === prevM).reduce((s,r) => s+r.qty, 0)
      const totalUsd = ar.reduce((s,r) => s+r.usd, 0)
      const totalQty = ar.reduce((s,r) => s+r.qty, 0)

      stats[artist] = {
        lastMonth: lastM,
        lastUsd, prevUsd,
        lastQty, prevQty,
        totalUsd, totalQty,
        deltaUsd: deltaStr(lastUsd, prevUsd),
        deltaQty: deltaStr(lastQty, prevQty),
        hasData: ar.length > 0,
      }
    }

    setArtistStats(stats)
    if (data.length > 0) {
      const latest = [...new Set(data.map(r => r.month))].sort().reverse()[0]
      setLastUpdated(latest)
    }
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
        ) : (
          <>
          {/* LABEL CARD */}
          {(() => {
            const total = Object.values(artistStats).reduce((s,v) => s + (v.totalUsd||0), 0)
            const totalQty = Object.values(artistStats).reduce((s,v) => s + (v.totalQty||0), 0)
            const lastUsd = Object.values(artistStats).reduce((s,v) => s + (v.lastUsd||0), 0)
            const prevUsd = Object.values(artistStats).reduce((s,v) => s + (v.prevUsd||0), 0)
            const lastQty = Object.values(artistStats).reduce((s,v) => s + (v.lastQty||0), 0)
            const prevQty = Object.values(artistStats).reduce((s,v) => s + (v.prevQty||0), 0)
            const dUsd = deltaStr(lastUsd, prevUsd)
            const dQty = deltaStr(lastQty, prevQty)
            return (
              <div className="artist-card label-card" onClick={() => router.push('/label')}>
                <div className="ac-top">
                  <div className="ac-dot" style={{ background: 'linear-gradient(135deg, #3b82f6, #f97316, #eab308, #a78bfa)' }} />
                  <div className="ac-name">Avlanche Music</div>
                  {lastUpdated && <div className="ac-month">{lastUpdated}</div>}
                </div>
                <div className="ac-stats label-stats">
                  <div className="ac-stat">
                    <div className="ac-stat-label">Royalties ce mois</div>
                    <div className="ac-stat-val" style={{ color: '#fff' }}>{fmt(lastUsd)}</div>
                    {dUsd && <div className={`ac-delta ${dUsd.positive ? 'pos' : 'neg'}`}>{dUsd.str}</div>}
                  </div>
                  <div className="ac-stat">
                    <div className="ac-stat-label">Streams ce mois</div>
                    <div className="ac-stat-val">{fmtStreams(lastQty)}</div>
                    {dQty && <div className={`ac-delta ${dQty.positive ? 'pos' : 'neg'}`}>{dQty.str}</div>}
                  </div>
                  <div className="ac-stat">
                    <div className="ac-stat-label">Total royalties</div>
                    <div className="ac-stat-val" style={{ color: '#fff' }}>{fmt(total)}</div>
                  </div>
                  <div className="ac-stat">
                    <div className="ac-stat-label">Total streams</div>
                    <div className="ac-stat-val">{fmtStreams(totalQty)}</div>
                  </div>
                </div>
                <div className="ac-footer">
                  <div className="label-artists-dots">
                    {ARTISTS.map(a => <span key={a} className="mini-dot" style={{ background: COLORS[a] }} />)}
                  </div>
                  <span className="ac-arrow">→</span>
                </div>
              </div>
            )
          })()}

          {/* ARTIST GRID */}
          <div className="artist-grid">
            {ARTISTS.map(artist => {
              const s = artistStats[artist] || {}
              const color = COLORS[artist]
              return (
                <div
                  key={artist}
                  className="artist-card"
                  onClick={() => router.push(`/artist/${encodeURIComponent(artist)}`)}
                >
                  <div className="ac-top">
                    <div className="ac-dot" style={{ background: color }} />
                    <div className="ac-name">{artist}</div>
                    {s.lastMonth && <div className="ac-month">{s.lastMonth}</div>}
                  </div>

                  {s.hasData ? (
                    <>
                      <div className="ac-stats">
                        <div className="ac-stat">
                          <div className="ac-stat-label">Royalties ce mois</div>
                          <div className="ac-stat-val" style={{ color }}>{fmt(s.lastUsd)}</div>
                          {s.deltaUsd && (
                            <div className={`ac-delta ${s.deltaUsd.positive ? 'pos' : 'neg'}`}>
                              {s.deltaUsd.str}
                            </div>
                          )}
                        </div>
                        <div className="ac-stat">
                          <div className="ac-stat-label">Streams ce mois</div>
                          <div className="ac-stat-val">{fmtStreams(s.lastQty)}</div>
                          {s.deltaQty && (
                            <div className={`ac-delta ${s.deltaQty.positive ? 'pos' : 'neg'}`}>
                              {s.deltaQty.str}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="ac-totals">
                        <span>Total : {fmt(s.totalUsd)}</span>
                        <span>{fmtStreams(s.totalQty)} streams</span>
                      </div>
                    </>
                  ) : (
                    <div className="ac-nodata">Aucune donnée</div>
                  )}

                  <div className="ac-footer">
                    {(ARTIST_SOURCES[artist] || ['distrokid']).map(source => (
                      <button
                        key={source}
                        className="btn-import-small"
                        style={{ borderColor: color + '44', color }}
                        onClick={e => { e.stopPropagation(); setImportTarget({ artist, source }) }}
                      >
                        ↑ {source === 'distrokid' ? 'DistroKid' : source === 'tunecore' ? 'TuneCore' : 'Warner'}
                      </button>
                    ))}
                    <span className="ac-arrow">→</span>
                  </div>
                </div>
              )
            })}
          </div>
          </>
        )}
      </div>

      {importTarget && (
        <ImportModal
          artist={importTarget.artist}
          source={importTarget.source}
          onClose={() => setImportTarget(null)}
          onSuccess={() => { setImportTarget(null); fetchStats() }}
        />
      )}

      <style jsx>{`
        .page-header { margin-bottom: 20px; }
        h1 { font-size: 24px; font-weight: 700; color: #eee; margin-bottom: 4px; }
        .page-sub { font-size: 13px; color: #444; }

        .label-card {
          background: #141414;
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 16px;
        }
        .lc-top { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
        .lc-logo {
          width: 28px; height: 28px; border-radius: 6px;
          background: #f97316; color: #fff;
          font-size: 14px; font-weight: 800;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .lc-name { font-size: 16px; font-weight: 700; color: #eee; flex: 1; }
        .lc-month { font-size: 11px; color: #333; }
        .lc-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
        @media(max-width: 600px) { .lc-stats { grid-template-columns: repeat(2, 1fr); } }
        .lc-stat-label { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
        .lc-stat-val { font-size: 22px; font-weight: 700; color: #eee; line-height: 1; margin-bottom: 3px; }
        .lc-delta { font-size: 12px; font-weight: 600; }

        .artist-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        @media(max-width: 600px) { .artist-grid { grid-template-columns: 1fr; } }
        .loading-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
        .skeleton { height: 200px; background: #141414; border-radius: 10px; animation: pulse 1.5s ease infinite; }
        @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
        .artist-card {
          background: #141414; border: 1px solid #1e1e1e; border-radius: 10px;
          padding: 18px; cursor: pointer; transition: border-color .2s, transform .15s;
          display: flex; flex-direction: column; gap: 14px;
        }
        .artist-card:hover { border-color: #2a2a2a; transform: translateY(-1px); }
        .ac-top { display: flex; align-items: center; gap: 9px; }
        .ac-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .ac-name { font-size: 16px; font-weight: 700; color: #eee; flex: 1; }
        .ac-month { font-size: 11px; color: #333; }
        .ac-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .ac-stat { }
        .ac-stat-label { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
        .ac-stat-val { font-size: 20px; font-weight: 700; line-height: 1; margin-bottom: 3px; }
        .ac-delta { font-size: 12px; font-weight: 600; }
        .pos { color: #6ee7b7; }
        .neg { color: #f87171; }
        .ac-totals { display: flex; justify-content: space-between; font-size: 11px; color: #333; padding-top: 10px; border-top: 1px solid #1a1a1a; }
        .ac-nodata { font-size: 13px; color: #333; padding: 16px 0; }
        .ac-footer { display: flex; align-items: center; gap: 8px; }
        .btn-import-small {
          background: transparent; border: 1px solid; border-radius: 5px;
          font-size: 11px; font-weight: 600; padding: 4px 10px; cursor: pointer;
          transition: opacity .2s; font-family: inherit;
        }
        .btn-import-small:hover { opacity: .7; }
        .ac-arrow { margin-left: auto; color: #333; font-size: 14px; }
        .nav-meta { font-size: 11px; color: #444; }
        .full-width { grid-column: 1 / -1; }
        .label-stats { grid-template-columns: repeat(4, 1fr) !important; }
        @media(max-width: 600px) { .label-stats { grid-template-columns: repeat(2, 1fr) !important; } }
        .label-artists-dots { display: flex; gap: 5px; align-items: center; }
        .mini-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
      `}</style>
    </div>
  )
}
