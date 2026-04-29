import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS } from '../lib/artists'

export default function NewProjectModal({ onClose, onSuccess, defaultArtist }) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [availableTitles, setAvailableTitles] = useState([])
  const [existingSeries, setExistingSeries] = useState([])
  const [budgetError, setBudgetError] = useState('')

  // Step 1 — Artiste + Titres
  const [artist, setArtist] = useState(defaultArtist || 'Magie!')
  const [type, setType] = useState('serie')
  const [projectName, setProjectName] = useState('')
  const [selectedTitles, setSelectedTitles] = useState([])

  // Step 2 — Budget par titre
  const [budgets, setBudgets] = useState({}) // { title: { lines: [], releaseDate: '' } }

  // Step 3 — Contrat
  const [copyFromSerie, setCopyFromSerie] = useState('')
  const [artistRate, setArtistRate] = useState(12)
  const [coprodName, setCoprodName] = useState('')
  const [coprodRate, setCoprodRate] = useState(0)
  const [labelRate, setLabelRate] = useState(88)
  const [mgmtRate, setMgmtRate] = useState(5)
  const [notes, setNotes] = useState('')

  useEffect(() => { fetchTitles(); fetchExistingSeries() }, [artist])

  async function fetchTitles() {
    let all = [], from = 0
    while (true) {
      const { data, error } = await supabase.from('royalties').select('title').eq('artist', artist).range(from, from + 999)
      if (error || !data || !data.length) break
      all = all.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setAvailableTitles([...new Set(all.map(r => r.title))].sort())
    setSelectedTitles([])
    setBudgets({})
  }

  async function fetchExistingSeries() {
    const { data } = await supabase.from('series').select('id,name,artist_rate,coprod_name,coprod_rate,label_rate,mgmt_rate').eq('artist', artist)
    setExistingSeries(data || [])
  }

  function toggleTitle(t) {
    const next = selectedTitles.includes(t)
      ? selectedTitles.filter(x => x !== t)
      : [...selectedTitles, t]
    setSelectedTitles(next)
    // Auto-name
    if (!projectName || projectName === autoName(selectedTitles)) {
      setProjectName(autoName(next))
    }
    // Init budget slot
    if (!budgets[t]) {
      setBudgets(prev => ({ ...prev, [t]: { lines: [], releaseDate: '' } }))
    }
  }

  function autoName(titles) {
    if (titles.length === 0) return ''
    if (titles.length === 1) return titles[0]
    return `Série ${artist} ${new Date().getFullYear()}`
  }

  function applyCopyContract(serieId) {
    setCopyFromSerie(serieId)
    if (!serieId) return
    const s = existingSeries.find(x => x.id === parseInt(serieId))
    if (!s) return
    setArtistRate(s.artist_rate)
    setCoprodName(s.coprod_name || '')
    setCoprodRate(s.coprod_rate)
    setLabelRate(s.label_rate)
    setMgmtRate(s.mgmt_rate)
  }

  function handleCoprodRate(v) {
    const cr = parseFloat(v) || 0
    setCoprodRate(cr)
    setLabelRate(100 - cr)
  }

  function updateBudget(title, field, value) {
    setBudgets(prev => ({ ...prev, [title]: { ...prev[title], [field]: value } }))
  }

  function addLine(title) {
    setBudgets(prev => ({
      ...prev,
      [title]: { ...prev[title], lines: [...(prev[title]?.lines || []), { label: '', amount: '', status: 'pending' }] }
    }))
  }

  function removeLine(title, li) {
    setBudgets(prev => ({
      ...prev,
      [title]: { ...prev[title], lines: prev[title].lines.filter((_, i) => i !== li) }
    }))
  }

  function updateLine(title, li, field, value) {
    setBudgets(prev => {
      const lines = [...prev[title].lines]
      lines[li] = { ...lines[li], [field]: value }
      return { ...prev, [title]: { ...prev[title], lines } }
    })
  }

  async function parseExcel(file, title) {
    setBudgetError('')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const lines = []
      for (const row of rows) {
        const label = String(row[0] || '').trim()
        const amount = parseFloat(String(row[1] || '').replace(',', '.').replace(/[^0-9.]/g, ''))
        const status = String(row[2] || '').toLowerCase().includes('pay') ? 'paid' : 'pending'
        if (label && !isNaN(amount) && amount >= 0) lines.push({ label, amount: String(amount), status })
      }
      if (!lines.length) { setBudgetError('Aucune ligne valide. Colonnes : Poste | Montant € | payé/en attente'); return }
      setBudgets(prev => ({ ...prev, [title]: { ...prev[title], lines } }))
    } catch (e) { setBudgetError('Erreur : ' + e.message) }
  }

  function getBudgetTotal(title) {
    return (budgets[title]?.lines || []).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  }

  async function handleSave() {
    if (!projectName || selectedTitles.length === 0) return
    setSaving(true)
    try {
      const { data: serie, error: sErr } = await supabase.from('series').insert({
        artist, name: projectName, notes,
        artist_rate: parseFloat(artistRate),
        coprod_name: coprodName || null,
        coprod_rate: parseFloat(coprodRate),
        label_rate: parseFloat(labelRate),
        mgmt_rate: parseFloat(mgmtRate),
      }).select().single()
      if (sErr) throw sErr

      for (const title of selectedTitles) {
        const b = budgets[title] || { lines: [], releaseDate: '' }
        const { data: single, error: siErr } = await supabase.from('singles').insert({
          series_id: serie.id, artist, title,
          release_date: b.releaseDate || null,
          budget_eur: getBudgetTotal(title),
          status: 'active',
        }).select().single()
        if (siErr) throw siErr
        const validLines = (b.lines || []).filter(l => l.label && parseFloat(l.amount) >= 0)
        if (validLines.length > 0) {
          await supabase.from('budget_lines').insert(
            validLines.map(l => ({ single_id: single.id, label: l.label, amount_eur: parseFloat(l.amount) || 0, status: l.status }))
          )
        }
      }
      setSaving(false); onSuccess(); onClose()
    } catch (err) {
      setSaving(false); alert('Erreur : ' + err.message)
    }
  }

  const color = COLORS[artist] || '#f59e0b'
  const poolPct = 100 - parseFloat(artistRate || 0) - parseFloat(mgmtRate || 0)

  return (
    <div className="overlay" onClick={!saving ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        <div className="mh">
          <div>
            <div className="mh-title">Nouveau projet</div>
            <div className="mh-steps">
              {['Titres','Budget','Contrat'].map((s, i) => (
                <span key={i} className={step===i+1?'ms active':step>i+1?'ms done':'ms'}>
                  {i>0&&<span className="ms-sep">›</span>}{i+1} {s}
                </span>
              ))}
            </div>
          </div>
          {!saving && <button className="xbtn" onClick={onClose}>✕</button>}
        </div>

        <div className="mb">

          {/* ── STEP 1 : ARTISTE + TITRES ── */}
          {step === 1 && (
            <div>
              <div className="field">
                <label>Artiste</label>
                <div className="pills">
                  {[...ARTISTS, 'Sherfflazone'].map(a => (
                    <button key={a} className={`apill ${artist===a?'active':''}`}
                      style={artist===a?{background:COLORS[a]+'22',borderColor:COLORS[a],color:COLORS[a]}:{}}
                      onClick={()=>setArtist(a)}>
                      <span className="apdot" style={{background:COLORS[a]||'#888'}}/>{a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Sélectionne les titres du projet</label>
                {availableTitles.length === 0 ? (
                  <div className="no-titles">Aucun titre trouvé — importe d'abord un CSV dans Suivi & Stats</div>
                ) : (
                  <div className="title-list">
                    {availableTitles.map(t => (
                      <div key={t}
                        className={`title-item ${selectedTitles.includes(t)?'selected':''}`}
                        style={selectedTitles.includes(t)?{borderColor:color,background:color+'11'}:{}}
                        onClick={()=>toggleTitle(t)}>
                        <span className="ti-check">{selectedTitles.includes(t)?'✓':''}</span>
                        <span className="ti-name">{t}</span>
                      </div>
                    ))}
                  </div>
                )}
                {selectedTitles.length > 0 && (
                  <div className="selected-count" style={{color}}>{selectedTitles.length} titre{selectedTitles.length>1?'s':''} sélectionné{selectedTitles.length>1?'s':''}</div>
                )}
              </div>

              <div className="field">
                <label>Nom du projet</label>
                <input type="text" value={projectName} onChange={e=>setProjectName(e.target.value)}
                  placeholder="Auto-généré — modifiable"/>
                <div className="field-hint">Généré automatiquement à partir des titres</div>
              </div>

              <div className="field">
                <label>Type</label>
                <div className="pills">
                  {[{v:'single',l:'Single'},{v:'serie',l:'Série de singles'},{v:'ep',l:'EP'},{v:'album',l:'Album'}].map(t => (
                    <button key={t.v} className={`tpill ${type===t.v?'active':''}`} onClick={()=>setType(t.v)}>{t.l}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2 : BUDGET PAR TITRE ── */}
          {step === 2 && (
            <div>
              {budgetError && <div className="error-msg">{budgetError}</div>}
              {selectedTitles.map(title => (
                <div key={title} className="single-block">
                  <div className="sb-header">
                    <div className="sb-title">{title}</div>
                    <div className="field" style={{margin:0,width:130}}>
                      <label>Date de sortie</label>
                      <input type="month" value={budgets[title]?.releaseDate||''} onChange={e=>updateBudget(title,'releaseDate',e.target.value)}/>
                    </div>
                  </div>

                  <div className="bs-row">
                    <span className="bs-label">Budget</span>
                    <label className="upload-budget-btn">
                      ↑ Importer Excel / CSV
                      <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e=>parseExcel(e.target.files[0],title)}/>
                    </label>
                  </div>
                  <div className="field-hint" style={{marginBottom:10}}>Colonnes : A = Poste · B = Montant € · C = payé / en attente</div>

                  {(budgets[title]?.lines||[]).map((line,li) => (
                    <div key={li} className="line-row">
                      <input type="text" value={line.label} onChange={e=>updateLine(title,li,'label',e.target.value)}
                        placeholder="Poste de dépense..." className="line-label"/>
                      <div className="line-amt-wrap">
                        <span className="cur">€</span>
                        <input type="number" value={line.amount} onChange={e=>updateLine(title,li,'amount',e.target.value)}
                          placeholder="0" min="0" className="line-amt"/>
                      </div>
                      <select value={line.status} onChange={e=>updateLine(title,li,'status',e.target.value)} className="line-st">
                        <option value="paid">payé</option>
                        <option value="pending">en attente</option>
                      </select>
                      <button className="rm-line" onClick={()=>removeLine(title,li)}>✕</button>
                    </div>
                  ))}
                  <button className="add-line-btn" onClick={()=>addLine(title)}>+ Ligne</button>
                  {getBudgetTotal(title)>0 && (
                    <div className="budget-tot">Total : €{getBudgetTotal(title).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:2})}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── STEP 3 : CONTRAT ── */}
          {step === 3 && (
            <div>
              {existingSeries.length > 0 && (
                <div className="field">
                  <label>Copier un contrat existant</label>
                  <select value={copyFromSerie} onChange={e=>applyCopyContract(e.target.value)}>
                    <option value="">— Configurer manuellement —</option>
                    {existingSeries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <div className="field-hint">Les taux se rempliront automatiquement</div>
                </div>
              )}

              <div className="hint-box">Les taux s'appliquent à tous les titres du projet.</div>

              <div className="field-row">
                <div className="field">
                  <label>Part artiste (%)</label>
                  <input type="number" value={artistRate} onChange={e=>setArtistRate(e.target.value)} min="0" max="100" step="0.5"/>
                  <div className="field-hint">Sur les royalties totales · dès le 1er $</div>
                </div>
                <div className="field">
                  <label>Gestion Avlanche (%)</label>
                  <input type="number" value={mgmtRate} onChange={e=>setMgmtRate(e.target.value)} min="0" max="100" step="0.5"/>
                </div>
              </div>

              <div className="field">
                <label>Co-producteur (optionnel)</label>
                <input type="text" value={coprodName} onChange={e=>setCoprodName(e.target.value)} placeholder="ex: Solanin"/>
              </div>

              {coprodName && (
                <div className="field-row">
                  <div className="field">
                    <label>Part co-prod (%)</label>
                    <input type="number" value={coprodRate} onChange={e=>handleCoprodRate(e.target.value)} min="0" max="100" step="5"/>
                    <div className="field-hint">Du pool restant après artiste + gestion</div>
                  </div>
                  <div className="field">
                    <label>Part Avlanche label (%)</label>
                    <input type="number" value={labelRate} onChange={e=>setLabelRate(e.target.value)} min="0" max="100" step="5"/>
                  </div>
                </div>
              )}

              <div className="preview">
                <div className="preview-title">Répartition · phase bénéfice (après recoupe)</div>
                <div className="preview-row"><span style={{color:COLORS[artist]||'#aaa'}}>{artist}</span><span>{artistRate}%</span></div>
                <div className="preview-row"><span style={{color:'#6366f1'}}>Avlanche gestion</span><span>{mgmtRate}%</span></div>
                {coprodName ? <>
                  <div className="preview-row"><span style={{color:'#f97316'}}>Avlanche label</span><span>{(poolPct*parseFloat(labelRate)/100).toFixed(1)}%</span></div>
                  <div className="preview-row"><span style={{color:'#eab308'}}>{coprodName}</span><span>{(poolPct*parseFloat(coprodRate)/100).toFixed(1)}%</span></div>
                </> : (
                  <div className="preview-row"><span style={{color:'#f97316'}}>Avlanche label</span><span>{poolPct.toFixed(1)}%</span></div>
                )}
              </div>

              <div className="field" style={{marginTop:14}}>
                <label>Notes (optionnel)</label>
                <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Clauses particulières, contexte..." rows={2}/>
              </div>
            </div>
          )}
        </div>

        <div className="mf">
          {step>1 && <button className="btn-back" onClick={()=>setStep(step-1)}>← Retour</button>}
          <div style={{flex:1}}/>
          {step<3 && (
            <button className="btn-next" style={{background:color}}
              onClick={()=>setStep(step+1)}
              disabled={step===1&&(!projectName||selectedTitles.length===0)}>
              Suivant →
            </button>
          )}
          {step===3 && (
            <button className="btn-save" style={{background:color}} onClick={handleSave} disabled={saving}>
              {saving?'Enregistrement…':'Créer le projet'}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .modal{background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:580px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
        .mh{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 22px;border-bottom:1px solid #1e1e1e;flex-shrink:0}
        .mh-title{font-size:15px;font-weight:700;color:#eee;margin-bottom:6px}
        .mh-steps{display:flex;align-items:center;gap:4px;font-size:11px}
        .ms{color:#333}.ms.active{color:#888;font-weight:600}.ms.done{color:#555}.ms-sep{margin:0 4px;color:#222}
        .xbtn{background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0}.xbtn:hover{color:#eee}
        .mb{padding:20px 22px;overflow-y:auto;flex:1}
        .field{margin-bottom:16px}
        .field label{display:block;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:7px}
        .field input,.field textarea,.field select{width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#eee;font-size:13px;padding:9px 12px;outline:none;font-family:inherit;transition:border-color .2s}
        .field input:focus,.field textarea:focus,.field select:focus{border-color:#444}
        .field textarea{resize:vertical}
        .field-hint{font-size:10px;color:#444;margin-top:5px}
        .field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .pills{display:flex;gap:6px;flex-wrap:wrap}
        .apill{padding:6px 14px;border-radius:20px;border:1px solid #2a2a2a;background:transparent;color:#555;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px;transition:all .2s}
        .apdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
        .tpill{padding:6px 14px;border-radius:6px;border:1px solid #2a2a2a;background:transparent;color:#555;font-size:12px;cursor:pointer;font-family:inherit;transition:all .2s}
        .tpill.active{background:#1e1e1e;color:#eee;border-color:#444}
        .title-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;margin-bottom:10px}
        .title-item{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#1a1a1a;border:1px solid #222;border-radius:7px;cursor:pointer;transition:all .2s}
        .title-item:hover{border-color:#333}
        .title-item.selected{font-weight:600}
        .ti-check{width:16px;height:16px;border-radius:4px;background:#1e1e1e;border:1px solid #333;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;color:#6ee7b7}
        .title-item.selected .ti-check{background:#6ee7b744;border-color:#6ee7b7}
        .ti-name{font-size:13px;color:#ddd}
        .selected-count{font-size:11px;font-weight:600;margin-top:4px}
        .no-titles{background:#1a0a0a;border:1px solid #f87171;border-radius:6px;padding:12px;font-size:12px;color:#f87171}
        .hint-box{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:6px;padding:10px 12px;font-size:11px;color:#555;margin-bottom:14px;line-height:1.5}
        .error-msg{background:#1a0808;border:1px solid #f87171;border-radius:5px;padding:8px 12px;font-size:11px;color:#f87171;margin-bottom:10px}
        .single-block{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:9px;padding:16px;margin-bottom:12px}
        .sb-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
        .sb-title{font-size:14px;font-weight:700;color:#eee;flex:1;padding-top:4px}
        .bs-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
        .bs-label{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px}
        .upload-budget-btn{background:none;border:1px solid #2a2a2a;border-radius:5px;color:#666;font-size:11px;padding:5px 10px;cursor:pointer;font-family:inherit;transition:all .2s}
        .upload-budget-btn:hover{border-color:#444;color:#aaa}
        .line-row{display:flex;gap:7px;margin-bottom:7px;align-items:center}
        .line-label{flex:1;background:#141414;border:1px solid #222;border-radius:5px;color:#eee;font-size:12px;padding:7px 10px;outline:none;font-family:inherit}
        .line-label:focus{border-color:#333}
        .line-amt-wrap{display:flex;align-items:center;background:#141414;border:1px solid #222;border-radius:5px;padding:0 10px;width:90px;flex-shrink:0}
        .cur{color:#555;font-size:12px;margin-right:4px}
        .line-amt{background:none;border:none;color:#eee;font-size:12px;width:50px;outline:none;font-family:inherit;padding:7px 0}
        .line-st{background:#141414;border:1px solid #222;border-radius:5px;color:#888;font-size:11px;padding:7px 8px;outline:none;font-family:inherit;cursor:pointer;flex-shrink:0}
        .rm-line{background:none;border:none;color:#333;font-size:12px;cursor:pointer;padding:0;flex-shrink:0}.rm-line:hover{color:#f87171}
        .add-line-btn{background:none;border:1px dashed #1e1e1e;border-radius:5px;color:#444;font-size:11px;padding:6px 12px;cursor:pointer;font-family:inherit;width:100%;margin-top:4px;transition:all .2s}.add-line-btn:hover{border-color:#333;color:#666}
        .budget-tot{font-size:12px;font-weight:700;color:#eee;text-align:right;margin-top:10px;padding-top:8px;border-top:1px solid #1e1e1e}
        .preview{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px 16px;margin-top:4px}
        .preview-title{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
        .preview-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0}
        .mf{display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #1e1e1e;flex-shrink:0}
        .btn-back{background:none;border:1px solid #2a2a2a;border-radius:7px;color:#555;font-size:13px;font-weight:600;padding:9px 16px;cursor:pointer;font-family:inherit;transition:all .2s}.btn-back:hover{color:#eee;border-color:#444}
        .btn-next,.btn-save{color:#000;border:none;border-radius:7px;font-size:13px;font-weight:700;padding:9px 20px;cursor:pointer;font-family:inherit;transition:opacity .2s}
        .btn-next:hover,.btn-save:hover{opacity:.85}
        .btn-next:disabled,.btn-save:disabled{opacity:.4;cursor:default}
      `}</style>
    </div>
  )
}
