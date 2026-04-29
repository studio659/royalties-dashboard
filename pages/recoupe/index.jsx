import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { ARTISTS, COLORS, fmt, fmtStreams } from '../../lib/artists'
import MainNav from '../../components/MainNav'
import NewProjectModal from '../../components/NewProjectModal'
import EditProjectModal from '../../components/EditProjectModal'

const RATE_DEFAULT = 0.92
const ALL_ARTISTS = [...ARTISTS, 'Sherfflazone']

export default function RecoupeIndex() {
  const router = useRouter()
  const [view, setView] = useState('dashboard')
  const [activeArtist, setActiveArtist] = useState(null)
  const [series, setSeries] = useState([])
  const [royalties, setRoyalties] = useState([])
  const [rate, setRate] = useState(RATE_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editSerie, setEditSerie] = useState(null)

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
    let allRoy = [], from = 0
    while (true) {
      const { data, error } = await supabase.from('royalties').select('title, artist, usd, qty, month').range(from, from + 999)
      if (error || !data || !data.length) break
      allRoy = allRoy.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setSeries(s || [])
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
    let totalBudgetEur = 0, totalUsd = 0, totalQty = 0
    singles.forEach(s => {
      totalBudgetEur += s.budget_eur || 0
      const rows = royalties.filter(r => r.artist === s.artist && r.title.toLowerCase() === s.title.toLowerCase())
      totalUsd += rows.reduce((sum, r) => sum + r.usd, 0)
      totalQty += rows.reduce((sum, r) => sum + r.qty, 0)
    })
    const budgetUsd = totalBudgetEur / rate
    const pct = budgetUsd > 0 ? Math.min((totalUsd / budgetUsd) * 100, 100) : 0
    const remaining = Math.max(budgetUsd - totalUsd, 0)
    const profit = Math.max(totalUsd - budgetUsd, 0)
    const artistShare = profit * (serie.artist_rate / 100)
    const mgmtShare   = profit * (serie.mgmt_rate / 100)
    const poolShare   = profit - artistShare - mgmtShare
    const coprodShare = poolShare * (serie.coprod_rate / 100)
    const labelShare  = poolShare * (serie.label_rate / 100)
    return { totalBudgetEur, totalUsd, totalQty, budgetUsd, pct, remaining, profit, coprodShare, labelShare }
  }

  function getArtistStats(artist) {
    const ar = series.filter(s => s.artist === artist)
    let totalBudgetEur = 0, totalUsd = 0, totalQty = 0, profit = 0
    ar.forEach(serie => {
      const s = getSerieStats(serie)
      totalBudgetEur += s.totalBudgetEur
      totalUsd += s.totalUsd
      totalQty += s.totalQty
      profit += s.profit
    })
    const budgetUsd = totalBudgetEur / rate
    const pct = budgetUsd > 0 ? Math.min((totalUsd / budgetUsd) * 100, 100) : 0
    const remaining = Math.max(budgetUsd - totalUsd, 0)
    return { totalBudgetEur, totalUsd, totalQty, budgetUsd, pct, remaining, profit, seriesCount: ar.length }
  }

  const labelStats = (() => {
    let budget = 0, usd = 0, qty = 0, profit = 0, recouped = 0
    series.forEach(serie => {
      const s = getSerieStats(serie)
      budget += s.totalBudgetEur; usd += s.totalUsd; qty += s.totalQty; profit += s.profit
      if (s.pct >= 100) recouped++
    })
    const budgetUsd = budget / rate
    const pct = budgetUsd > 0 ? Math.min((usd / budgetUsd) * 100, 100) : 0
    return { budget, budgetUsd, usd, qty, pct, profit, recouped, projectCount: series.length }
  })()

  function pctColor(pct) {
    if (pct >= 100) return '#6ee7b7'
    if (pct >= 60) return '#f59e0b'
    if (pct > 0) return '#f87171'
    return '#444'
  }

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
            {/* LABEL CARD */}
            <div className="label-card">
              <div className="lc-top">
                <div className="lc-left">
                  <div className="lc-dot" />
                  <span>Avlanche Music · Recoupe</span>
                </div>
                <div style={{ fontSize: 11, color: '#555' }}>{labelStats.projectCount} projet{labelStats.projectCount !== 1 ? 's' : ''}</div>
              </div>
              <div className="lc-stats">
                <div>
                  <div className="sl">Budget investi</div>
                  <div className="sv">€{Math.round(labelStats.budget).toLocaleString('fr-FR')}</div>
                  <div className="ss">≈ ${Math.round(labelStats.budgetUsd).toLocaleString('fr-FR')}</div>
                </div>
                <div>
                  <div className="sl">Total généré</div>
                  <div className="sv" style={{ color: '#f59e0b' }}>{fmt(labelStats.usd)}</div>
                  <div className="ss">{fmtStreams(labelStats.qty)} streams</div>
                </div>
                <div>
                  <div className="sl">Recoupe globale</div>
                  <div className="sv" style={{ color: pctColor(labelStats.pct) }}>{labelStats.pct.toFixed(1)}%</div>
                  <div className="ss">{fmt(Math.max(labelStats.budgetUsd - labelStats.usd, 0))} restants</div>
                </div>
                <div>
                  <div className="sl">Bénéfice net</div>
                  <div className="sv" style={{ color: labelStats.profit > 0 ? '#6ee7b7' : '#444' }}>
                    {labelStats.profit > 0 ? fmt(labelStats.profit) : '$0'}
                  </div>
                  <div className="ss">{labelStats.recouped} recoupé{labelStats.recouped !== 1 ? 's' : ''}</div>
                </div>
              </div>
              {labelStats.budgetUsd > 0 && (
                <div className="prog-bg" style={{ marginTop: 14 }}>
                  <div className="prog-fill" style={{ width: `${labelStats.pct}%`, background: 'linear-gradient(90deg,#f97316,#a78bfa)' }} />
                </div>
              )}
            </div>

            {/* ARTIST GRID */}
            <div className="artist-grid">
              {ALL_ARTISTS.map(artist => {
                const s = getArtistStats(artist)
                const color = COLORS[artist] || '#888'
                const isWarner = artist === 'Sherfflazone'

                return (
                  <div key={artist} className="artist-card" onClick={() => { setActiveArtist(artist); setView('artist') }}>
                    <div className="ac-top">
                      <div className="ac-left">
                        <span className="ac-dot" style={{ background: color }} />
                        <div>
                          <div className="ac-name">{artist}</div>
                          <div className="ac-meta">
                            {isWarner ? 'Distribution Warner' : s.seriesCount > 0 ? `${s.seriesCount} projet${s.seriesCount > 1 ? 's' : ''}` : 'Aucun projet'}
                          </div>
                        </div>
                      </div>
                      <div className="ac-right">
                        {s.seriesCount > 0 ? (
                          <>
                            <div className="ac-pct" style={{ color: pctColor(s.pct) }}>{s.pct.toFixed(1)}%</div>
                            <div className="ac-pct-sub">{s.pct >= 100 ? 'recoupé ✓' : 'de recoupe'}</div>
                          </>
                        ) : (
                          <div className="ac-pct" style={{ color: '#333' }}>—</div>
                        )}
                      </div>
                    </div>
                    {s.seriesCount > 0 && (
                      <>
                        <div className="prog-bg">
                          <div className="prog-fill" style={{ width: `${s.pct}%`, background: s.pct >= 100 ? `linear-gradient(90deg,${color},#6ee7b7)` : color }} />
                        </div>
                        <div className="ac-stats">
                          <div>
                            <div className="sl">Budget</div>
                            <div className="sv" style={{ fontSize: 13 }}>€{Math.round(s.totalBudgetEur).toLocaleString('fr-FR')}</div>
                            <div className="ss">≈ ${Math.round(s.budgetUsd).toLocaleString('fr-FR')}</div>
                          </div>
                          <div>
                            <div className="sl">{s.profit > 0 ? 'Bénéfice' : 'Généré'}</div>
                            <div className="sv" style={{ fontSize: 13, color: s.profit > 0 ? '#6ee7b7' : '#f59e0b' }}>
                              {s.profit > 0 ? `+${fmt(s.profit)}` : fmt(s.totalUsd)}
                            </div>
                            <div className="ss">{fmtStreams(s.totalQty)} streams</div>
                          </div>
                        </div>
                      </>
                    )}
                    {s.seriesCount === 0 && (
                      <div className="ac-empty">
                        {isWarner ? 'Importer un rapport Warner pour activer' : 'Cliquer pour créer un projet →'}
                      </div>
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
          /* ARTIST VIEW */
          <>
            <div className="breadcrumb">
              <span className="bc-link" onClick={() => setView('dashboard')}>Recoupe</span>
              <span className="bc-sep">›</span>
              <span className="bc-current">
                <span className="ac-dot" style={{ background: COLORS[activeArtist] || '#888', display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />
                {activeArtist}
              </span>
            </div>

            {artistSeries.length > 0 && (() => {
              const as = getArtistStats(activeArtist)
              const color = COLORS[activeArtist] || '#888'
              return (
                <div className="label-card" style={{ cursor: 'default' }}>
                  <div className="lc-stats">
                    <div><div className="sl">Budget investi</div><div className="sv">€{Math.round(as.totalBudgetEur).toLocaleString('fr-FR')}</div><div className="ss">≈ ${Math.round(as.budgetUsd).toLocaleString('fr-FR')}</div></div>
                    <div><div className="sl">Total généré</div><div className="sv" style={{ color: '#f59e0b' }}>{fmt(as.totalUsd)}</div><div className="ss">{fmtStreams(as.totalQty)} streams</div></div>
                    <div><div className="sl">Recoupe globale</div><div className="sv" style={{ color: pctColor(as.pct) }}>{as.pct.toFixed(1)}%</div><div className="ss">{fmt(as.remaining)} restants</div></div>
                    <div><div className="sl">Bénéfice</div><div className="sv" style={{ color: as.profit > 0 ? '#6ee7b7' : '#444' }}>{as.profit > 0 ? fmt(as.profit) : '$0'}</div></div>
                  </div>
                  <div className="prog-bg" style={{ marginTop: 14 }}>
                    <div className="prog-fill" style={{ width: `${as.pct}%`, background: as.pct >= 100 ? `linear-gradient(90deg,${color},#6ee7b7)` : color }} />
                  </div>
                </div>
              )
            })()}

            <div className="section-label">{artistSeries.length} projet{artistSeries.length !== 1 ? 's' : ''} · {activeArtist}</div>

            {artistSeries.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">{activeArtist === 'Sherfflazone' ? '🎵' : '📊'}</div>
                <div className="empty-title">{activeArtist === 'Sherfflazone' ? 'Distribution Warner' : 'Aucun projet'}</div>
                <div className="empty-sub">{activeArtist === 'Sherfflazone' ? 'Importe un rapport Warner dans Suivi & Stats.' : `Crée un premier projet pour ${activeArtist}`}</div>
              </div>
            ) : artistSeries.map(serie => {
              const s = getSerieStats(serie)
              const color = COLORS[serie.artist] || '#f59e0b'
              return (
                <div key={serie.id} className="project-card" onClick={() => router.push(`/recoupe/${serie.id}`)}>
                  <div className="pc-top">
                    <div className="pc-left">
                      <div className="pc-type">{serie.singles?.length === 1 ? 'Single' : 'Série de singles'} · {serie.artist}</div>
                      <div className="pc-name">{serie.name}</div>
                      <div className="pc-meta">
                        {serie.singles?.length || 0} single{(serie.singles?.length || 0) > 1 ? 's' : ''}
                        {serie.coprod_name && ` · co-prod ${serie.coprod_name}`}
                        {' · '}Contrat {serie.artist_rate}% / {serie.label_rate}/{serie.coprod_rate}
                      </div>
                    </div>
                    <div className="pc-right">
                      <div className="pc-pct" style={{ color: pctColor(s.pct) }}>{s.pct.toFixed(1)}%</div>
                      <div className="pc-pct-sub">{s.pct >= 100 ? 'recoupé ✓' : 'de recoupe'}</div>
                    </div>
                  </div>
                  <div className="prog-bg">
                    <div className="prog-fill" style={{ width: `${s.pct}%`, background: s.pct >= 100 ? `linear-gradient(90deg,${color},#6ee7b7)` : color }} />
                  </div>
                  <div className="pc-stats">
                    <div><div className="pcs-label">Budget investi</div><div className="pcs-val">€{Math.round(s.totalBudgetEur).toLocaleString('fr-FR')}</div><div className="pcs-sub">≈ ${Math.round(s.budgetUsd).toLocaleString('fr-FR')}</div></div>
                    <div><div className="pcs-label">Total généré</div><div className="pcs-val pos">{fmt(s.totalUsd)}</div><div className="pcs-sub">{fmtStreams(s.totalQty)} streams</div></div>
                    {s.pct >= 100
                      ? <div><div className="pcs-label">Bénéfice net</div><div className="pcs-val" style={{ color: '#6ee7b7' }}>{fmt(s.profit)}</div>{serie.coprod_name && <div className="pcs-sub" style={{ color: '#eab308' }}>{serie.coprod_name} : {fmt(s.coprodShare)}</div>}</div>
                      : <div><div className="pcs-label">Reste à recouper</div><div className="pcs-val warn">{fmt(s.remaining)}</div>{serie.coprod_name && <div className="pcs-sub">{serie.coprod_name} : $0 perçu</div>}</div>
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
      {showModal && <NewProjectModal defaultArtist={activeArtist || 'Magie!'} onClose={() => setShowModal(false)} onSuccess={fetchAll} />}

      <style jsx>{`
        .breadcrumb { font-size:11px; color:#444; margin-bottom:20px; display:flex; align-items:center; gap:6px; }
        .bc-link { color:#555; cursor:pointer; } .bc-link:hover { color:#aaa; }
        .bc-sep { color:#333; } .bc-current { color:#888; display:flex; align-items:center; }
        .label-card { background:#141414; border:1px solid #1e1e1e; border-radius:12px; padding:18px 20px; margin-bottom:16px; cursor:pointer; transition:border-color .2s; }
        .label-card:hover { border-color:#2a2a2a; }
        .lc-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
        .lc-left { display:flex; align-items:center; gap:10px; font-size:15px; font-weight:700; color:#eee; }
        .lc-dot { width:8px; height:8px; border-radius:50%; background:linear-gradient(135deg,#f97316,#a78bfa); flex-shrink:0; }
        .lc-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
        .sl { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:1.2px; margin-bottom:4px; }
        .sv { font-size:16px; font-weight:700; color:#eee; }
        .ss { font-size:11px; color:#555; margin-top:2px; }
        .prog-bg { height:5px; background:#1e1e1e; border-radius:3px; overflow:hidden; }
        .prog-fill { height:100%; border-radius:3px; }
        .artist-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; }
        .artist-card { background:#141414; border:1px solid #1e1e1e; border-radius:12px; padding:16px 18px; cursor:pointer; transition:border-color .2s,background .2s; }
        .artist-card:hover { border-color:#2a2a2a; background:#161616; }
        .ac-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:12px; }
        .ac-left { display:flex; align-items:flex-start; gap:9px; }
        .ac-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:3px; }
        .ac-name { font-size:15px; font-weight:700; color:#eee; margin-bottom:2px; }
        .ac-meta { font-size:11px; color:#555; }
        .ac-right { text-align:right; flex-shrink:0; }
        .ac-pct { font-size:22px; font-weight:800; line-height:1; }
        .ac-pct-sub { font-size:10px; color:#555; margin-top:2px; }
        .ac-stats { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
        .ac-empty { font-size:11px; color:#333; margin-top:10px; padding-top:10px; border-top:1px solid #1a1a1a; }
        .section-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:2px; color:#444; margin-bottom:14px; }
        .project-card { background:#141414; border:1px solid #1e1e1e; border-radius:12px; padding:20px 22px; margin-bottom:12px; cursor:pointer; transition:border-color .2s,background .2s; }
        .project-card:hover { border-color:#2a2a2a; background:#161616; }
        .pc-top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:14px; }
        .pc-type { font-size:10px; color:#555; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px; }
        .pc-name { font-size:16px; font-weight:700; color:#eee; margin-bottom:3px; }
        .pc-meta { font-size:12px; color:#555; }
        .pc-right { text-align:right; flex-shrink:0; }
        .pc-pct { font-size:28px; font-weight:800; line-height:1; }
        .pc-pct-sub { font-size:11px; color:#555; margin-top:2px; }
        .pc-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:14px; }
        .pcs-label { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
        .pcs-val { font-size:14px; font-weight:700; color:#eee; }
        .pcs-sub { font-size:10px; color:#555; margin-top:2px; }
        .pos { color:#6ee7b7 !important; } .warn { color:#f59e0b !important; }
        .pc-footer { display:flex; justify-content:flex-end; gap:8px; padding-top:12px; border-top:1px solid #1a1a1a; margin-top:14px; }
        .edit-btn { background:none; border:1px solid #1e2a1e; color:#4a7a4a; font-size:11px; padding:5px 12px; border-radius:5px; cursor:pointer; font-family:inherit; transition:all .2s; }
        .edit-btn:hover { background:#0a1a0a; color:#6ee7b7; border-color:#6ee7b744; }
        .del-btn { background:none; border:1px solid #2a1010; color:#664; font-size:11px; padding:5px 12px; border-radius:5px; cursor:pointer; font-family:inherit; transition:all .2s; }
        .del-btn:hover { background:#1a0808; color:#f87171; border-color:#f8717144; }
        .new-project-btn { width:100%; padding:18px; background:none; border:1.5px dashed #1e1e1e; border-radius:12px; text-align:center; color:#333; font-size:13px; cursor:pointer; font-family:inherit; transition:all .2s; margin-top:4px; }
        .new-project-btn:hover { border-color:#333; color:#666; }
        .empty-state { text-align:center; padding:48px 20px; }
        .empty-icon { font-size:36px; margin-bottom:12px; }
        .empty-title { font-size:16px; font-weight:700; color:#555; margin-bottom:6px; }
        .empty-sub { font-size:13px; color:#333; max-width:340px; margin:0 auto; line-height:1.6; }
      `}</style>
    </div>
  )
}
