import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ARTISTS, COLORS } from '../lib/artists'
import { fmtEur } from '../lib/recoupe'

const ACCOUNTING_SKIP = new Set(['sous total', 'total', 'total ht', 'prix u/ht', 'qte', 'unit.', 'attention'])
function skipRow(label) { return ACCOUNTING_SKIP.has(label.toLowerCase().trim()) }

export default function NewProjectModal({ onClose, onSuccess, defaultArtist }) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [allArtists, setAllArtists] = useState([...ARTISTS, 'Sherfflazone'])

  // Step 1 - identité du projet
  const [artist, setArtist] = useState(defaultArtist || ARTISTS[0])
  const [type, setType] = useState('single')
  const [projectName, setProjectName] = useState('')
  const [selectedTitles, setSelectedTitles] = useState([])
  const [availableTitles, setAvailableTitles] = useState([])

  // Step 2 - schéma de distribution
  const [scheme, setScheme] = useState('aggregator') // 'aggregator' | 'distributor'
  const [distribName, setDistribName] = useState('')
  const [distribAdvance, setDistribAdvance] = useState('')
  const [distribRate, setDistribRate] = useState('25')

  // Step 3 - budget (avance artiste + fabrication)
  const [artistAdvance, setArtistAdvance] = useState('')
  // Budget par titre : { [title]: { lines:[{label,amount}], releaseDate } }
  const [budgets, setBudgets] = useState({})
  const [importMsg, setImportMsg] = useState({})
  const [importedFile, setImportedFile] = useState({})

  // Step 4 - contrat artiste / coprod
  const [existingSeries, setExistingSeries] = useState([])
  const [artistRate, setArtistRate] = useState(15)
  const [coprodName, setCoprodName] = useState('')
  const [coprodRate, setCoprodRate] = useState(0)
  const [labelRate, setLabelRate] = useState(100)
  const [notes, setNotes] = useState('')

  useEffect(() => { loadTitles(); loadSeries(); loadArtists() }, [artist])

  async function loadArtists() {
    const { data } = await supabase.from('artists').select('name').order('created_at')
    if (data?.length) setAllArtists(data.map(a => a.name))
  }

  async function loadTitles() {
    let all = [], from = 0
    while (true) {
      const { data } = await supabase.from('royalties').select('title').eq('artist', artist).range(from, from + 999)
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
    const { data } = await supabase.from('series').select('id,name,artist_rate,coprod_name,coprod_rate,label_rate').eq('artist', artist)
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
    return `${type === 'ep' ? 'EP' : type === 'album' ? 'Album' : 'Série'} ${artist} ${new Date().getFullYear()}`
  }

  function applySerie(id) {
    if (!id) return
    const s = existingSeries.find(x => x.id === parseInt(id))
    if (!s) return
    setArtistRate(s.artist_rate); setCoprodName(s.coprod_name || '')
    setCoprodRate(s.coprod_rate); setLabelRate(s.label_rate)
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
  function totalBudget(title) { return getB(title).lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0) }

  // Import Excel/CSV pour un titre
  async function handleImport(file, title) {
    if (!file) return
    setImportMsg(p => ({ ...p, [title]: { ok: null, text: 'Lecture en cours…' } }))
    setImportedFile(p => ({ ...p, [title]: file.name }))
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
        const label = String(row[0] || '').trim()
        if (!label || label.length < 2 || skipRow(label)) continue
        let amount = 0
        if (isAvlanche) {
          const g = parseFloat(String(row[6] || '').replace(',', '.'))
          const e = parseFloat(String(row[4] || '').replace(',', '.'))
          amount = (g > 0) ? g : (e > 0) ? e : 0
        } else {
          for (let i = 1; i < row.length; i++) {
            const n = parseFloat(String(row[i] || '').replace(',', '.').replace(/[^0-9.-]/g, ''))
            if (n > 0) { amount = n; break }
          }
        }
        if (amount <= 0) continue
        lines.push({ label, amount: String(amount) })
      }
      if (!lines.length) {
        setImportMsg(p => ({ ...p, [title]: { ok: false, text: 'Aucune ligne valide trouvée.' } }))
        return
      }
      setL(title, lines)
      setImportMsg(p => ({ ...p, [title]: { ok: true, text: `✓ ${lines.length} lignes · Total ${fmtEur(lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0))}` } }))
    } catch (e) {
      setImportMsg(p => ({ ...p, [title]: { ok: false, text: 'Erreur : ' + e.message } }))
    }
  }

  function clearImport(title) {
    setL(title, [])
    setImportMsg(p => ({ ...p, [title]: null }))
    setImportedFile(p => ({ ...p, [title]: null }))
  }

  async function handleSave() {
    if (!projectName || !selectedTitles.length) return
    setSaving(true)
    try {
      const seriePayload = {
        artist,
        name: projectName,
        notes,
        currency: 'EUR',
        artist_advance: parseFloat(artistAdvance) || 0,
        artist_rate: parseFloat(artistRate),
        coprod_name: coprodName || null,
        coprod_rate: parseFloat(coprodRate) || 0,
        label_rate: parseFloat(labelRate) || 100,
      }

      if (scheme === 'distributor') {
        seriePayload.distrib_name = distribName || null
        seriePayload.distrib_advance = parseFloat(distribAdvance) || null
        seriePayload.distrib_rate = parseFloat(distribRate) || null
      }

      const { data: serie, error: sErr } = await supabase.from('series').insert(seriePayload).select().single()
      if (sErr) throw sErr

      // Pour single : un budget par titre
      // Pour EP/série/album : un seul budget global, on utilise le 1er titre comme porteur
      const isGlobal = type !== 'single'
      const globalTitle = isGlobal ? selectedTitles[0] : null

      for (const title of selectedTitles) {
        const b = isGlobal ? getB(globalTitle) : getB(title)
        const bTotal = isGlobal && selectedTitles.indexOf(title) === 0
          ? totalBudget(globalTitle)
          : isGlobal
            ? 0
            : totalBudget(title)

        const { data: single, error: siErr } = await supabase.from('singles').insert({
          series_id: serie.id, artist, title,
          release_date: b.releaseDate || null,
          budget_eur: bTotal,
        }).select().single()
        if (siErr) throw siErr

        const isFirst = selectedTitles.indexOf(title) === 0
        const linesToInsert = (!isGlobal || isFirst) ? b.lines.filter(l => l.label && parseFloat(l.amount) > 0) : []
        if (linesToInsert.length > 0) {
          await supabase.from('budget_lines').insert(
            linesToInsert.map(l => ({ single_id: single.id, label: l.label, amount_eur: parseFloat(l.amount) || 0 }))
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
  const budgetTitles = isSingle ? selectedTitles : selectedTitles.slice(0, 1)

  // Validation des étapes
  const canStep2 = selectedTitles.length > 0 && projectName.trim()
  const canStep3 = scheme === 'aggregator' || (distribName.trim() && parseFloat(distribAdvance) > 0)
  const canStep4 = true // budget peut être vide
  const canSave = canStep2 && canStep3

  return (
    <div className="ov" onClick={!saving ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <div>
            <div className="mh-t">Nouveau projet</div>
            <div className="mh-s">
              {['Titres', 'Distribution', 'Budget', 'Contrat'].map((s, i) => (
                <span key={i} className={step === i + 1 ? 'ms act' : step > i + 1 ? 'ms done' : 'ms'}>
                  {i > 0 && <span className="sep">›</span>}{i + 1} {s}
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
                  {allArtists.map(a => (
                    <button key={a} className={`ap ${artist === a ? 'aact' : ''}`}
                      style={artist === a ? { background: COLORS[a] + '22', borderColor: COLORS[a], color: COLORS[a] } : {}}
                      onClick={() => setArtist(a)}>
                      <span className="dot" style={{ background: COLORS[a] || '#888' }} />{a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Type de projet</label>
                <div className="pills">
                  {[{ v: 'single', l: 'Single' }, { v: 'serie', l: 'Série de singles' }, { v: 'ep', l: 'EP' }, { v: 'album', l: 'Album' }].map(t => (
                    <button key={t.v} className={`tp ${type === t.v ? 'tact' : ''}`} onClick={() => setType(t.v)}>{t.l}</button>
                  ))}
                </div>
                <div className="hint">
                  {isSingle
                    ? 'Single : un budget par titre, recoupe individuelle'
                    : 'EP/série/album : un seul budget global pour tous les titres'}
                </div>
              </div>

              <div className="field">
                <label>Titres du projet</label>
                {availableTitles.length === 0
                  ? <div className="no-t">Aucun titre — importe d'abord un CSV dans Suivi & Stats</div>
                  : <div className="tlist">
                    {availableTitles.map(t => (
                      <div key={t} className={`ti ${selectedTitles.includes(t) ? 'tsel' : ''}`}
                        style={selectedTitles.includes(t) ? { borderColor: color, background: color + '11' } : {}}
                        onClick={() => toggleTitle(t)}>
                        <span className="chk">{selectedTitles.includes(t) ? '✓' : ''}</span>
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                }
                {selectedTitles.length > 0 && <div style={{ fontSize: 11, color, marginTop: 6 }}>{selectedTitles.length} titre{selectedTitles.length > 1 ? 's' : ''} sélectionné{selectedTitles.length > 1 ? 's' : ''}</div>}
              </div>

              <div className="field">
                <label>Nom du projet</label>
                <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Auto-généré — modifiable" />
              </div>
            </div>
          )}

          {/* ── STEP 2 : Distribution ── */}
          {step === 2 && (
            <div>
              <div className="hbox">
                Comment ce projet est-il distribué ? Cela détermine si une avance distributeur doit être recoupée en premier.
              </div>

              <div className="field">
                <label>Schéma de distribution</label>
                <div className="scheme-cards">
                  <div className={`sc ${scheme === 'aggregator' ? 'sc-act' : ''}`} onClick={() => setScheme('aggregator')}>
                    <div className="sc-icon">🎵</div>
                    <div className="sc-title">Agrégateur</div>
                    <div className="sc-sub">DistroKid, TuneCore, etc.</div>
                    <div className="sc-info">Avlanche distribue directement, pas d'avance distrib</div>
                  </div>
                  <div className={`sc ${scheme === 'distributor' ? 'sc-act' : ''}`} onClick={() => setScheme('distributor')}>
                    <div className="sc-icon">🏢</div>
                    <div className="sc-title">Distributeur</div>
                    <div className="sc-sub">Warner, ADA, etc.</div>
                    <div className="sc-info">Le distrib verse une avance à recouper en premier</div>
                  </div>
                </div>
              </div>

              {scheme === 'distributor' && (
                <>
                  <div className="row2">
                    <div className="field">
                      <label>Nom du distributeur</label>
                      <input value={distribName} onChange={e => setDistribName(e.target.value)} placeholder="ex: Warner" />
                    </div>
                    <div className="field">
                      <label>Taux distrib (%)</label>
                      <input type="number" value={distribRate} onChange={e => setDistribRate(e.target.value)} min="0" max="100" step="0.5" />
                      <div className="hint">Info uniquement — les royalties en DB sont déjà nettes</div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Avance versée par le distrib (€)</label>
                    <input type="number" value={distribAdvance} onChange={e => setDistribAdvance(e.target.value)} placeholder="ex: 110000" min="0" />
                    <div className="hint">Total que le distrib a versé pour ce projet (à recouper avant qu'Avlanche ne perçoive)</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STEP 3 : Budget ── */}
          {step === 3 && (
            <div>
              {scheme === 'aggregator' && (
                <div className="field">
                  <label>Avance versée à l'artiste (€)</label>
                  <input type="number" value={artistAdvance} onChange={e => setArtistAdvance(e.target.value)} placeholder="ex: 500" min="0" />
                  <div className="hint">Recoupée via le % théorique de l'artiste avant qu'il touche du cash</div>
                </div>
              )}

              {scheme === 'distributor' && (
                <div className="field">
                  <label>Avance artiste payée via l'avance distrib (€) <span style={{ color: '#666', fontWeight: 400 }}>(info)</span></label>
                  <input type="number" value={artistAdvance} onChange={e => setArtistAdvance(e.target.value)} placeholder="ex: 14000" min="0" />
                  <div className="hint">⚠️ Pour info uniquement. En schéma 2, l'avance artiste est implicitement recoupée via l'avance distrib. L'artiste touchera son % direct dès que le distrib sera recoupé.</div>
                </div>
              )}

              <div className="hbox" style={{ marginTop: 18 }}>
                {scheme === 'aggregator' ? (
                  <>
                    <strong>Budget de fabrication</strong> (clip, master, promo, photographe…)
                    {!isSingle && selectedTitles.length > 1 && <><br />Un seul budget global pour les {selectedTitles.length} titres du projet.</>}
                  </>
                ) : (
                  <>
                    <strong>Apport Avlanche en plus de l'avance distrib</strong>
                    <br />⚠️ <span style={{ color: '#f59e0b' }}>Ne renseignez ici que ce que vous dépensez de votre poche EN PLUS de l'avance {distribName || 'distrib'}.</span>
                    <br />Si toute la fabrication est payée via l'avance distrib (cas standard) → laissez vide ou 0€.
                    <br /><br />Une fois l'avance distrib recoupée, Avlanche entre directement en bénéfice (sans recoupe fab supplémentaire).
                  </>
                )}
              </div>

              {budgetTitles.map(title => {
                const b = getB(title)
                const msg = importMsg[title]
                return (
                  <div key={title} className="bblock">
                    <div className="bb-top">
                      <div className="bb-title">{isSingle ? title : `Budget global · ${selectedTitles.length} titres`}</div>
                      <input type="date" value={b.releaseDate} onChange={e => setRD(title, e.target.value)} className="rd-input" />
                    </div>

                    {importedFile[title] ? (
                      <div className="import-done">
                        <span className="iz-icon">📄</span>
                        <span className="iz-fname">{importedFile[title]}</span>
                        <button className="clear-file" onClick={() => clearImport(title)}>✕</button>
                      </div>
                    ) : (
                      <label className="import-zone">
                        <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                          onChange={e => { if (e.target.files[0]) handleImport(e.target.files[0], title) }} />
                        <span className="iz-icon">📂</span>
                        <span className="iz-text">Importer Excel ou CSV</span>
                      </label>
                    )}
                    {msg && <div className={`msg ${msg.ok === true ? 'ok' : msg.ok === false ? 'err' : 'info'}`}>{msg.text}</div>}

                    {b.lines.length > 0 && (
                      <div className="lines-wrap">
                        {b.lines.map((line, i) => (
                          <div key={i} className="lr">
                            <input value={line.label} onChange={e => updLine(title, i, 'label', e.target.value)} placeholder="Poste" className="ll" />
                            <div className="la-wrap"><span className="cur">€</span>
                              <input type="number" value={line.amount} onChange={e => updLine(title, i, 'amount', e.target.value)} placeholder="0" min="0" className="la" />
                            </div>
                            <button className="rm" onClick={() => rmLine(title, i)}>✕</button>
                          </div>
                        ))}
                        <div className="ltot">Fabrication : {fmtEur(totalBudget(title))}</div>
                      </div>
                    )}
                    <button className="add-l" onClick={() => addLine(title)}>+ Ligne manuelle</button>
                  </div>
                )
              })}

              {(parseFloat(artistAdvance) > 0 || budgetTitles.some(t => totalBudget(t) > 0)) && (
                <div className="budget-summary">
                  <div className="bs-row"><span>Avance artiste</span><span>{fmtEur(parseFloat(artistAdvance) || 0)}</span></div>
                  <div className="bs-row"><span>Fabrication</span><span>{fmtEur(budgetTitles.reduce((s, t) => s + totalBudget(t), 0))}</span></div>
                  <div className="bs-row bs-total"><span>Budget total à recouper</span><span>{fmtEur((parseFloat(artistAdvance) || 0) + budgetTitles.reduce((s, t) => s + totalBudget(t), 0))}</span></div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4 : Contrat ── */}
          {step === 4 && (
            <div>
              {existingSeries.length > 0 && (
                <div className="field">
                  <label>Copier un contrat existant (optionnel)</label>
                  <select onChange={e => applySerie(e.target.value)} defaultValue="">
                    <option value="">— Configurer manuellement —</option>
                    {existingSeries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <div className="field">
                <label>Part artiste (%)</label>
                <input type="number" value={artistRate} onChange={e => setArtistRate(e.target.value)} min="0" max="100" step="0.5" />
                <div className="hint">Sur les royalties totales · l'artiste touche en cash après recoupe de son avance</div>
              </div>

              <div className="field">
                <label>Co-producteur (optionnel)</label>
                <input value={coprodName} onChange={e => setCoprodName(e.target.value)} placeholder="ex: Solanin" />
              </div>

              {coprodName && (
                <div className="row2">
                  <div className="field">
                    <label>Part co-prod (%)</label>
                    <input type="number" value={coprodRate} onChange={e => { const v = parseFloat(e.target.value) || 0; setCoprodRate(v); setLabelRate(100 - v) }} min="0" max="100" step="5" />
                    <div className="hint">Du restant après artiste</div>
                  </div>
                  <div className="field">
                    <label>Part Avlanche label (%)</label>
                    <input type="number" value={labelRate} onChange={e => setLabelRate(e.target.value)} min="0" max="100" step="5" />
                  </div>
                </div>
              )}

              <div className="prev">
                <div className="prev-t">Répartition après recoupe complète</div>
                <div className="prev-r"><span style={{ color: COLORS[artist] || '#aaa' }}>{artist}</span><span>{artistRate}% des royalties</span></div>
                {coprodName ? (
                  <>
                    <div className="prev-r"><span style={{ color: '#f97316' }}>Avlanche label</span><span>{labelRate}% du restant ({((100 - artistRate) * labelRate / 100).toFixed(1)}% du total)</span></div>
                    <div className="prev-r"><span style={{ color: '#eab308' }}>{coprodName}</span><span>{coprodRate}% du restant ({((100 - artistRate) * coprodRate / 100).toFixed(1)}% du total)</span></div>
                  </>
                ) : (
                  <div className="prev-r"><span style={{ color: '#f97316' }}>Avlanche label</span><span>{100 - parseFloat(artistRate || 0)}% du total</span></div>
                )}
              </div>

              <div className="field" style={{ marginTop: 14 }}>
                <label>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Clauses particulières..." rows={2} />
              </div>
            </div>
          )}
        </div>

        <div className="mf">
          {step > 1 && <button className="bb" onClick={() => setStep(step - 1)} disabled={saving}>← Précédent</button>}
          <div style={{ flex: 1 }} />
          {step < 4 && (
            <button className="bs" style={{ background: color }}
              onClick={() => setStep(step + 1)}
              disabled={(step === 1 && !canStep2) || (step === 2 && !canStep3)}>
              Suivant →
            </button>
          )}
          {step === 4 && (
            <button className="bs" style={{ background: color }} onClick={handleSave} disabled={saving || !canSave}>
              {saving ? 'Création…' : 'Créer le projet'}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .ov{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .modal{background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:600px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
        .mh{display:flex;justify-content:space-between;align-items:flex-start;padding:16px 20px;border-bottom:1px solid #1e1e1e;flex-shrink:0}
        .mh-t{font-size:14px;font-weight:700;color:#eee;margin-bottom:8px}
        .mh-s{display:flex;gap:4px;font-size:11px;color:#444;flex-wrap:wrap}
        .ms{padding:3px 0}
        .ms.act{color:#eee;font-weight:700}
        .ms.done{color:#666}
        .sep{margin:0 6px;color:#333}
        .xb{background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0}
        .xb:hover{color:#eee}
        .mb{padding:18px 20px;overflow-y:auto;flex:1}
        .field{margin-bottom:14px}
        .field label{display:block;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
        .field input,.field textarea,.field select{width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#eee;font-size:13px;padding:8px 12px;outline:none;font-family:inherit}
        .field input:focus,.field textarea:focus{border-color:#444}
        .field textarea{resize:vertical}
        .hint{font-size:10px;color:#444;margin-top:4px;line-height:1.5}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .hbox{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:6px;padding:10px 12px;font-size:11px;color:#888;line-height:1.6}
        .pills{display:flex;flex-wrap:wrap;gap:6px}
        .ap,.tp{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:14px;color:#888;font-size:12px;padding:5px 12px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px}
        .ap.aact,.tp.tact{background:#2a2a2a;color:#eee}
        .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
        .no-t{font-size:12px;color:#555;padding:14px;background:#0f0f0f;border-radius:6px;text-align:center}
        .tlist{max-height:200px;overflow-y:auto;border:1px solid #1e1e1e;border-radius:6px;padding:6px}
        .ti{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:13px;color:#bbb;border:1px solid transparent}
        .ti:hover{background:#1a1a1a}
        .ti.tsel{color:#eee}
        .chk{width:14px;color:#6ee7b7;font-size:12px}
        .scheme-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .sc{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px;cursor:pointer;transition:all .2s}
        .sc:hover{border-color:#2a2a2a}
        .sc-act{border-color:#f97316;background:#1a0f00}
        .sc-icon{font-size:24px;margin-bottom:6px}
        .sc-title{font-size:13px;font-weight:700;color:#eee;margin-bottom:2px}
        .sc-sub{font-size:11px;color:#666;margin-bottom:6px}
        .sc-info{font-size:10px;color:#444;line-height:1.4}
        .bblock{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px;margin-bottom:10px}
        .bb-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px}
        .bb-title{font-size:13px;font-weight:700;color:#eee}
        .rd-input{width:140px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:5px;color:#bbb;font-size:11px;padding:4px 8px;font-family:inherit;outline:none}
        .import-zone{display:flex;align-items:center;gap:10px;background:#1a1a1a;border:1.5px dashed #2a2a2a;border-radius:6px;padding:14px;cursor:pointer;font-size:12px;color:#666}
        .import-zone:hover{border-color:#3a3a3a;color:#aaa}
        .import-done{display:flex;align-items:center;gap:10px;background:#0a1a0a;border:1px solid #1a3a1a;border-radius:6px;padding:10px 14px}
        .iz-icon{font-size:18px}
        .iz-fname{flex:1;font-size:12px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .clear-file{background:none;border:none;color:#555;font-size:14px;cursor:pointer}
        .clear-file:hover{color:#f87171}
        .iz-text{font-weight:600}
        .msg{margin-top:8px;padding:6px 10px;border-radius:5px;font-size:11px}
        .msg.ok{background:#0a1a0a;color:#6ee7b7}
        .msg.err{background:#1a0808;color:#f87171}
        .msg.info{background:#0a0a1a;color:#888}
        .lines-wrap{margin-top:10px;background:#141414;border-radius:6px;padding:8px}
        .lr{display:flex;gap:6px;margin-bottom:5px;align-items:center}
        .ll{flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:5px;color:#eee;font-size:12px;padding:5px 8px;outline:none;font-family:inherit}
        .la-wrap{position:relative;width:100px}
        .cur{position:absolute;left:8px;top:50%;transform:translateY(-50%);color:#555;font-size:12px}
        .la{width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:5px;color:#eee;font-size:12px;padding:5px 8px 5px 18px;outline:none;font-family:inherit}
        .rm{background:none;border:none;color:#444;font-size:14px;cursor:pointer;padding:0 4px}
        .rm:hover{color:#f87171}
        .ltot{padding-top:6px;border-top:1px solid #1e1e1e;margin-top:5px;font-size:12px;font-weight:700;color:#f97316;text-align:right}
        .add-l{background:none;border:1px dashed #2a2a2a;border-radius:5px;color:#555;font-size:11px;padding:5px 12px;cursor:pointer;width:100%;margin-top:8px;font-family:inherit}
        .add-l:hover{color:#aaa;border-color:#444}
        .budget-summary{margin-top:16px;background:#0f0f0f;border:1px solid #1e1e1e;border-radius:7px;padding:12px 14px}
        .bs-row{display:flex;justify-content:space-between;font-size:12px;color:#888;padding:4px 0}
        .bs-total{font-size:13px;font-weight:700;color:#f97316;padding-top:8px;margin-top:4px;border-top:1px solid #1e1e1e}
        .prev{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:7px;padding:12px 14px;margin-top:14px}
        .prev-t{font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px}
        .prev-r{display:flex;justify-content:space-between;font-size:12px;padding:3px 0}
        .mf{display:flex;align-items:center;padding:14px 20px;border-top:1px solid #1e1e1e;gap:8px;flex-shrink:0}
        .bb{background:none;border:1px solid #2a2a2a;color:#888;font-size:13px;padding:8px 16px;border-radius:6px;cursor:pointer;font-family:inherit}
        .bb:hover:not(:disabled){border-color:#444;color:#eee}
        .bs{color:#000;border:none;border-radius:7px;font-size:13px;font-weight:700;padding:9px 22px;cursor:pointer;font-family:inherit}
        .bs:disabled{opacity:.4;cursor:default}
      `}</style>
    </div>
  )
}
