import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS } from '../lib/artists'
import * as XLSX from 'xlsx'

const PROJECT_TYPES = [
  { value: 'single', label: 'Single' },
  { value: 'serie', label: 'Série de singles' },
  { value: 'ep', label: 'EP' },
  { value: 'album', label: 'Album' },
]

export default function NewProjectModal({ onClose, onSuccess, defaultArtist }) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [availableTitles, setAvailableTitles] = useState([])
  const [existingSeries, setExistingSeries] = useState([])

  // Step 1
  const [artist, setArtist] = useState(defaultArtist || 'Magie!')
  const [name, setName] = useState('')
  const [type, setType] = useState('serie')
  const [notes, setNotes] = useState('')
  const [contractFile, setContractFile] = useState(null)

  // Step 2 — Contrat
  const [copyFromSerie, setCopyFromSerie] = useState('')
  const [artistRate, setArtistRate] = useState(12)
  const [coprodName, setCoprodName] = useState('')
  const [coprodRate, setCoprodRate] = useState(0)
  const [labelRate, setLabelRate] = useState(88)
  const [mgmtRate, setMgmtRate] = useState(5)

  // Step 3 — Singles + budget
  const [singles, setSingles] = useState([
    { title: '', releaseDate: '', lines: [] }
  ])
  const [budgetFile, setBudgetFile] = useState(null)
  const [budgetFileError, setBudgetFileError] = useState('')

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
  }

  async function fetchExistingSeries() {
    const { data } = await supabase.from('series').select('id, name, artist_rate, coprod_name, coprod_rate, label_rate, mgmt_rate').eq('artist', artist)
    setExistingSeries(data || [])
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

  // Parse budget file (Excel or CSV)
  async function parseBudgetFile(file, singleIndex) {
    setBudgetFileError('')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      const lines = []
      for (const row of rows) {
        const label = String(row[0] || '').trim()
        const amount = parseFloat(String(row[1] || '').replace(',', '.'))
        const status = String(row[2] || '').toLowerCase().includes('payé') ? 'paid' : 'pending'
        if (label && !isNaN(amount) && amount > 0) {
          lines.push({ label, amount: String(amount), status })
        }
      }

      if (!lines.length) { setBudgetFileError('Aucune ligne valide trouvée. Format attendu : Poste | Montant € | payé/en attente'); return }

      const updated = [...singles]
      updated[singleIndex].lines = lines
      setSingles(updated)
      setBudgetFile(file)
    } catch (e) {
      setBudgetFileError('Erreur de lecture du fichier : ' + e.message)
    }
  }

  function addSingle() {
    setSingles([...singles, { title: '', releaseDate: '', lines: [] }])
  }

  function removeSingle(i) { setSingles(singles.filter((_, idx) => idx !== i)) }

  function updateSingle(i, field, value) {
    const updated = [...singles]
    updated[i] = { ...updated[i], [field]: value }
    setSingles(updated)
  }

  function addLine(si) {
    const updated = [...singles]
    updated[si].lines = [...(updated[si].lines || []), { label: '', amount: '', status: 'pending' }]
    setSingles(updated)
  }

  function removeLine(si, li) {
    const updated = [...singles]
    updated[si].lines = updated[si].lines.filter((_, idx) => idx !== li)
    setSingles(updated)
  }

  function updateLine(si, li, field, value) {
    const updated = [...singles]
    updated[si].lines[li] = { ...updated[si].lines[li], [field]: value }
    setSingles(updated)
  }

  function getBudgetTotal(single) {
    return (single.lines || []).reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  }

  async function handleSave() {
    if (!name || singles.some(s => !s.title)) return
    setSaving(true)
    try {
      const { data: serie, error: sErr } = await supabase.from('series').insert({
        artist, name, notes,
        artist_rate: parseFloat(artistRate),
        coprod_name: coprodName || null,
        coprod_rate: parseFloat(coprodRate),
        label_rate: parseFloat(labelRate),
        mgmt_rate: parseFloat(mgmtRate),
      }).select().single()
      if (sErr) throw sErr

      for (const s of singles) {
        const budget = getBudgetTotal(s)
        const { data: single, error: siErr } = await supabase.from('singles').insert({
          series_id: serie.id, artist, title: s.title,
          release_date: s.releaseDate || null,
          budget_eur: budget, status: 'active',
        }).select().single()
        if (siErr) throw siErr

        const validLines = (s.lines || []).filter(l => l.label && parseFloat(l.amount) >= 0)
        if (validLines.length > 0) {
          await supabase.from('budget_lines').insert(
            validLines.map(l => ({ single_id: single.id, label: l.label, amount_eur: parseFloat(l.amount) || 0, status: l.status }))
          )
        }
      }

      setSaving(false)
      onSuccess()
      onClose()
    } catch (err) {
      setSaving(false)
      alert('Erreur : ' + err.message)
    }
  }

  const color = COLORS[artist] || '#f59e0b'
  const poolPct = 100 - parseFloat(artistRate || 0) - parseFloat(mgmtRate || 0)
  const labelBenef = (poolPct * parseFloat(labelRate || 0) / 100).toFixed(1)
  const coprodBenef = (poolPct * parseFloat(coprodRate || 0) / 100).toFixed(1)

  return (
    <div className="overlay" onClick={!saving ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        <div className="mh">
          <div>
            <div className="mh-title">Nouveau projet</div>
            <div className="mh-steps">
              {['Infos','Contrat','Titres & Budget'].map((s, i) => (
                <span key={i} className={step > i ? 'ms done' : step === i+1 ? 'ms active' : 'ms'}>
                  {i > 0 && <span className="ms-sep">›</span>}{i+1} {s}
                </span>
              ))}
            </div>
          </div>
          {!saving && <button className="xbtn" onClick={onClose}>✕</button>}
        </div>

        <div className="mb">

          {/* ── STEP 1 ── */}
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
                <label>Nom du projet</label>
                <input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="ex: Série de singles 2025-2026"/>
              </div>

              <div className="field">
                <label>Type</label>
                <div className="pills">
                  {PROJECT_TYPES.map(t => (
                    <button key={t.value} className={`tpill ${type===t.value?'active':''}`} onClick={()=>setType(t.value)}>{t.label}</button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Contrat (PDF, optionnel)</label>
                <div className="upload-zone" onClick={()=>document.getElementById('contract-upload').click()}>
                  <input id="contract-upload" type="file" accept=".pdf" style={{display:'none'}} onChange={e=>setContractFile(e.target.files[0])}/>
                  {contractFile ? <span style={{color:'#6ee7b7'}}>📄 {contractFile.name}</span> : <span>📎 Glisse ou clique — PDF du contrat signé</span>}
                </div>
                <div className="field-hint">Stocké pour référence uniquement</div>
              </div>

              <div className="field">
                <label>Notes</label>
                <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Contexte, clauses particulières..." rows={2}/>
              </div>
            </div>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <div>
              {existingSeries.length > 0 && (
                <div className="field">
                  <label>Copier un contrat existant</label>
                  <select value={copyFromSerie} onChange={e=>applyCopyContract(e.target.value)}>
                    <option value="">— Saisir manuellement —</option>
                    {existingSeries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <div className="field-hint">Les taux se rempliront automatiquement</div>
                </div>
              )}

              <div className="hint-box">Les taux s'appliquent à tous les singles. Modifiables single par single si besoin.</div>

              <div className="field-row">
                <div className="field">
                  <label>Part artiste (%)</label>
                  <input type="number" value={artistRate} onChange={e=>setArtistRate(e.target.value)} min="0" max="100" step="0.5"/>
                  <div className="field-hint">Sur les royalties totales, dès le 1er $</div>
                </div>
                <div className="field">
                  <label>Gestion Avlanche (%)</label>
                  <input type="number" value={mgmtRate} onChange={e=>setMgmtRate(e.target.value)} min="0" max="100" step="0.5"/>
                  <div className="field-hint">Sur les royalties totales</div>
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
                    <div className="field-hint">Du pool après artiste + gestion</div>
                  </div>
                  <div className="field">
                    <label>Part Avlanche label (%)</label>
                    <input type="number" value={labelRate} onChange={e=>setLabelRate(e.target.value)} min="0" max="100" step="5"/>
                  </div>
                </div>
              )}

              <div className="preview">
                <div className="preview-title">Répartition</div>
                <div className="preview-row"><span style={{color:COLORS[artist]||'#aaa'}}>{artist}</span><span>{artistRate}%</span></div>
                <div className="preview-row"><span style={{color:'#6366f1'}}>Avlanche gestion</span><span>{mgmtRate}%</span></div>
                {coprodName ? <>
                  <div className="preview-row"><span style={{color:'#f97316'}}>Avlanche label (après recoupe)</span><span>{labelBenef}%</span></div>
                  <div className="preview-row"><span style={{color:'#eab308'}}>{coprodName} (après recoupe)</span><span>{coprodBenef}%</span></div>
                </> : (
                  <div className="preview-row"><span style={{color:'#f97316'}}>Avlanche label</span><span>{poolPct.toFixed(1)}%</span></div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 3 ── */}
          {step === 3 && (
            <div>
              {singles.map((s, si) => (
                <div key={si} className="single-block">
                  <div className="sb-header">
                    <span className="sb-num">{si+1}</span>
                    <div className="field" style={{flex:1,margin:0}}>
                      <label>Titre du catalogue {artist}</label>
                      <select value={s.title} onChange={e=>updateSingle(si,'title',e.target.value)} className={!s.title?'empty':''}>
                        <option value="">— Choisir un titre —</option>
                        {availableTitles.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      {availableTitles.length===0 && <div className="field-hint" style={{color:'#f87171'}}>Aucun titre trouvé — importe d'abord un CSV dans Suivi & Stats</div>}
                    </div>
                    <div className="field" style={{width:130,margin:0}}>
                      <label>Date de sortie</label>
                      <input type="month" value={s.releaseDate} onChange={e=>updateSingle(si,'releaseDate',e.target.value)}/>
                    </div>
                    {singles.length>1 && <button className="rm-btn" onClick={()=>removeSingle(si)}>✕</button>}
                  </div>

                  <div className="budget-section">
                    <div className="bs-header">
                      <span className="bs-label">Budget</span>
                      <button className="upload-budget-btn" onClick={()=>document.getElementById(`budget-${si}`).click()}>
                        ↑ Importer depuis Excel/CSV
                      </button>
                      <input id={`budget-${si}`} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
                        onChange={e=>parseBudgetFile(e.target.files[0],si)}/>
                    </div>
                    {budgetFileError && <div className="error-msg">{budgetFileError}</div>}
                    <div className="hint-box" style={{marginBottom:10}}>
                      Format Excel : colonne A = Poste, B = Montant €, C = payé / en attente
                    </div>

                    {(s.lines||[]).map((line,li)=>(
                      <div key={li} className="line-row">
                        <input type="text" value={line.label} onChange={e=>updateLine(si,li,'label',e.target.value)} placeholder="ex: Mix, Master, Clip..." className="line-label"/>
                        <div className="line-amt-wrap"><span className="cur">€</span>
                          <input type="number" value={line.amount} onChange={e=>updateLine(si,li,'amount',e.target.value)} placeholder="0" min="0" className="line-amt"/>
                        </div>
                        <select value={line.status} onChange={e=>updateLine(si,li,'status',e.target.value)} className="line-st">
                          <option value="paid">payé</option>
                          <option value="pending">en attente</option>
                        </select>
                        {(s.lines||[]).length>1 && <button className="rm-line" onClick={()=>removeLine(si,li)}>✕</button>}
                      </div>
                    ))}

                    <button className="add-line-btn" onClick={()=>addLine(si)}>+ Ligne</button>
                    {getBudgetTotal(s)>0 && <div className="budget-tot">Total : €{getBudgetTotal(s).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:2})}</div>}
                  </div>
                </div>
              ))}

              <button className="add-single-btn" onClick={addSingle}>+ Ajouter un single</button>
            </div>
          )}
        </div>

        <div className="mf">
          {step>1 && <button className="btn-back" onClick={()=>setStep(step-1)}>← Retour</button>}
          <div style={{flex:1}}/>
          {step<3 && <button className="btn-next" style={{background:color}} onClick={()=>setStep(step+1)} disabled={step===1&&!name}>Suivant →</button>}
          {step===3 && <button className="btn-save" style={{background:color}} onClick={handleSave} disabled={singles.some(s=>!s.title)||saving}>{saving?'Enregistrement…':'Créer le projet'}</button>}
        </div>
      </div>

      <style jsx>{`
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .modal{background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:600px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
        .mh{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 22px;border-bottom:1px solid #1e1e1e;flex-shrink:0}
        .mh-title{font-size:15px;font-weight:700;color:#eee;margin-bottom:6px}
        .mh-steps{display:flex;align-items:center;gap:4px;font-size:11px;flex-wrap:wrap}
        .ms{color:#333}.ms.active{color:#888;font-weight:600}.ms.done{color:#555}.ms-sep{margin-right:4px;color:#222}
        .xbtn{background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0}
        .xbtn:hover{color:#eee}
        .mb{padding:20px 22px;overflow-y:auto;flex:1}
        .field{margin-bottom:16px}
        .field label{display:block;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:7px}
        .field input,.field textarea,.field select{width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#eee;font-size:13px;padding:9px 12px;outline:none;font-family:inherit;transition:border-color .2s}
        .field input:focus,.field textarea:focus,.field select:focus{border-color:#444}
        .field select.empty{color:#555}
        .field textarea{resize:vertical}
        .field-hint{font-size:10px;color:#444;margin-top:5px}
        .field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .pills{display:flex;gap:6px;flex-wrap:wrap}
        .apill{padding:6px 14px;border-radius:20px;border:1px solid #2a2a2a;background:transparent;color:#555;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px;transition:all .2s}
        .apdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
        .tpill{padding:6px 14px;border-radius:6px;border:1px solid #2a2a2a;background:transparent;color:#555;font-size:12px;cursor:pointer;font-family:inherit;transition:all .2s}
        .tpill.active{background:#1e1e1e;color:#eee;border-color:#444}
        .upload-zone{border:1.5px dashed #2a2a2a;border-radius:6px;padding:12px 16px;text-align:center;cursor:pointer;font-size:12px;color:#555;transition:all .2s}
        .upload-zone:hover{border-color:#444;color:#aaa}
        .hint-box{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:6px;padding:10px 12px;font-size:11px;color:#555;margin-bottom:14px;line-height:1.5}
        .preview{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px 16px;margin-top:14px}
        .preview-title{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
        .preview-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0}
        .error-msg{background:#1a0808;border:1px solid #f87171;border-radius:5px;padding:8px 12px;font-size:11px;color:#f87171;margin-bottom:10px}
        .single-block{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:9px;padding:16px;margin-bottom:12px}
        .sb-header{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px}
        .sb-num{width:24px;height:24px;border-radius:50%;background:#1e1e1e;color:#555;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:22px}
        .rm-btn{background:none;border:none;color:#444;font-size:14px;cursor:pointer;padding:0;margin-top:22px;flex-shrink:0}
        .rm-btn:hover{color:#f87171}
        .budget-section{border-top:1px solid #1a1a1a;padding-top:12px}
        .bs-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
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
        .rm-line{background:none;border:none;color:#333;font-size:12px;cursor:pointer;padding:0;flex-shrink:0}
        .rm-line:hover{color:#f87171}
        .add-line-btn{background:none;border:1px dashed #1e1e1e;border-radius:5px;color:#444;font-size:11px;padding:6px 12px;cursor:pointer;font-family:inherit;width:100%;margin-top:4px;transition:all .2s}
        .add-line-btn:hover{border-color:#333;color:#666}
        .budget-tot{font-size:12px;font-weight:700;color:#eee;text-align:right;margin-top:10px;padding-top:8px;border-top:1px solid #1e1e1e}
        .add-single-btn{width:100%;padding:12px;background:none;border:1.5px dashed #1e1e1e;border-radius:8px;color:#444;font-size:12px;cursor:pointer;font-family:inherit;transition:all .2s}
        .add-single-btn:hover{border-color:#333;color:#666}
        .mf{display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #1e1e1e;flex-shrink:0}
        .btn-back{background:none;border:1px solid #2a2a2a;border-radius:7px;color:#555;font-size:13px;font-weight:600;padding:9px 16px;cursor:pointer;font-family:inherit;transition:all .2s}
        .btn-back:hover{color:#eee;border-color:#444}
        .btn-next,.btn-save{color:#000;border:none;border-radius:7px;font-size:13px;font-weight:700;padding:9px 20px;cursor:pointer;font-family:inherit;transition:opacity .2s}
        .btn-next:hover,.btn-save:hover{opacity:.85}
        .btn-next:disabled,.btn-save:disabled{opacity:.4;cursor:default}
      `}</style>
    </div>
  )
}
