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

  function getSerieStats(serie) {
    const singles = serie.singles || []
    const allBudgetLines = singles.flatMap(s => s.budget_lines || [])
    const titles = singles.map(s => s.title.toLowerCase())
    const serieRoyalties = royalties.filter(r =>
      r.artist === serie.artist && titles.includes(r.title.toLowerCase())
    )
    return computeRecoupe(serie, allBudgetLines, serieRoyalties, rate)
  }

  function getArtistStats(artist) {
    const ar = series.filter(s => s.artist === artist)
    const stats = ar.map(s => getSerieStats(s))
    const agg = computeArtistStats(stats)
    // Ajouter les infos distrib pour les projets Warner
    const warnerProjects = stats.filter(s => s.isWarner)
    agg.distribAdvance = warnerProjects.reduce((sum, s) => sum + (s.distribPhase?.advance || 0), 0)
    agg.distribRecouped = warnerProjects.reduce((sum, s) => sum + (s.distribPhase?.recouped || 0), 0)
    agg.distribPct = agg.distribAdvance > 0 ? Math.min((agg.distribRecouped / agg.distribAdvance) * 100, 100) : 0
    agg.hasWarner = warnerProjects.length > 0
    agg.allWarnerDone = warnerProjects.every(s => s.distribPhase?.done)
    return agg
  }

  // % de recoupe artiste & label séparés
  function pctArtist(s) {
    return s.artistAdvance > 0 ? Math.min((s.artistAdvanceRecouped / s.artistAdvance) * 100, 100) : 100
  }
  function pctLabel(s) {
    return s.fabricationCost > 0 ? Math.min((s.fabricationRecouped / s.fabricationCost) * 100, 100) : 100
  }

  const labelStats = (() => {
    const stats = series.map(s => getSerieStats(s))
    return computeArtistStats(stats)
  })()
  const labelArtistPct = labelStats.artistAdvance > 0 ? Math.min((labelStats.artistAdvanceRecouped / labelStats.artistAdvance) * 100, 100) : 0
  const labelFabPct = labelStats.fabricationCost > 0 ? Math.min((labelStats.fabricationRecouped / labelStats.fabricationCost) * 100, 100) : 0

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
                  <div className="sl">Budget total</div>
                  <div className="sv">{fmtEur(labelStats.fabricationCost + labelStats.artistAdvance)}</div>
                  <div className="ss">{fmtEur(labelStats.fabricationCost)} fab + {fmtEur(labelStats.artistAdvance)} avances</div>
                </div>
                <div>
                  <div className="sl">Total généré</div>
                  <div className="sv" style={{ color: '#f59e0b' }}>{fmtEur(labelStats.grossRevenue)}</div>
                  <div className="ss">{fmtStreams(labelStats.totalQty)} streams</div>
                </div>
                <div>
                  <div className="sl">Cash artistes</div>
                  <div className="sv" style={{ color: labelStats.artistCash > 0 ? '#a78bfa' : '#666' }}>{fmtEur(labelStats.artistCash)}</div>
                  <div className="ss">{labelStats.artistCash > 0 ? 'reversé' : 'en attente'}</div>
                </div>
                <div>
                  <div className="sl">Bénéfice label</div>
                  <div className="sv" style={{ color: labelStats.labelNet > 0 ? '#6ee7b7' : '#666' }}>
                    {fmtEur(labelStats.labelNet)}
                  </div>
                  {labelStats.coprodNet > 0 && <div className="ss">+ {fmtEur(labelStats.coprodNet)} coprod</div>}
                </div>
              </div>
              <DualBars artistPct={labelArtistPct} labelPct={labelFabPct} compact={false} />
            </div>

            {/* GRILLE ARTISTES */}
            <div className="artist-grid">
              {allArtists.map(artist => {
                const s = getArtistStats(artist)
                const color = COLORS[artist] || '#888'
                const aPct = s.artistAdvance > 0 ? Math.min((s.artistAdvanceRecouped / s.artistAdvance) * 100, 100) : 0
                const lPct = s.fabricationCost > 0 ? Math.min((s.fabricationRecouped / s.fabricationCost) * 100, 100) : 0
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
                    </div>
                    {s.seriesCount > 0 ? (
                      <>
                        <DualBars artistPct={aPct} labelPct={lPct} compact={true} />
                        <div className="ac-stats">
                          <div>
                            <div className="sl">Cash {artist.split(' ')[0]}</div>
                            <div className="sv-sm" style={{ color: s.artistCash > 0 ? '#a78bfa' : '#555' }}>{fmtEur(s.artistCash)}</div>
                          </div>
                          <div>
                            <div className="sl">Bénéfice label</div>
                            <div className="sv-sm" style={{ color: s.labelNet > 0 ? '#6ee7b7' : '#555' }}>{fmtEur(s.labelNet)}</div>
                          </div>
                        </div>
                      </>
                    ) : (
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
              const aPct = as.artistAdvance > 0 ? Math.min((as.artistAdvanceRecouped / as.artistAdvance) * 100, 100) : 0
              const lPct = as.fabricationCost > 0 ? Math.min((as.fabricationRecouped / as.fabricationCost) * 100, 100) : 0
              return (
                <div className="label-card" style={{ cursor: 'default' }}>
                  {/* WARNER BANNER if any */}
                  {as.hasWarner && !as.allWarnerDone && (
                    <div className="warner-banner">
                      <div className="wb-top">
                        <span className="wb-title">🏢 Avance Warner à recouper</span>
                        <span className="wb-pct" style={{ color: pctColor(as.distribPct) }}>{as.distribPct.toFixed(1)}%</span>
                      </div>
                      <div className="wb-bar">
                        <div className="wb-fill" style={{ width: `${as.distribPct}%`, background: '#f59e0b' }} />
                      </div>
                      <div className="wb-info">
                        <span>{fmtEur(as.distribRecouped)} recoupés / {fmtEur(as.distribAdvance)}</span>
                        <span className="wb-rest">Reste {fmtEur(as.distribAdvance - as.distribRecouped)}</span>
                      </div>
                      <div className="wb-note">Avlanche perçoit 0€ tant que Warner n'est pas recoupée. Les recoupes artiste/fab démarrent ensuite.</div>
                    </div>
                  )}

                  <div className="lc-stats">
                    <div><div className="sl">Budget</div><div className="sv">{fmtEur(as.fabricationCost + as.artistAdvance)}</div><div className="ss">{fmtEur(as.fabricationCost)} fab · {fmtEur(as.artistAdvance)} avance</div></div>
                    <div><div className="sl">Généré</div><div className="sv" style={{ color: '#f59e0b' }}>{fmtEur(as.grossRevenue)}</div><div className="ss">{fmtStreams(as.totalQty)} streams</div></div>
                    <div><div className="sl">Cash {activeArtist.split(' ')[0]}</div><div className="sv" style={{ color: as.artistCash > 0 ? '#a78bfa' : '#666' }}>{fmtEur(as.artistCash)}</div><div className="ss">{as.artistCash > 0 ? 'reversé' : 'en attente'}</div></div>
                    <div><div className="sl">Bénéfice label</div><div className="sv" style={{ color: as.labelNet > 0 ? '#6ee7b7' : '#666' }}>{fmtEur(as.labelNet)}</div>{as.coprodNet > 0 && <div className="ss">+ {fmtEur(as.coprodNet)} coprod</div>}</div>
                  </div>
                  {(!as.hasWarner || as.allWarnerDone) && <DualBars artistPct={aPct} labelPct={lPct} compact={false} />}
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
              const aPct = pctArtist(s)
              const lPct = pctLabel(s)

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
                  </div>

                  {/* WARNER : tracker spécial */}
                  {s.isWarner && !s.distribPhase.done && (
                    <div className="tracker-row warner-row">
                      <span className="tr-icon">🏢</span>
                      <span className="tr-label">{s.distribPhase.distribName}</span>
                      <div className="tr-bar">
                        <div className="tr-fill" style={{ width: `${s.distribPhase.pct}%`, background: '#f59e0b' }} />
                      </div>
                      <span className="tr-pct" style={{ color: pctColor(s.distribPhase.pct) }}>{s.distribPhase.pct.toFixed(0)}%</span>
                      <span className="tr-amounts">{fmtEur(s.distribPhase.recouped)} / {fmtEur(s.distribPhase.advance)}</span>
                    </div>
                  )}

                  {/* AVANCE ARTISTE (schéma 1 uniquement — en schéma 2 elle est payée via l'avance distrib) */}
                  {s.artistAdvance > 0 && !s.isWarner && (
                    <div className="tracker-row">
                      <span className="tr-icon">🎤</span>
                      <span className="tr-label">Avance {serie.artist.split(' ')[0]}</span>
                      <div className="tr-bar">
                        <div className="tr-fill" style={{ width: `${aPct}%`, background: s.artistAdvanceDone ? '#6ee7b7' : '#a78bfa' }} />
                      </div>
                      <span className="tr-pct" style={{ color: pctColor(aPct) }}>{aPct.toFixed(0)}%</span>
                      <span className="tr-amounts">
                        {s.artistAdvanceDone
                          ? <>✓ <span style={{ color: '#a78bfa' }}>cash {fmtEur(s.artistCash)}</span></>
                          : <>{fmtEur(s.artistAdvanceRecouped)} / {fmtEur(s.artistAdvance)}</>
                        }
                      </span>
                    </div>
                  )}

                  {/* FABRICATION ou APPORT EXTRA (schéma 2) */}
                  {s.fabricationCost > 0 && (!s.isWarner || s.distribPhase?.done) && (
                    <div className="tracker-row">
                      <span className="tr-icon">🏭</span>
                      <span className="tr-label">{s.isWarner ? 'Apport Avlanche' : 'Fabrication'}</span>
                      <div className="tr-bar">
                        <div className="tr-fill" style={{ width: `${lPct}%`, background: s.fabricationDone ? '#6ee7b7' : '#f97316' }} />
                      </div>
                      <span className="tr-pct" style={{ color: pctColor(lPct) }}>{lPct.toFixed(0)}%</span>
                      <span className="tr-amounts">
                        {s.fabricationDone
                          ? <>✓ <span style={{ color: '#6ee7b7' }}>+{fmtEur(s.labelProfit)}</span></>
                          : <>{fmtEur(s.fabricationRecouped)} / {fmtEur(s.fabricationCost)}</>
                        }
                      </span>
                    </div>
                  )}

                  {/* Note pour les projets Warner avec cash artiste direct */}
                  {s.isWarner && s.distribPhase?.done && s.artistCash > 0 && (
                    <div className="tracker-row" style={{ background: '#0a0a14', border: '1px solid #1a1a2a', borderRadius: 5, padding: '6px 8px', marginBottom: 8 }}>
                      <span className="tr-icon">🎤</span>
                      <span className="tr-label">Cash {serie.artist.split(' ')[0]}</span>
                      <span style={{ flex: 1, fontSize: 11, color: '#a78bfa' }}>{serie.artist_rate}% direct sur revenus post-Warner</span>
                      <span className="tr-amounts" style={{ color: '#a78bfa', fontWeight: 700 }}>{fmtEur(s.artistCash)}</span>
                    </div>
                  )}

                  <div className="pc-stats">
                    <div><div className="pcs-label">Total généré</div><div className="pcs-val pos">{fmtEur(s.grossRevenue)}</div></div>
                    <div><div className="pcs-label">Streams</div><div className="pcs-val">{fmtStreams(s.totalQty)}</div></div>
                    <div><div className="pcs-label">Statut</div><div className="pcs-val" style={{ fontSize: 12, color: pctColor((aPct + lPct) / 2) }}>
                      {s.phase === 'distrib' ? 'Recoupe distrib' : s.phase === 'recoupe' ? 'En recoupe' : 'En bénéfice ✓'}
                    </div></div>
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
        .warner-banner{background:#1a1000;border:1px solid #3a2a0a;border-radius:8px;padding:14px 16px;margin-bottom:14px}
        .wb-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
        .wb-title{font-size:12px;font-weight:700;color:#f59e0b}
        .wb-pct{font-size:20px;font-weight:800;line-height:1}
        .wb-bar{height:6px;background:#2a1a05;border-radius:3px;overflow:hidden;margin-bottom:8px}
        .wb-fill{height:100%;border-radius:3px;transition:width .4s}
        .wb-info{display:flex;justify-content:space-between;font-size:11px;color:#a8763a;margin-bottom:4px}
        .wb-rest{color:#666}
        .wb-note{font-size:10px;color:#664;line-height:1.5;margin-top:4px;font-style:italic}
        .lc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
        .lc-left{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#eee}
        .lc-dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#f97316,#a78bfa);flex-shrink:0}
        .lc-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
        .sl{font-size:9px;color:#444;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px}
        .sv{font-size:16px;font-weight:700;color:#eee}
        .sv-sm{font-size:13px;font-weight:700;color:#eee}
        .ss{font-size:10px;color:#555;margin-top:2px}
        .artist-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
        .artist-card{background:#141414;border:1px solid #1e1e1e;border-radius:12px;padding:16px 18px;cursor:pointer;transition:border-color .2s,background .2s}
        .artist-card:hover{border-color:#2a2a2a;background:#161616}
        .ac-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
        .ac-left{display:flex;align-items:flex-start;gap:9px}
        .ac-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:3px}
        .ac-name{font-size:14px;font-weight:700;color:#eee;margin-bottom:2px}
        .ac-meta{font-size:11px;color:#555}
        .ac-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
        .ac-empty{font-size:11px;color:#333;margin-top:10px;padding-top:10px;border-top:1px solid #1a1a1a}
        .section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#444;margin-bottom:14px}
        .project-card{background:#141414;border:1px solid #1e1e1e;border-radius:12px;padding:18px 20px;margin-bottom:12px;cursor:pointer;transition:border-color .2s,background .2s}
        .project-card:hover{border-color:#2a2a2a;background:#161616}
        .pc-top{margin-bottom:14px}
        .pc-type{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}
        .pc-name{font-size:16px;font-weight:700;color:#eee;margin-bottom:3px}
        .pc-meta{font-size:11px;color:#555}
        .tracker-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:11px}
        .warner-row{padding:6px 8px;background:#1a1000;border:1px solid #2a1f0a;border-radius:5px;margin-bottom:10px}
        .tr-icon{flex-shrink:0;width:18px}
        .tr-label{flex-shrink:0;width:90px;color:#bbb;font-weight:600}
        .tr-bar{flex:1;height:5px;background:#1a1a1a;border-radius:3px;overflow:hidden;min-width:60px}
        .tr-fill{height:100%;border-radius:3px;transition:width .4s}
        .tr-pct{flex-shrink:0;width:36px;text-align:right;font-weight:700;font-size:11px}
        .tr-amounts{flex-shrink:0;font-size:10px;color:#777;min-width:110px;text-align:right}
        .pc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px;padding-top:12px;border-top:1px solid #1a1a1a}
        .pcs-label{font-size:9px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
        .pcs-val{font-size:13px;font-weight:700;color:#eee}
        .pos{color:#f59e0b!important}
        .pc-footer{display:flex;justify-content:flex-end;gap:8px;padding-top:12px;border-top:1px solid #1a1a1a;margin-top:12px}
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
        @media(max-width:600px){
          .lc-stats{grid-template-columns:1fr 1fr}
          .artist-grid{grid-template-columns:1fr}
          .pc-stats{grid-template-columns:1fr 1fr 1fr}
          .tr-amounts{min-width:auto;font-size:9px}
          .tr-label{width:70px}
        }
      `}</style>
    </div>
  )
}

// Composant : 2 barres de progression côte à côte (artist + label)
function DualBars({ artistPct, labelPct, compact }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: compact ? 6 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: compact ? 40 : 70, fontSize: 10, color: '#a78bfa', fontWeight: 600 }}>🎤 Artiste</span>
        <div style={{ flex: 1, height: 5, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${artistPct}%`, height: '100%', background: artistPct >= 100 ? '#6ee7b7' : '#a78bfa', borderRadius: 3, transition: 'width .4s' }} />
        </div>
        <span style={{ width: 36, textAlign: 'right', fontSize: 10, fontWeight: 700, color: pctColor(artistPct) }}>{artistPct.toFixed(0)}%</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: compact ? 40 : 70, fontSize: 10, color: '#f97316', fontWeight: 600 }}>🏭 Label</span>
        <div style={{ flex: 1, height: 5, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${labelPct}%`, height: '100%', background: labelPct >= 100 ? '#6ee7b7' : '#f97316', borderRadius: 3, transition: 'width .4s' }} />
        </div>
        <span style={{ width: 36, textAlign: 'right', fontSize: 10, fontWeight: 700, color: pctColor(labelPct) }}>{labelPct.toFixed(0)}%</span>
      </div>
    </div>
  )
}
