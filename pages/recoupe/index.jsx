import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { ARTISTS, COLORS, fmt } from '../../lib/artists'
import MainNav from '../../components/MainNav'

const RATE_DEFAULT = 0.92

export default function RecoupeIndex() {
  const router = useRouter()
  const [activeArtist, setActiveArtist] = useState('Magie!')
  const [series, setSeries] = useState([])
  const [royalties, setRoyalties] = useState([])
  const [rate, setRate] = useState(RATE_DEFAULT)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
    supabase.from('settings').select('value').eq('key', 'eur_rate').single()
      .then(({ data }) => { if (data) setRate(parseFloat(data.value)) })
    fetchAll()
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const { data: s } = await supabase.from('series').select('*, singles(*, budget_lines(*))').order('created_at')

    // Paginate royalties (18K+ rows)
    let allRoy = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties').select('title, artist, usd, qty, month')
        .range(from, from + 999)
      if (error || !data || data.length === 0) break
      allRoy = allRoy.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setSeries(s || [])
    setRoyalties(allRoy)
    setLoading(false)
  }, [])

  function getSeriesStats(serie) {
    const singles = serie.singles || []
    let totalBudgetEur = 0, totalUsd = 0, totalQty = 0
    singles.forEach(s => {
      totalBudgetEur += s.budget_eur || 0
      const rows = royalties.filter(r =>
        r.artist === s.artist &&
        r.title.toLowerCase().includes(s.title.toLowerCase().substring(0, 10))
      )
      totalUsd += rows.reduce((sum, r) => sum + r.usd, 0)
      totalQty += rows.reduce((sum, r) => sum + r.qty, 0)
    })
    const budgetUsd = totalBudgetEur / rate
    const pct = budgetUsd > 0 ? Math.min((totalUsd / budgetUsd) * 100, 100) : 0
    const remaining = Math.max(budgetUsd - totalUsd, 0)
    return { totalBudgetEur, totalUsd, totalQty, budgetUsd, pct, remaining }
  }

  const artistSeries = series.filter(s => s.artist === activeArtist)

  return (
    <div className="app">
      <MainNav />

      {/* ARTIST SUB-TABS */}
      <div className="sub-tabs-bar">
        <div className="sub-tabs">
          {[...ARTISTS, 'Sherfflazone'].map(a => (
            <button
              key={a}
              className={`sub-tab ${activeArtist === a ? 'active' : ''}`}
              onClick={() => setActiveArtist(a)}
            >
              <span className="sub-dot" style={{ background: COLORS[a] || '#888' }} />
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="page">
        {loading ? (
          <div className="loading-screen" style={{ minHeight: 200 }}>
            <div className="loading-spinner" style={{ borderTopColor: '#f59e0b' }} />
          </div>
        ) : (
          <>
            <div className="section-label">
              Projets · {activeArtist} · {artistSeries.length} actif{artistSeries.length !== 1 ? 's' : ''}
            </div>

            {artistSeries.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <div className="empty-title">Aucun projet</div>
                <div className="empty-sub">Crée un projet pour suivre la recoupe de {activeArtist}</div>
              </div>
            ) : (
              artistSeries.map(serie => {
                const s = getSeriesStats(serie)
                const color = COLORS[serie.artist] || '#f59e0b'
                return (
                  <div
                    key={serie.id}
                    className="project-card"
                    onClick={() => router.push(`/recoupe/${serie.id}`)}
                  >
                    <div className="pc-top">
                      <div className="pc-left">
                        <div className="pc-type">
                          {serie.singles?.length === 1 ? 'Single' : 'Série de singles'} · {serie.artist}
                        </div>
                        <div className="pc-name">{serie.name}</div>
                        <div className="pc-meta">
                          {serie.singles?.length || 0} single{(serie.singles?.length || 0) > 1 ? 's' : ''}
                          {serie.coprod_name && ` · co-prod ${serie.coprod_name}`}
                          {' · '}Contrat {serie.artist_rate}% / {serie.label_rate}/{serie.coprod_rate}
                        </div>
                      </div>
                      <div className="pc-right">
                        <div className="pc-pct" style={{ color: s.pct >= 90 ? '#6ee7b7' : s.pct >= 50 ? '#f59e0b' : '#f87171' }}>
                          {s.pct.toFixed(1)}%
                        </div>
                        <div className="pc-pct-sub">de recoupe</div>
                      </div>
                    </div>

                    <div className="prog-bg">
                      <div className="prog-fill" style={{
                        width: `${s.pct}%`,
                        background: s.pct >= 90
                          ? 'linear-gradient(90deg, #f97316, #6ee7b7)'
                          : color
                      }} />
                    </div>

                    <div className="pc-stats">
                      <div>
                        <div className="pcs-label">Budget investi</div>
                        <div className="pcs-val">€{Math.round(s.totalBudgetEur).toLocaleString('fr-FR')}</div>
                        <div className="pcs-sub">≈ ${Math.round(s.budgetUsd).toLocaleString('fr-FR')}</div>
                      </div>
                      <div>
                        <div className="pcs-label">Total généré</div>
                        <div className="pcs-val pos">{fmt(s.totalUsd)}</div>
                        <div className="pcs-sub">{s.totalQty >= 1000 ? (s.totalQty / 1000).toFixed(0) + 'K' : s.totalQty} streams</div>
                      </div>
                      <div>
                        <div className="pcs-label">Reste à recouper</div>
                        <div className="pcs-val warn">{fmt(s.remaining)}</div>
                        {serie.coprod_name && <div className="pcs-sub">{serie.coprod_name} : $0 perçu</div>}
                      </div>
                    </div>
                  </div>
                )
              })
            )}

            <button className="new-project-btn" onClick={() => alert('Formulaire nouveau projet — à venir')}>
              + Nouveau projet (single, série, EP, album…)
            </button>
          </>
        )}
      </div>

      <style jsx>{`
        .sub-tabs-bar {
          padding: 12px 20px 0;
          border-bottom: 1px solid #1a1a1a;
          background: #0d0d0d;
          position: sticky;
          top: 101px;
          z-index: 100;
        }
        .sub-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .sub-tab {
          padding: 6px 16px; border-radius: 20px; border: 1px solid #1e1e1e;
          font-size: 12px; font-weight: 600; color: #555; cursor: pointer;
          background: transparent; font-family: inherit; transition: all .2s;
          display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
        }
        .sub-tab.active { background: #eee; color: #111; border-color: #eee; }
        .sub-tab:hover:not(.active) { border-color: #333; color: #999; }
        .sub-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        .section-label {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 2px; color: #444; margin-bottom: 16px;
        }
        .project-card {
          background: #141414; border: 1px solid #1e1e1e; border-radius: 12px;
          padding: 20px 22px; margin-bottom: 12px; cursor: pointer;
          transition: border-color .2s, background .2s;
        }
        .project-card:hover { border-color: #2a2a2a; background: #161616; }
        .pc-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
        .pc-type { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px; }
        .pc-name { font-size: 16px; font-weight: 700; color: #eee; margin-bottom: 3px; }
        .pc-meta { font-size: 12px; color: #555; }
        .pc-right { text-align: right; flex-shrink: 0; }
        .pc-pct { font-size: 30px; font-weight: 800; line-height: 1; }
        .pc-pct-sub { font-size: 11px; color: #555; margin-top: 2px; }
        .prog-bg { height: 5px; background: #1e1e1e; border-radius: 3px; overflow: hidden; margin-bottom: 16px; }
        .prog-fill { height: 100%; border-radius: 3px; }
        .pc-stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
        .pcs-label { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
        .pcs-val { font-size: 14px; font-weight: 700; color: #eee; }
        .pcs-sub { font-size: 10px; color: #555; margin-top: 2px; }
        .pos { color: #6ee7b7 !important; }
        .warn { color: #f59e0b !important; }
        .new-project-btn {
          width: 100%; padding: 18px; background: none; border: 1.5px dashed #1e1e1e;
          border-radius: 12px; text-align: center; color: #333; font-size: 13px;
          cursor: pointer; font-family: inherit; transition: all .2s; margin-top: 4px;
        }
        .new-project-btn:hover { border-color: #333; color: #666; }
        .empty-state { text-align: center; padding: 48px 20px; }
        .empty-icon { font-size: 36px; margin-bottom: 12px; }
        .empty-title { font-size: 16px; font-weight: 700; color: #555; margin-bottom: 6px; }
        .empty-sub { font-size: 13px; color: #333; }
      `}</style>
    </div>
  )
}
