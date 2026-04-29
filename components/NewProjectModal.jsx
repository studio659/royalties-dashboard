import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS } from '../lib/artists'

const SKIP = new Set(['sous total','total','qte','prix u/ht','unit.','total ht',
  'production','enregistrement','mixage','mastering','seminaire','achat prods',
  'image','cover','photos promo','stylisme','release','video','relation presse',
  'da','promotion','merchandising','transport','divers','frais divers',
  'materiel','juridique','assurance','frais bancaires','achat','attention'])

function skipRow(label) {
  const l = label.toLowerCase().trim()
  for (const s of SKIP) { if (l.includes(s)) return true }
  if (l === l.toUpperCase() && l.length < 30 && l.length > 1) return true
  return false
}

export default function NewProjectModal({ onClose, onSuccess, defaultArtist }) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  // Titles
  const [artist, setArtist] = useState(defaultArtist || 'Magie!')
  const [type, setType] = useState('serie')
  const [projectName, setProjectName] = useState('')
  const [selectedTitles, setSelectedTitles] = useState([])
  const [availableTitles, setAvailableTitles] = useState([])

  // Budget per title: { [title]: { lines:[{label,amount}], releaseDate } }
  const [budgets, setBudgets] = useState({})
  const [importMsg, setImportMsg] = useState({}) // { [title]: { ok, text } }

  // Contract
  const [existingSeries, setExistingSeries] = useState([])
  const [artistRate, setArtistRate] = useState(12)
  const [coprodName, setCoprodName] = useState('')
  const [coprodRate, setCoprodRate] = useState(0)
  const [labelRate, setLabelRate] = useState(88)
  const [mgmtRate, setMgmtRate] = useState(5)
  const [notes, setNotes] = useState('')

  useEffect(() => { loadTitles(); loadSeries() }, [artist])

  async function loadTitles() {
    let all = [], from = 0
    while (true) {
      const { data } = await supabase.from('royalties').select('title').eq('artist', artist).range(from, from+999)
      if (!data?.length) break
      all = all.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    setAvailableTitles([...new Set(all.map(r => r.title))].sort())
    setSelectedTitles([])
    setBudgets({})
  }

  async function loadSeries() {
    const { data } = await supabase.from('series').select('id,name,artist_rate,coprod_name,coprod_rate,label_rate,mgmt_rate').eq('artist', artist)
    setExistingSeries(data || [])
  }

  function toggleTitle(t) {
    const next = selectedTitles.includes(t) ? selectedTitles.filter(x => x !== t) : [...selectedTitles, t]
    setSelectedTitles(next)
    if (!projectName || projectName === autoName(selectedTitles)) setProjectName(autoName(next))
    if (!budgets[t]) setBudgets(p => ({ ...p, [t]: { lines: [], releaseDate: '' } }))
  }

  function autoName(ts) {
    if (!ts.length) return ''
    if (ts.length === 1) return ts[0]
    return `Série ${artist} ${new Date().getFullYear()}`
  }

  function applySerie(id) {
    if (!id) return
    const s = existingSeries.find(x => x.id === parseInt(id))
    if (!s) return
    setArtistRate(s.artist_rate); setCoprodName(s.coprod_name||'')
    setCoprodRate(s.coprod_rate); setLabelRate(s.label_rate); setMgmtRate(s.mgmt_rate)
  }

  // Budget helpers
  function getB(title) { return budgets[title] || { lines: [], releaseDate: '' } }
  function setL(title, lines) { setBudgets(p => ({ ...p, [title]: { ...getB(title), lines } })) }
  function setRD(title, d) { setBudgets(p => ({ ...p, [title]: { ...getB(title), releaseDate: d } })) }
  function addLine(title) { setL(title, [...getB(title).lines, { label: '', amount: '' }]) }
  function rmLine(title, i) { setL(title, getB(title).lines.filter((_, j) => j !== i)) }
  function updLine(title, i, f, v) {
    const ls = [...getB(title).lines]; ls[i] = { ...ls[i], [f]: v }; setL(title, ls)
  }
  function total(title) { return getB(title).lines.reduce((s, l) => s + (parseFloat(l.amount)||0), 0) }

  // KEY FUNCTION: Import Excel/CSV for a given title
  async function handleImport(file, title) {
    if (!file) return
    setImportMsg(p => ({ ...p, [title]: { ok: null, text: 'Lecture en cours…' } }))
    try {
      const XLSX = (await import('xlsx')).default || await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buf))
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      const allText = rows.flat().map(c => String(c)).join(' ').toLowerCase()
      const isAvlanche = allText.includes('total ht') || allText.includes('prix u/ht')

      const lines = []
      for (const row of rows) {
        const label = String(row[0]||'').trim()
        if (!label || label.length < 2) continue
        if (skipRow(label)) continue

        let amount = 0
        if (isAvlanche) {
          // Col G (index 6) = Total HT, fallback col E (index 4) = unit price
          const g = parseFloat(String(row[6]||'').replace(',','.'))
          const e = parseFloat(String(row[4]||'').replace(',','.'))
          amount = (g > 0) ? g : (e > 0) ? e : 0
        } else {
          // Simple: first number in cols B onwards
          for (let i = 1; i < row.length; i++) {
            const n = parseFloat(String(row[i]||'').replace(',','.').replace(/[^0-9.-]/g,''))
            if (n > 0) { amount = n; break }
          }
        }
        if (amount <= 0) continue
        lines.push({ label, amount: String(amount) })
      }

      if (!lines.length) {
        setImportMsg(p => ({ ...p, [title]: { ok: false, text: 'Aucune ligne valide trouvée dans ce fichier.' } }))
        return
      }

      setL(title, lines)
      setImportMsg(p => ({ ...p, [title]: { ok: true, text: `✓ ${lines.length} ligne${lines.length>1?'s':''} importée${lines.length>1?'s':''} · Total €${lines.reduce((s,l)=>s+(parseFloat(l.amount)||0),0).toLocaleString('fr-FR')}` } }))
    } catch (e) {
      setImportMsg(p => ({ ...p, [title]: { ok: false, text: 'Erreur de lecture : ' + e.message } }))
    }
  }

  async function handleSave() {
    if (!projectName || !selectedTitles.length) return
    setSaving(true)
    try {
      const { data: serie, error: sErr } = await supabase.from('series').insert({
        artist, name: projectName, notes,
        artist_rate: parseFloat(artistRate), coprod_name: coprodName||null,
        coprod_rate: parseFloat(coprodRate), label_rate: parseFloat(labelRate), mgmt_rate: parseFloat(mgmtRate),
      }).select().single()
      if (sErr) throw sErr

      // For EP/série/album: share budget across all titles
      const isGlobal = type !== 'single'
      const globalTitle = isGlobal ? selectedTitles[0] : null

      for (const title of selectedTitles) {
        const b = isGlobal ? getB(globalTitle) : getB(title)
        const bTotal = isGlobal ? total(globalTitle) / selectedTitles.length : total(title)

        const { data: single, error: siErr } = await supabase.from('singles').insert({
          series_id: serie.id, artist, title,
          release_date: b.releaseDate || null,
          budget_eur: bTotal, status: 'active',
        }).select().single()
        if (siErr) throw siErr

        // Only insert lines for first title in global mode (or all in single mode)
        const isFirst = selectedTitles.indexOf(title) === 0
        const linesToInsert = (!isGlobal || isFirst) ? b.lines.filter(l => l.label && parseFloat(l.amount) > 0) : []
        if (linesToInsert.length > 0) {
          await supabase.from('budget_lines').insert(
            linesToInsert.map(l => ({ single_id: single.id, label: l.label, amount_eur: parseFloat(l.amount)||0, status: 'pending' }))
          )
        }
      }

      setSaving(false); onSuccess(); onClose()
    } catch (err) {
      setSaving(false); alert('Erreur : ' + err.message)
    }
  }

  const color = COLORS[artist] || '#f59e0b'
  const isSingle = type === 'single'
  const budgetTitles = isSingle ? selectedTitles : selectedTitles.slice(0, 1) // 1 budget for EP/série

  return (
    <div className="ov" onClick={!saving ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        {/* HEADER */}
        <div className="mh">
          <div>
            <div className="mh-t">Nouveau projet</div>
            <div className="mh-s">
              {['Titres','Budget','Contrat'].map((s,i) => (
                <span key={i} className={step===i+1?'ms act':step>i+1?'ms done':'ms'}>
                  {i>0&&<span className="sep">›</span>}{i+1} {s}
                </span>
              ))}
            </div>
          </div>
          {!saving && <button className="xb" onClick={onClose}>✕</button>}
        </div>

        <div className="mb">

          {/* ── STEP 1 : Titres ── */}
          {step === 1 && (
            <div>
              <div className="field">
                <label>Artiste</label>
                <div className="pills">
                  {[...ARTISTS,'Sherfflazone'].map(a => (
                    <button key={a} className={`ap ${artist===a?'aact':''}`}
                      style={artist===a?{background:COLORS[a]+'22',borderColor:COLORS[a],color:COLORS[a]}:{}}
                      onClick={()=>setArtist(a)}>
                      <span className="dot" style={{background:COLORS[a]||'#888'}}/>{a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Titres du projet</label>
                {availableTitles.length === 0
                  ? <div className="no-t">Aucun titre — importe d'abord un CSV dans Suivi & Stats</div>
                  : <div className="tlist">
                      {availableTitles.map(t => (
                        <div key={t} className={`ti ${selectedTitles.includes(t)?'tsel':''}`}
                          style={selectedTitles.includes(t)?{borderColor:color,background:color+'11'}:{}}
                          onClick={()=>toggleTitle(t)}>
                          <span className="chk">{selectedTitles.includes(t)?'✓':''}</span>
                          <span>{t}</span>
                        </div>
                      ))}
                    </div>
                }
                {selectedTitles.length > 0 && <div style={{fontSize:11,color,marginTop:6}}>{selectedTitles.length} titre{selectedTitles.length>1?'s':''} sélectionné{selectedTitles.length>1?'s':''}</div>}
              </div>

              <div className="field">
                <label>Nom du projet</label>
                <input value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="Auto-généré — modifiable"/>
                <div className="hint">Généré automatiquement à partir des titres</div>
              </div>

              <div className="field">
                <label>Type</label>
                <div className="pills">
                  {[{v:'single',l:'Single'},{v:'serie',l:'Série de singles'},{v:'ep',l:'EP'},{v:'album',l:'Album'}].map(t=>(
                    <button key={t.v} className={`tp ${type===t.v?'tact':''}`} onClick={()=>setType(t.v)}>{t.l}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2 : Budget ── */}
          {step === 2 && (
            <div>
              {!isSingle && selectedTitles.length > 1 && (
                <div className="hbox">Un seul budget pour les {selectedTitles.length} titres du projet.</div>
              )}
              {budgetTitles.map(title => {
                const b = getB(title)
                const msg = importMsg[title]
                return (
                  <div key={title} className="bblock">
                    <div className="bb-top">
                      <div className="bb-title">{isSingle ? title : 'Budget du projet'}</div>
                      <input type="date" value={b.releaseDate} onChange={e=>setRD(title,e.target.value)} className="rd-input" placeholder="Date de sortie"/>
                    </div>

                    {/* IMPORT ZONE */}
                    <label className="import-zone">
                      <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
                        onChange={e=>{ if(e.target.files[0]) handleImport(e.target.files[0], title) }}/>
                      <span className="iz-icon">📂</span>
                      <span className="iz-text">Glisse ou clique — Excel (.xlsx) ou CSV</span>
                    </label>

                    {msg && (
                      <div className={`msg ${msg.ok===true?'ok':msg.ok===false?'err':'info'}`}>{msg.text}</div>
                    )}

                    {/* LINES */}
                    {b.lines.length > 0 && (
                      <div className="lines-wrap">
                        {b.lines.map((line, i) => (
                          <div key={i} className="lr">
                            <input value={line.label} onChange={e=>updLine(title,i,'label',e.target.value)} placeholder="Poste" className="ll"/>
                            <div className="la-wrap"><span className="cur">€</span>
                              <input type="number" value={line.amount} onChange={e=>updLine(title,i,'amount',e.target.value)} placeholder="0" min="0" className="la"/>
                            </div>
                            <button className="rm" onClick={()=>rmLine(title,i)}>✕</button>
                          </div>
                        ))}
                        <div className="ltot">Total : €{total(title).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:2})}</div>
                      </div>
                    )}

                    <button className="add-l" onClick={()=>addLine(title)}>+ Ligne manuelle</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── STEP 3 : Contrat ── */}
          {step === 3 && (
            <div>
              {existingSeries.length > 0 && (
                <div className="field">
                  <label>Copier un contrat existant (optionnel)</label>
                  <select onChange={e=>applySerie(e.target.value)} defaultValue="">
                    <option value="">— Configurer manuellement —</option>
                    {existingSeries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div className="hbox">Les taux s'appliquent à tous les titres. Contrat optionnel — tu peux passer directement.</div>
              <div className="row2">
                <div className="field">
                  <label>Part artiste (%)</label>
                  <input type="number" value={artistRate} onChange={e=>setArtistRate(e.target.value)} min="0" max="100" step="0.5"/>
                  <div className="hint">Sur les royalties totales · dès le 1er $</div>
                </div>
                <div className="field">
                  <label>Gestion Avlanche (%)</label>
                  <input type="number" value={mgmtRate} onChange={e=>setMgmtRate(e.target.value)} min="0" max="100" step="0.5"/>
                </div>
              </div>
              <div className="field">
                <label>Co-producteur (optionnel)</label>
                <input value={coprodName} onChange={e=>setCoprodName(e.target.value)} placeholder="ex: Solanin"/>
              </div>
              {coprodName && (
                <div className="row2">
                  <div className="field">
                    <label>Part co-prod (%)</label>
                    <input type="number" value={coprodRate} onChange={e=>{ const v=parseFloat(e.target.value)||0; setCoprodRate(v); setLabelRate(100-v)}} min="0" max="100" step="5"/>
                  </div>
                  <div className="field">
                    <label>Part Avlanche label (%)</label>
                    <input type="number" value={labelRate} onChange={e=>setLabelRate(e.target.value)} min="0" max="100" step="5"/>
                  </div>
                </div>
              )}
              <div className="prev">
                <div className="prev-t">Répartition après recoupe</div>
                <div className="prev-r"><span style={{color:COLORS[artist]||'#aaa'}}>{artist}</span><span>{artistRate}%</span></div>
                <div className="prev-r"><span style={{color:'#6366f1'}}>Avlanche gestion</span><span>{mgmtRate}%</span></div>
                {coprodName
                  ? <>
                      <div className="prev-r"><span style={{color:'#f97316'}}>Avlanche label</span><span>{((100-artistRate-mgmtRate)*labelRate/100).toFixed(1)}%</span></div>
                      <div className="prev-r"><span style={{color:'#eab308'}}>{coprodName}</span><span>{((100-artistRate-mgmtRate)*coprodRate/100).toFixed(1)}%</span></div>
                    </>
                  : <div className="prev-r"><span style={{color:'#f97316'}}>Avlanche label</span><span>{(100-parseFloat(artistRate||0)-parseFloat(mgmtRate||0)).toFixed(1)}%</span></div>
                }
              </div>
              <div className="field" style={{marginTop:14}}>
                <label>Notes</label>
                <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Clauses particulières..." rows={2}/>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="mf">
          {step>1 && <button className="bb" onClick={()=>setStep(step-1)}>← Retour</button>}
          <div style={{flex:1}}/>
          {step<3 && <button className="bn" style={{background:color}} onClick={()=>setStep(step+1)} disabled={step===1&&(!projectName||!selectedTitles.length)}>Suivant →</button>}
          {step===3 && <button className="bs" style={{background:color}} onClick={handleSave} disabled={saving}>{saving?'Enregistrement…':'Créer le projet'}</button>}
        </div>
      </div>

      <style jsx>{`
        .ov{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .modal{background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:580px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
        .mh{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 22px;border-bottom:1px solid #1e1e1e;flex-shrink:0}
        .mh-t{font-size:15px;font-weight:700;color:#eee;margin-bottom:6px}
        .mh-s{display:flex;align-items:center;gap:4px;font-size:11px;flex-wrap:wrap}
        .ms{color:#333}.ms.act{color:#888;font-weight:600}.ms.done{color:#555}.sep{margin:0 4px;color:#222}
        .xb{background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0}.xb:hover{color:#eee}
        .mb{padding:20px 22px;overflow-y:auto;flex:1}
        .field{margin-bottom:16px}
        .field label{display:block;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:7px}
        .field input,.field textarea,.field select{width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#eee;font-size:13px;padding:9px 12px;outline:none;font-family:inherit;transition:border-color .2s}
        .field input:focus,.field textarea:focus,.field select:focus{border-color:#444}
        .field textarea{resize:vertical}
        .hint{font-size:10px;color:#444;margin-top:5px}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .pills{display:flex;gap:6px;flex-wrap:wrap}
        .ap{padding:6px 14px;border-radius:20px;border:1px solid #2a2a2a;background:transparent;color:#555;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px;transition:all .2s}
        .dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
        .tp{padding:6px 14px;border-radius:6px;border:1px solid #2a2a2a;background:transparent;color:#555;font-size:12px;cursor:pointer;font-family:inherit;transition:all .2s}
        .tp.tact{background:#1e1e1e;color:#eee;border-color:#444}
        .tlist{display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto;margin-bottom:8px}
        .ti{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#1a1a1a;border:1px solid #222;border-radius:7px;cursor:pointer;transition:all .2s;font-size:13px;color:#ddd}
        .ti:hover{border-color:#333}
        .ti.tsel{font-weight:600}
        .chk{width:16px;height:16px;border-radius:4px;background:#1e1e1e;border:1px solid #333;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;color:#6ee7b7}
        .ti.tsel .chk{background:#6ee7b744;border-color:#6ee7b7}
        .no-t{background:#1a0a0a;border:1px solid #f87171;border-radius:6px;padding:12px;font-size:12px;color:#f87171}
        .hbox{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:6px;padding:10px 12px;font-size:11px;color:#555;margin-bottom:14px;line-height:1.5}
        .bblock{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:9px;padding:16px;margin-bottom:12px}
        .bb-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
        .bb-title{font-size:14px;font-weight:700;color:#eee;flex:1}
        .rd-input{width:130px!important;font-size:12px!important;padding:6px 10px!important;flex-shrink:0}
        .import-zone{display:flex;align-items:center;gap:10px;border:1.5px dashed #2a2a2a;border-radius:8px;padding:14px 16px;cursor:pointer;margin-bottom:10px;transition:all .2s}
        .import-zone:hover{border-color:#444;background:#111}
        .iz-icon{font-size:20px;flex-shrink:0}
        .iz-text{font-size:12px;color:#555}
        .msg{padding:8px 12px;border-radius:5px;font-size:12px;margin-bottom:10px}
        .msg.ok{background:#0a1a0a;color:#6ee7b7;border:1px solid #6ee7b744}
        .msg.err{background:#1a0808;color:#f87171;border:1px solid #f8717144}
        .msg.info{background:#141400;color:#f59e0b;border:1px solid #f59e0b44}
        .lines-wrap{margin-bottom:8px}
        .lr{display:flex;gap:7px;margin-bottom:6px;align-items:center}
        .ll{flex:1;background:#141414;border:1px solid #222;border-radius:5px;color:#eee;font-size:12px;padding:7px 10px;outline:none;font-family:inherit}
        .ll:focus{border-color:#333}
        .la-wrap{display:flex;align-items:center;background:#141414;border:1px solid #222;border-radius:5px;padding:0 10px;width:90px;flex-shrink:0}
        .cur{color:#555;font-size:12px;margin-right:4px}
        .la{background:none;border:none;color:#eee;font-size:12px;width:50px;outline:none;font-family:inherit;padding:7px 0}
        .rm{background:none;border:none;color:#333;font-size:12px;cursor:pointer;padding:0;flex-shrink:0}.rm:hover{color:#f87171}
        .ltot{font-size:12px;font-weight:700;color:#eee;text-align:right;padding-top:8px;border-top:1px solid #1e1e1e;margin-bottom:8px}
        .add-l{background:none;border:1px dashed #1e1e1e;border-radius:5px;color:#444;font-size:11px;padding:6px 12px;cursor:pointer;font-family:inherit;width:100%;transition:all .2s}
        .add-l:hover{border-color:#333;color:#666}
        .prev{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px 16px;margin-top:4px}
        .prev-t{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
        .prev-r{display:flex;justify-content:space-between;font-size:13px;padding:4px 0}
        .mf{display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #1e1e1e;flex-shrink:0}
        .bb{background:none;border:1px solid #2a2a2a;border-radius:7px;color:#555;font-size:13px;font-weight:600;padding:9px 16px;cursor:pointer;font-family:inherit;transition:all .2s}
        .bb:hover{color:#eee;border-color:#444}
        .bn,.bs{color:#000;border:none;border-radius:7px;font-size:13px;font-weight:700;padding:9px 20px;cursor:pointer;font-family:inherit;transition:opacity .2s}
        .bn:hover,.bs:hover{opacity:.85}
        .bn:disabled,.bs:disabled{opacity:.4;cursor:default}
      `}</style>
    </div>
  )
}
