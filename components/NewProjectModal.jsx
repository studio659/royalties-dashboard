import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS } from '../lib/artists'

const PROJECT_TYPES = [
  { value: 'single', label: 'Single' },
  { value: 'serie', label: 'Série de singles' },
  { value: 'ep', label: 'EP' },
  { value: 'album', label: 'Album' },
]

export default function NewProjectModal({ onClose, onSuccess, defaultArtist }) {
  const [step, setStep] = useState(1) // 1: infos, 2: contrat, 3: titres + budget
  const [saving, setSaving] = useState(false)
  const [availableTitles, setAvailableTitles] = useState([])

  // Step 1 — Infos générales
  const [artist, setArtist] = useState(defaultArtist || 'Magie!')
  const [name, setName] = useState('')
  const [type, setType] = useState('serie')
  const [releaseDate, setReleaseDate] = useState('')
  const [notes, setNotes] = useState('')

  // Step 2 — Contrat
  const [artistRate, setArtistRate] = useState(12)
  const [coprodName, setCoprodName] = useState('')
  const [coprodRate, setCoprodRate] = useState(0)
  const [labelRate, setLabelRate] = useState(60)
  const [mgmtRate, setMgmtRate] = useState(5)

  // Step 3 — Singles + budget
  const [singles, setSingles] = useState([
    { title: '', releaseDate: '', budget: '', lines: [{ label: '', amount: '', status: 'pending' }] }
  ])

  useEffect(() => {
    fetchTitles()
  }, [artist])

  async function fetchTitles() {
    // Fetch unique titles for this artist from royalties
    let all = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('royalties')
        .select('title')
        .eq('artist', artist)
        .range(from, from + 999)
      if (error || !data || data.length === 0) break
      all = all.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    const unique = [...new Set(all.map(r => r.title))].sort()
    setAvailableTitles(unique)
  }

  function addSingle() {
    setSingles([...singles, { title: '', releaseDate: '', budget: '', lines: [{ label: '', amount: '', status: 'pending' }] }])
  }

  function removeSingle(i) {
    setSingles(singles.filter((_, idx) => idx !== i))
  }

  function updateSingle(i, field, value) {
    const updated = [...singles]
    updated[i] = { ...updated[i], [field]: value }
    setSingles(updated)
  }

  function addBudgetLine(si) {
    const updated = [...singles]
    updated[si].lines = [...updated[si].lines, { label: '', amount: '', status: 'pending' }]
    setSingles(updated)
  }

  function removeBudgetLine(si, li) {
    const updated = [...singles]
    updated[si].lines = updated[si].lines.filter((_, idx) => idx !== li)
    setSingles(updated)
  }

  function updateLine(si, li, field, value) {
    const updated = [...singles]
    updated[si].lines[li] = { ...updated[si].lines[li], [field]: value }
    setSingles(updated)
  }

  // Auto-calculate budget total
  function getBudgetTotal(single) {
    return single.lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  }

  // Label rate = 100 - coprodRate (of the co-prod pool)
  function handleCoprodRateChange(v) {
    setCoprodRate(v)
    setLabelRate(100 - v)
  }

  async function handleSave() {
    if (!name || singles.some(s => !s.title)) return
    setSaving(true)

    try {
      // Insert series
      const { data: serie, error: serieErr } = await supabase
        .from('series')
        .insert({
          artist,
          name,
          notes,
          artist_rate: parseFloat(artistRate),
          coprod_name: coprodName || null,
          coprod_rate: parseFloat(coprodRate),
          label_rate: parseFloat(labelRate),
          mgmt_rate: parseFloat(mgmtRate),
        })
        .select()
        .single()

      if (serieErr) throw serieErr

      // Insert singles + budget lines
      for (const s of singles) {
        const budgetTotal = getBudgetTotal(s) || parseFloat(s.budget) || 0
        const { data: single, error: sErr } = await supabase
          .from('singles')
          .insert({
            series_id: serie.id,
            artist,
            title: s.title,
            release_date: s.releaseDate || null,
            budget_eur: budgetTotal,
            status: 'active',
          })
          .select()
          .single()

        if (sErr) throw sErr

        // Insert budget lines
        const validLines = s.lines.filter(l => l.label && parseFloat(l.amount) >= 0)
        if (validLines.length > 0) {
          await supabase.from('budget_lines').insert(
            validLines.map(l => ({
              single_id: single.id,
              label: l.label,
              amount_eur: parseFloat(l.amount) || 0,
              status: l.status,
            }))
          )
        }
      }

      setSaving(false)
      onSuccess()
      onClose()
    } catch (err) {
      console.error(err)
      setSaving(false)
      alert('Erreur : ' + err.message)
    }
  }

  const color = COLORS[artist] || '#f59e0b'
  const canNext1 = name && artist
  const canNext2 = true
  const canSave = singles.every(s => s.title)

  return (
    <div className="modal-overlay" onClick={!saving ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        {/* HEADER */}
        <div className="modal-header">
          <div>
            <div className="modal-title">Nouveau projet</div>
            <div className="modal-steps">
              <span className={step >= 1 ? 'step active' : 'step'}>1 Infos</span>
              <span className="step-sep">›</span>
              <span className={step >= 2 ? 'step active' : 'step'}>2 Contrat</span>
              <span className="step-sep">›</span>
              <span className={step >= 3 ? 'step active' : 'step'}>3 Singles & Budget</span>
            </div>
          </div>
          {!saving && <button className="close-btn" onClick={onClose}>✕</button>}
        </div>

        <div className="modal-body">

          {/* ── STEP 1 : INFOS ── */}
          {step === 1 && (
            <div>
              <div className="field">
                <label>Artiste</label>
                <div className="artist-pills">
                  {[...ARTISTS, 'Sherfflazone'].map(a => (
                    <button
                      key={a}
                      className={`artist-pill ${artist === a ? 'active' : ''}`}
                      style={artist === a ? { background: COLORS[a] + '22', borderColor: COLORS[a], color: COLORS[a] } : {}}
                      onClick={() => setArtist(a)}
                    >
                      <span className="ap-dot" style={{ background: COLORS[a] || '#888' }} />
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Nom du projet</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="ex: Série de singles 2025-2026"
                  autoFocus
                />
              </div>

              <div className="field">
                <label>Type de projet</label>
                <div className="type-pills">
                  {PROJECT_TYPES.map(t => (
                    <button
                      key={t.value}
                      className={`type-pill ${type === t.value ? 'active' : ''}`}
                      onClick={() => setType(t.value)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Notes (optionnel)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Contexte, infos contrat global..."
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* ── STEP 2 : CONTRAT ── */}
          {step === 2 && (
            <div>
              <div className="contract-info">
                Les taux s'appliquent à tous les singles de ce projet. Tu pourras les modifier single par single si besoin.
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Part artiste (%)</label>
                  <input type="number" value={artistRate} onChange={e => setArtistRate(e.target.value)} min="0" max="100" step="0.5" />
                  <div className="field-hint">Sur les royalties totales, dès le 1er $</div>
                </div>
                <div className="field">
                  <label>Frais de gestion Avlanche (%)</label>
                  <input type="number" value={mgmtRate} onChange={e => setMgmtRate(e.target.value)} min="0" max="100" step="0.5" />
                  <div className="field-hint">Sur les royalties totales</div>
                </div>
              </div>

              <div className="field">
                <label>Co-producteur (optionnel)</label>
                <input type="text" value={coprodName} onChange={e => setCoprodName(e.target.value)} placeholder="ex: Solanin" />
              </div>

              {coprodName && (
                <div className="field-row">
                  <div className="field">
                    <label>Part co-prod (%)</label>
                    <input type="number" value={coprodRate} onChange={e => handleCoprodRateChange(parseFloat(e.target.value))} min="0" max="100" step="5" />
                    <div className="field-hint">Du pool restant après artiste + gestion</div>
                  </div>
                  <div className="field">
                    <label>Part Avlanche label (%)</label>
                    <input type="number" value={labelRate} onChange={e => setLabelRate(e.target.value)} min="0" max="100" step="5" />
                    <div className="field-hint">Calculé automatiquement</div>
                  </div>
                </div>
              )}

              {/* PREVIEW */}
              <div className="contract-preview">
                <div className="cp-title">Aperçu de la répartition</div>
                <div className="cp-row">
                  <span style={{ color: COLORS[artist] || '#aaa' }}>{artist}</span>
                  <span>{artistRate}%</span>
                </div>
                <div className="cp-row">
                  <span style={{ color: '#6366f1' }}>Avlanche (gestion)</span>
                  <span>{mgmtRate}%</span>
                </div>
                {coprodName ? (
                  <>
                    <div className="cp-row">
                      <span style={{ color: '#f97316' }}>Avlanche (label)</span>
                      <span>{((100 - artistRate - mgmtRate) * labelRate / 100).toFixed(1)}%</span>
                    </div>
                    <div className="cp-row">
                      <span style={{ color: '#eab308' }}>{coprodName} (après recoupe)</span>
                      <span>{((100 - artistRate - mgmtRate) * coprodRate / 100).toFixed(1)}%</span>
                    </div>
                  </>
                ) : (
                  <div className="cp-row">
                    <span style={{ color: '#f97316' }}>Avlanche (label)</span>
                    <span>{(100 - artistRate - mgmtRate).toFixed(1)}%</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 3 : SINGLES + BUDGET ── */}
          {step === 3 && (
            <div>
              {singles.map((s, si) => (
                <div key={si} className="single-form">
                  <div className="sf-header">
                    <span className="sf-num">{si + 1}</span>
                    <div className="field" style={{ flex: 1, margin: 0 }}>
                      <label>Titre</label>
                      <div style={{ position: 'relative' }}>
                        <input
                          type="text"
                          value={s.title}
                          onChange={e => updateSingle(si, 'title', e.target.value)}
                          placeholder="Tape ou choisis dans la liste"
                          list={`titles-${si}`}
                        />
                        <datalist id={`titles-${si}`}>
                          {availableTitles.map(t => <option key={t} value={t} />)}
                        </datalist>
                      </div>
                      <div className="field-hint">
                        {availableTitles.length} titres disponibles dans le catalogue {artist}
                      </div>
                    </div>
                    <div className="field" style={{ width: 130, margin: 0 }}>
                      <label>Date de sortie</label>
                      <input type="month" value={s.releaseDate} onChange={e => updateSingle(si, 'releaseDate', e.target.value)} />
                    </div>
                    {singles.length > 1 && (
                      <button className="remove-btn" onClick={() => removeSingle(si)}>✕</button>
                    )}
                  </div>

                  <div className="budget-section">
                    <div className="budget-label">Budget · lignes de dépense</div>
                    {s.lines.map((line, li) => (
                      <div key={li} className="budget-line">
                        <input
                          type="text"
                          value={line.label}
                          onChange={e => updateLine(si, li, 'label', e.target.value)}
                          placeholder="ex: Mix, Master, Clip..."
                          className="line-label"
                        />
                        <div className="line-amount-wrap">
                          <span className="currency">€</span>
                          <input
                            type="number"
                            value={line.amount}
                            onChange={e => updateLine(si, li, 'amount', e.target.value)}
                            placeholder="0"
                            min="0"
                            className="line-amount"
                          />
                        </div>
                        <select
                          value={line.status}
                          onChange={e => updateLine(si, li, 'status', e.target.value)}
                          className="line-status"
                        >
                          <option value="paid">payé</option>
                          <option value="pending">en attente</option>
                        </select>
                        {s.lines.length > 1 && (
                          <button className="remove-line-btn" onClick={() => removeBudgetLine(si, li)}>✕</button>
                        )}
                      </div>
                    ))}
                    <button className="add-line-btn" onClick={() => addBudgetLine(si)}>
                      + Ajouter une ligne
                    </button>
                    {getBudgetTotal(s) > 0 && (
                      <div className="budget-total">Total : €{getBudgetTotal(s).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
                    )}
                  </div>
                </div>
              ))}

              <button className="add-single-btn" onClick={addSingle}>
                + Ajouter un single
              </button>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="modal-footer">
          {step > 1 && (
            <button className="btn-back" onClick={() => setStep(step - 1)}>← Retour</button>
          )}
          <div style={{ flex: 1 }} />
          {step < 3 && (
            <button
              className="btn-next"
              style={{ background: color }}
              onClick={() => setStep(step + 1)}
              disabled={step === 1 && !canNext1}
            >
              Suivant →
            </button>
          )}
          {step === 3 && (
            <button
              className="btn-save"
              style={{ background: color }}
              onClick={handleSave}
              disabled={!canSave || saving}
            >
              {saving ? 'Enregistrement…' : 'Créer le projet'}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.8);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; padding: 20px;
        }
        .modal {
          background: #141414; border: 1px solid #222; border-radius: 12px;
          width: 100%; max-width: 600px; max-height: 85vh;
          display: flex; flex-direction: column; overflow: hidden;
        }
        .modal-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          padding: 18px 22px; border-bottom: 1px solid #1e1e1e; flex-shrink: 0;
        }
        .modal-title { font-size: 15px; font-weight: 700; color: #eee; margin-bottom: 6px; }
        .modal-steps { display: flex; align-items: center; gap: 6px; font-size: 11px; }
        .step { color: #333; }
        .step.active { color: #888; font-weight: 600; }
        .step-sep { color: #222; }
        .close-btn { background: none; border: none; color: #444; font-size: 16px; cursor: pointer; padding: 0; }
        .close-btn:hover { color: #eee; }

        .modal-body { padding: 20px 22px; overflow-y: auto; flex: 1; }

        .field { margin-bottom: 16px; }
        .field label {
          display: block; font-size: 10px; color: #555; text-transform: uppercase;
          letter-spacing: 1.5px; margin-bottom: 7px;
        }
        .field input, .field textarea, .field select {
          width: 100%; background: #1a1a1a; border: 1px solid #2a2a2a;
          border-radius: 6px; color: #eee; font-size: 13px; padding: 9px 12px;
          outline: none; font-family: inherit; transition: border-color .2s;
        }
        .field input:focus, .field textarea:focus { border-color: #444; }
        .field textarea { resize: vertical; }
        .field-hint { font-size: 10px; color: #444; margin-top: 5px; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        .artist-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .artist-pill {
          padding: 6px 14px; border-radius: 20px; border: 1px solid #2a2a2a;
          background: transparent; color: #555; font-size: 12px; font-weight: 600;
          cursor: pointer; font-family: inherit; display: flex; align-items: center; gap: 6px;
          transition: all .2s;
        }
        .ap-dot { width: 6px; height: 6px; border-radius: 50%; }

        .type-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .type-pill {
          padding: 6px 14px; border-radius: 6px; border: 1px solid #2a2a2a;
          background: transparent; color: #555; font-size: 12px; cursor: pointer;
          font-family: inherit; transition: all .2s;
        }
        .type-pill.active { background: #1e1e1e; color: #eee; border-color: #444; }

        .contract-info {
          background: #0f0f0f; border: 1px solid #1e1e1e; border-radius: 7px;
          padding: 12px 14px; font-size: 12px; color: #555; margin-bottom: 18px; line-height: 1.5;
        }
        .contract-preview {
          background: #0f0f0f; border: 1px solid #1e1e1e; border-radius: 8px;
          padding: 14px 16px; margin-top: 16px;
        }
        .cp-title { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
        .cp-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }

        .single-form {
          background: #0f0f0f; border: 1px solid #1e1e1e; border-radius: 9px;
          padding: 16px; margin-bottom: 12px;
        }
        .sf-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 14px; }
        .sf-num {
          width: 24px; height: 24px; border-radius: 50%; background: #1e1e1e;
          color: #555; font-size: 11px; font-weight: 700; display: flex;
          align-items: center; justify-content: center; flex-shrink: 0; margin-top: 22px;
        }
        .remove-btn {
          background: none; border: none; color: #444; font-size: 14px;
          cursor: pointer; padding: 0; margin-top: 22px; flex-shrink: 0;
        }
        .remove-btn:hover { color: #f87171; }

        .budget-section { border-top: 1px solid #1a1a1a; padding-top: 14px; }
        .budget-label { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
        .budget-line { display: flex; gap: 8px; margin-bottom: 7px; align-items: center; }
        .line-label {
          flex: 1; background: #141414; border: 1px solid #222; border-radius: 5px;
          color: #eee; font-size: 12px; padding: 7px 10px; outline: none; font-family: inherit;
        }
        .line-label:focus { border-color: #333; }
        .line-amount-wrap { display: flex; align-items: center; background: #141414; border: 1px solid #222; border-radius: 5px; padding: 0 10px; width: 90px; flex-shrink: 0; }
        .currency { color: #555; font-size: 12px; margin-right: 4px; }
        .line-amount { background: none; border: none; color: #eee; font-size: 12px; width: 50px; outline: none; font-family: inherit; padding: 7px 0; }
        .line-status {
          background: #141414; border: 1px solid #222; border-radius: 5px;
          color: #888; font-size: 11px; padding: 7px 8px; outline: none;
          font-family: inherit; cursor: pointer; flex-shrink: 0;
        }
        .remove-line-btn { background: none; border: none; color: #333; font-size: 12px; cursor: pointer; padding: 0; flex-shrink: 0; }
        .remove-line-btn:hover { color: #f87171; }
        .add-line-btn {
          background: none; border: 1px dashed #1e1e1e; border-radius: 5px;
          color: #444; font-size: 11px; padding: 6px 12px; cursor: pointer;
          font-family: inherit; width: 100%; margin-top: 4px; transition: all .2s;
        }
        .add-line-btn:hover { border-color: #333; color: #666; }
        .budget-total { font-size: 12px; font-weight: 700; color: #eee; text-align: right; margin-top: 10px; padding-top: 8px; border-top: 1px solid #1e1e1e; }

        .add-single-btn {
          width: 100%; padding: 12px; background: none; border: 1.5px dashed #1e1e1e;
          border-radius: 8px; color: #444; font-size: 12px; cursor: pointer;
          font-family: inherit; transition: all .2s;
        }
        .add-single-btn:hover { border-color: #333; color: #666; }

        .modal-footer {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 22px; border-top: 1px solid #1e1e1e; flex-shrink: 0;
        }
        .btn-back {
          background: none; border: 1px solid #2a2a2a; border-radius: 7px;
          color: #555; font-size: 13px; font-weight: 600; padding: 9px 16px;
          cursor: pointer; font-family: inherit; transition: all .2s;
        }
        .btn-back:hover { color: #eee; border-color: #444; }
        .btn-next, .btn-save {
          color: #000; border: none; border-radius: 7px; font-size: 13px;
          font-weight: 700; padding: 9px 20px; cursor: pointer;
          font-family: inherit; transition: opacity .2s;
        }
        .btn-next:hover, .btn-save:hover { opacity: .85; }
        .btn-next:disabled, .btn-save:disabled { opacity: .4; cursor: default; }
      `}</style>
    </div>
  )
}
