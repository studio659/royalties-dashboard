import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { useRate } from '../../lib/rateContext'
import { ARTISTS, COLORS, fmtStreams } from '../../lib/artists'
import { computeRecoupe, computeArtistStats, fmtEur, pctColor } from '../../lib/recoupe'
import MainNav from '../../components/MainNav'
import NewProjectModal from '../../components/NewProjectModal'
import EditProjectModal from '../../components/EditProjectModal'

export default function RecoupeIndex() {
  const router = useRouter()
  const { rate } = useRate()
  const [view, setView] = useState('dashboard')
  const [activeArtist, setActiveArtist] = useState(null)
  const [series, setSeries] = useState([])
  const [royalties, setRoyalties] = useState([])
  const [allArtists, setAllArtists] = useState(ARTISTS)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editSerie, setEditSerie] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
    fetchAll()
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: artistsData }] = await Promise.all([
      supabase.from('series').select('*, singles(*, budget_lines(*))').order('created_at'),
      supabase.from('artists').select('name, color').order('created_at'),
    ])
    const seriesData = s || []
    setSeries(seriesData)
    if (artistsData?.length) setAllArtists(artistsData.map(a => a.name))

    const artistsWithProjects = [...new Set(seriesData.map(s => s.artist))]
    if (!artistsWithProjects.length) { setRoyalties([]); setLoading(false); return }

    let allRoy = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties')
        .select('title, artist, amount, currency, qty, month')
        .in('artist', artistsWithProjects)
        .range(from, from + 999)
      if (error || !data?.length) break
      allRoy = allRoy.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setRoyalties(allRoy)
    setLoading(false)
  }, [])

  async function deleteSerie(e, serieId, serieName, singlesCount) {
    e.stopPropagation()
    if (!confirm(`Supprimer "${serieName}" ?\n\nSupprime ${singlesCount} single${singlesCount > 1 ? 's' : ''} et tous les budgets associés.`)) return
    await supabase.from('series').delete().eq('id', serieId)
    fetchAll()
  }

  // Calcule les stats d'une série en utilisant la nouvelle lib
  function getSerieStats(serie) {
    const singles = serie.singles || []
    const allBudgetLines = singles.flatMap(s => s.budget_lines || [])
    // Toutes les royalties qui matchent les titres de la série
    const titles = singles.map(s => s.title.toLowerCase())
    const serieRoyalties = royalties.filter(r =>
      r.artist === serie.artist && titles.includes(r.title.toLowerCase())
    )
    return computeRecoupe(serie, allBudgetLines, serieRoyalties, rate)
  }

  // Stats agrégées par artiste
  function getArtistStats(artist) {
    const ar = series.filter(s => s.artist === artist)
    const stats = ar.map(s => getSerieStats(s))
    return computeArtistStats(stats)
  }

  // Stats globales du label
  const labelStats = (() => {
    const stats = series.map(s => getSerieStats(s))
    return computeArtistStats(stats)
  })()

  const labelGlobalPct = labelStats.fabricationCost + labelStats.artistAdvance > 0
    ? Math.min(((labelStats.fabricationRecouped + labelStats.artistAdvanceRecouped) / (labelStats.fabricationCost + labelStats.artistAdvance)) * 100, 100)
    : 0

  const artistSeries = activeArtist ? series.filter(s => s.artist === activeArtist) : []

  return (
    <div className="app">
      <MainNav
        title={view === 'artist' ? activeArtist : undefined}
        showBack={view === 'artist'}
        onBack={() => setView('dashboard')}
      />

      <div className="page">
        {loading ? (
          <div className="loading-screen" style={{ minHeight: 300 }}>
            <div className="loading-spinner" style={{ borderTopColor: '#f59e0b' }} />
          </div>
        ) : view === 'dashboard' ? (
          <>
            {/* CARTE LABEL GLOBAL */}
            <div className="label-card">
              <div className="lc-top">
                <div className="lc-left">
                  <div className="lc-dot" />
                  <span>Avlanche Music · Recoupe</span>
                </div>
                <div style={{ fontSize: 11, color: '#555' }}>
                  {labelStats.seriesCount} projet{labelStats.seriesCount !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="lc-stats">
                <div>
                  <div className="sl">Budget total investi</div>
                  <div className="sv">{fmtEur(labelStats.fabricationCost + labelStats.artistAdvance)}</div>
                  <div className="ss">{fmtEur(labelStats.fabricationCost)} fab + {fmtEur(labelStats.artistAdvance)} avances</div>
                </div>
                <div>
                  <div className="sl">Total généré</div>
                  <div className="sv" style={{ color: '#f59e0b' }}>{fmtEur(labelStats.grossRevenue)}</div>
                  <div className="ss">{fmtStreams(labelStats.totalQty)} streams</div>
                </div>
                <div>
                  <div className="sl">Recoupe globale</div>
                  <div className="sv" style={{ color: pctColor(labelGlobalPct) }}>{labelGlobalPct.toFixed(1)}%</div>
                  <div className="ss">{labelStats.recoupedCount} recoupé{labelStats.recoupedCount !== 1 ? 's' : ''}</div>
                </div>
                <div>
                  <div className="sl">Bénéfice net</div>
                  <div className="sv" style={{ color: labelStats.labelNet > 0 ? '#6ee7b7' : '#444' }}>
                    {labelStats.labelNet > 0 ? fmtEur(labelStats.labelNet) : '€0'}
                  </div>
                  <div className="ss">+ {fmtEur(labelStats.coprodNet)} coprod</div>
                </div>
              </div>
              {(labelStats.fabricationCost + labelStats.artistAdvance) > 0 && (
                <div className="prog-bg" style={{ marginTop: 14 }}>
                  <div className="prog-fill" style={{ width: `${labelGlobalPct}%`, background: 'linear-gradient(90deg,#f97316,#a78bfa)' }} />
                </div>
              )}
            </div>

            {/* GRILLE ARTISTES */}
            <div className="artist-grid">
              {allArtists.map(artist => {
                const s = getArtistStats(artist)
                const color = COLORS[artist] || '#888'
                const totalBudget = s.fabricationCost + s.artistAdvance
                const totalRecouped = s.fabricationRecouped + s.artistAdvanceRecouped
                const pct = totalBudget > 0 ? Math.min((totalRecouped / totalBudget) * 100, 100) : 0
                return (
                  <div key={artist} className="artist-card" onClick={() => { setActiveArtist(artist); setView('artist') }}>
                    <div className="ac-top">
                      <div className="ac-left">
                        <span className="ac-dot" style={{ background: color }} />
                        <div>
                          <div className="ac-name">{artist}</div>
                          <div className="ac-meta">
                            {s.seriesCount > 0 ? `${s.seriesCount} projet${s.seriesCount > 1 ? 's' : ''}` : 'Aucun projet'}
                          </div>
                        </div>
                      </div>
                      <div className="ac-right">
                        {s.seriesCount > 0 ? (
                          <>
                            <div className="ac-pct" style={{ color: pctColor(pct) }}>{pct.toFixed(1)}%</div>
                            <div className="ac-pct-sub">{pct >= 100 ? 'recoupé ✓' : 'de recoupe'}</div>
                          </>
                        ) : (
                          <div className="ac-pct" style={{ color: '#333' }}>—</div>
                        )}
                      </div>
                    </div>
                    {s.seriesCount > 0 && (
                      <>
                        <div className="prog-bg">
                          <div className="prog-fill" style={{ width: `${pct}%`, background: pct >= 100 ? `linear-gradient(90deg,${color},#6ee7b7)` : color }} />
                        </div>
                        <div className="ac-stats">
                          <div>
                            <div className="sl">Budget</div>
                            <div className="sv" style={{ fontSize: 13 }}>{fmtEur(totalBudget)}</div>
                          </div>
                          <div>
                            <div className="sl">{s.labelNet > 0 ? 'Bénéfice' : 'Généré'}</div>
                            <div className="sv" style={{ fontSize: 13, color: s.labelNet > 0 ? '#6ee7b7' : '#f59e0b' }}>
                              {s.labelNet > 0 ? `+${fmtEur(s.labelNet)}` : fmtEur(s.grossRevenue)}
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                    {s.seriesCount === 0 && (
                      <div className="ac-empty">Cliquer pour créer un projet →</div>
                    )}
                  </div>
                )
              })}
            </div>

            <button className="new-project-btn" onClick={() => setShowModal(true)}>
              + Nouveau projet (single, série, EP, album…)
            </button>
          </>
        ) : (
          <>
            <div className="breadcrumb">
              <span className="bc-link" onClick={() => setView('dashboard')}>Recoupe</span>
              <span className="bc-sep">›</span>
              <span className="bc-current">{activeArtist}</span>
            </div>

            {artistSeries.length > 0 && (() => {
              const as = getArtistStats(activeArtist)
              const color = COLORS[activeArtist] || '#888'
              const totalBudget = as.fabricationCost + as.artistAdvance
              const totalRecouped = as.fabricationRecouped + as.artistAdvanceRecouped
              const pct = totalBudget > 0 ? Math.min((totalRecouped / totalBudget) * 100, 100) : 0
              return (
                <div className="label-card" style={{ cursor: 'default' }}>
                  <div className="lc-stats">
                    <div><div className="sl">Budget investi</div><div className="sv">{fmtEur(totalBudget)}</div><div className="ss">{fmtEur(as.fabricationCost)} fab + {fmtEur(as.artistAdvance)} avance</div></div>
                    <div><div className="sl">Total généré</div><div className="sv" style={{ color: '#f59e0b' }}>{fmtEur(as.grossRevenue)}</div><div className="ss">{fmtStreams(as.totalQty)} streams</div></div>
                    <div><div className="sl">Recoupe</div><div className="sv" style={{ color: pctColor(pct) }}>{pct.toFixed(1)}%</div></div>
                    <div><div className="sl">Bénéfice</div><div className="sv" style={{ color: as.labelNet > 0 ? '#6ee7b7' : '#444' }}>{as.labelNet > 0 ? fmtEur(as.labelNet) : '€0'}</div></div>
                  </div>
                  <div className="prog-bg" style={{ marginTop: 14 }}>
                    <div className="prog-fill" style={{ width: `${pct}%`, background: pct >= 100 ? `linear-gradient(90deg,${color},#6ee7b7)` : color }} />
                  </div>
                </div>
              )
            })()}

            <div className="section-label">{artistSeries.length} projet{artistSeries.length !== 1 ? 's' : ''} · {activeArtist}</div>

            {artistSeries.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <div className="empty-title">Aucun projet</div>
                <div className="empty-sub">Crée un premier projet pour {activeArtist}</div>
              </div>
            ) : artistSeries.map(serie => {
              const s = getSerieStats(serie)
              const color = COLORS[serie.artist] || '#f59e0b'
              const totalBudget = s.fabricationCost + s.artistAdvance
              const totalRecouped = s.fabricationRecouped + s.artistAdvanceRecouped
              const pct = totalBudget > 0 ? Math.min((totalRecouped / totalBudget) * 100, 100) : 0
              return (
                <div key={serie.id} className="project-card" onClick={() => router.push(`/recoupe/${serie.id}`)}>
                  <div className="pc-top">
                    <div className="pc-left">
                      <div className="pc-type">
                        {serie.singles?.length === 1 ? 'Single' : 'Série · ' + (serie.singles?.length || 0) + ' titres'} · {serie.artist}
                        {s.isWarner && <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 3, background: '#1a1000', color: '#f59e0b', fontSize: 9 }}>WARNER</span>}
                      </div>
                      <div className="pc-name">{serie.name}</div>
                      <div className="pc-meta">
                        Contrat artiste {serie.artist_rate}%
                        {serie.coprod_name && ` · co-prod ${serie.coprod_name} ${serie.coprod_rate}%`}
                      </div>
                    </div>
                    <div className="pc-right">
                      <div className="pc-pct" style={{ color: pctColor(pct) }}>{pct.toFixed(1)}%</div>
                      <div className="pc-pct-sub">{s.phase === 'profit' ? 'recoupé ✓' : s.phase === 'distrib' ? 'recoupe distrib' : 'de recoupe'}</div>
                    </div>
                  </div>
                  <div className="prog-bg">
                    <div className="prog-fill" style={{ width: `${pct}%`, background: pct >= 100 ? `linear-gradient(90deg,${color},#6ee7b7)` : color }} />
                  </div>
                  <div className="pc-stats">
                    <div><div className="pcs-label">Budget investi</div><div className="pcs-val">{fmtEur(totalBudget)}</div></div>
                    <div><div className="pcs-label">Total généré</div><div className="pcs-val pos">{fmtEur(s.grossRevenue)}</div><div className="pcs-sub">{fmtStreams(s.totalQty)} streams</div></div>
                    {s.phase === 'profit'
                      ? <div><div className="pcs-label">Bénéfice net</div><div className="pcs-val" style={{ color: '#6ee7b7' }}>{fmtEur(s.labelNet)}</div>{serie.coprod_name && <div className="pcs-sub" style={{ color: '#eab308' }}>{serie.coprod_name} : {fmtEur(s.coprodNet)}</div>}</div>
                      : <div><div className="pcs-label">Reste à recouper</div><div className="pcs-val warn">{fmtEur(Math.max(totalBudget - totalRecouped, 0))}</div></div>
                    }
                  </div>
                  <div className="pc-footer">
                    <button className="edit-btn" onClick={e => { e.stopPropagation(); setEditSerie(serie) }}>✏️ Modifier</button>
                    <button className="del-btn" onClick={e => deleteSerie(e, serie.id, serie.name, serie.singles?.length || 0)}>🗑 Supprimer</button>
                  </div>
                </div>
              )
            })}

            <button className="new-project-btn" onClick={() => setShowModal(true)}>
              + Nouveau projet pour {activeArtist}
            </button>
          </>
        )}
      </div>

      {editSerie && <EditProjectModal serie={editSerie} onClose={() => setEditSerie(null)} onSuccess={fetchAll} />}
      {showModal && <NewProjectModal defaultArtist={activeArtist || allArtists[0]} onClose={() => setShowModal(false)} onSuccess={fetchAll} />}

      <style jsx>{`
        .breadcrumb{font-size:11px;color:#444;margin-bottom:20px;display:flex;align-items:center;gap:6px}
        .bc-link{color:#555;cursor:pointer}.bc-link:hover{color:#aaa}
        .bc-sep{color:#333}.bc-current{color:#888}
        .label-card{background:#141414;border:1px solid #1e1e1e;border-radius:12px;padding:18px 20px;margin-bottom:16px}
        .lc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
        .lc-left{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#eee}
        .lc-dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#f97316,#a78bfa);flex-shrink:0}
        .lc-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
        .sl{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px}
        .sv{font-size:16px;font-weight:700;color:#eee}
        .ss{font-size:11px;color:#555;margin-top:2px}
        .prog-bg{height:5px;background:#1e1e1e;border-radius:3px;overflow:hidden}
        .prog-fill{height:100%;border-radius:3px}
        .artist-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
        .artist-card{background:#141414;border:1px solid #1e1e1e;border-radius:12px;padding:16px 18px;cursor:pointer;transition:border-color .2s,background .2s}
        .artist-card:hover{border-color:#2a2a2a;background:#161616}
        .ac-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
        .ac-left{display:flex;align-items:flex-start;gap:9px}
        .ac-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:3px}
        .ac-name{font-size:15px;font-weight:700;color:#eee;margin-bottom:2px}
        .ac-meta{font-size:11px;color:#555}
        .ac-right{text-align:right;flex-shrink:0}
        .ac-pct{font-size:22px;font-weight:800;line-height:1}
        .ac-pct-sub{font-size:10px;color:#555;margin-top:2px}
        .ac-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
        .ac-empty{font-size:11px;color:#333;margin-top:10px;padding-top:10px;border-top:1px solid #1a1a1a}
        .section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#444;margin-bottom:14px}
        .project-card{background:#141414;border:1px solid #1e1e1e;border-radius:12px;padding:20px 22px;margin-bottom:12px;cursor:pointer;transition:border-color .2s,background .2s}
        .project-card:hover{border-color:#2a2a2a;background:#161616}
        .pc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
        .pc-type{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}
        .pc-name{font-size:16px;font-weight:700;color:#eee;margin-bottom:3px}
        .pc-meta{font-size:12px;color:#555}
        .pc-right{text-align:right;flex-shrink:0}
        .pc-pct{font-size:28px;font-weight:800;line-height:1}
        .pc-pct-sub{font-size:11px;color:#555;margin-top:2px}
        .pc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
        .pcs-label{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
        .pcs-val{font-size:14px;font-weight:700;color:#eee}
        .pcs-sub{font-size:10px;color:#555;margin-top:2px}
        .pos{color:#6ee7b7!important}.warn{color:#f59e0b!important}
        .pc-footer{display:flex;justify-content:flex-end;gap:8px;padding-top:12px;border-top:1px solid #1a1a1a;margin-top:14px}
        .edit-btn{background:none;border:1px solid #1e2a1e;color:#4a7a4a;font-size:11px;padding:5px 12px;border-radius:5px;cursor:pointer;font-family:inherit;transition:all .2s}
        .edit-btn:hover{background:#0a1a0a;color:#6ee7b7;border-color:#6ee7b744}
        .del-btn{background:none;border:1px solid #2a1010;color:#664;font-size:11px;padding:5px 12px;border-radius:5px;cursor:pointer;font-family:inherit;transition:all .2s}
        .del-btn:hover{background:#1a0808;color:#f87171;border-color:#f8717144}
        .new-project-btn{width:100%;padding:18px;background:none;border:1.5px dashed #1e1e1e;border-radius:12px;text-align:center;color:#333;font-size:13px;cursor:pointer;font-family:inherit;transition:all .2s;margin-top:4px}
        .new-project-btn:hover{border-color:#333;color:#666}
        .empty-state{text-align:center;padding:48px 20px}
        .empty-icon{font-size:36px;margin-bottom:12px}
        .empty-title{font-size:16px;font-weight:700;color:#555;margin-bottom:6px}
        .empty-sub{font-size:13px;color:#333;max-width:340px;margin:0 auto;line-height:1.6}
        @media(max-width:600px){.lc-stats{grid-template-columns:1fr 1fr}.artist-grid{grid-template-columns:1fr}.pc-stats{grid-template-columns:1fr 1fr}}
      `}</style>
    </div>
  )
}
