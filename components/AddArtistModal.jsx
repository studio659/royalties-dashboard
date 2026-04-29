import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseDistroKid, parseTuneCore } from '../lib/csvParser'
import { useRate } from '../lib/rateContext'

const PRESET_COLORS = [
  '#f97316','#3b82f6','#a78bfa','#eab308',
  '#22c55e','#ef4444','#06b6d4','#ec4899',
  '#f59e0b','#84cc16','#14b8a6','#6366f1',
]

const SOURCES = [
  { id: 'distrokid', label: 'DistroKid', hint: 'Sales Report CSV' },
  { id: 'tunecore',  label: 'TuneCore',  hint: 'Royalty Report CSV' },
  { id: 'warner',    label: 'Warner',    hint: 'Rapport Warner (.txt ou .pdf)' },
]

export default function AddArtistModal({ onClose, onSuccess }) {
  const { rate: eurRate } = useRate()
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#f97316')
  const [sources, setSources] = useState(['distrokid'])
  const [saving, setSaving] = useState(false)
  const [importStatus, setImportStatus] = useState({})
  const [newArtist, setNewArtist] = useState(null)

  function toggleSource(id) {
    setSources(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('artists').insert({
      name: name.trim(), color, sources
    }).select().single()
    setSaving(false)
    if (error) { alert('Erreur : ' + error.message); return }
    setNewArtist(data)
    setStep(2)
  }

  async function handleCSV(file, source) {
    if (!file) return
    setImportStatus(p => ({ ...p, [source]: { status: 'loading', msg: 'Lecture…' } }))
    try {
      const text = await file.text()
      let rows = []

      // Fix: destructure {rows, months} from parser
      if (source === 'distrokid') {
        const result = parseDistroKid(text)
        rows = result.rows
      } else if (source === 'tunecore') {
        const result = parseTuneCore(text)
        rows = result.rows
      }

      // Override artist name + ensure amount/currency set
      const normalized = rows
        .filter(r => r.artist && (r.usd !== undefined || r.amount !== undefined))
        .map(r => ({
          ...r,
          artist: name.trim(),
          amount: r.amount ?? r.usd ?? 0,
          currency: r.currency || 'USD',
        }))

      if (!normalized.length) {
        setImportStatus(p => ({ ...p, [source]: { status: 'error', msg: 'Aucune ligne valide trouvée.' } }))
        return
      }

      const months = [...new Set(normalized.map(r => r.month))]

      // Delete existing rows for these months
      for (let i = 0; i < months.length; i += 5) {
        const mb = months.slice(i, i + 5)
        await supabase.from('royalties').delete().in('month', mb).eq('artist', name.trim())
      }

      // Insert in batches
      for (let i = 0; i < normalized.length; i += 100) {
        const { error } = await supabase.from('royalties').insert(normalized.slice(i, i + 100))
        if (error) throw error
      }

      const sorted = months.sort()
      await supabase.from('import_logs').insert({
        artist: name.trim(), source, filename: file.name,
        rows_imported: normalized.length,
        months_covered: `${sorted[0]} → ${sorted[sorted.length - 1]}`
      })

      setImportStatus(p => ({
        ...p,
        [source]: { status: 'done', msg: `✓ ${normalized.length} lignes · ${months.length} mois importés` }
      }))
    } catch (e) {
      setImportStatus(p => ({ ...p, [source]: { status: 'error', msg: 'Erreur : ' + e.message } }))
    }
  }

  const canFinish = step === 2 && Object.values(importStatus).some(s => s.status === 'done')

  return (
    <div className="ov" onClick={!saving ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        <div className="mh">
          <div>
            <div className="mh-t">Ajouter un artiste</div>
            <div className="mh-s">
              <span className={step >= 1 ? 'ms act' : 'ms'}>1 Infos</span>
              <span className="sep">›</span>
              <span className={step >= 2 ? 'ms act' : 'ms'}>2 Import CSV</span>
            </div>
          </div>
          <button className="xb" onClick={onClose}>✕</button>
        </div>

        <div className="mb">
          {step === 1 && (
            <>
              <div className="field">
                <label>Nom de l'artiste</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="ex: Sherfflazone" autoFocus />
                <div className="hint">Doit correspondre exactement au nom dans tes CSV</div>
              </div>

              <div className="field">
                <label>Couleur</label>
                <div className="color-grid">
                  {PRESET_COLORS.map(c => (
                    <div key={c} className={`color-swatch ${color === c ? 'selected' : ''}`}
                      style={{ background: c, outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
                      onClick={() => setColor(c)} />
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Distribution</label>
                <div className="source-list">
                  {SOURCES.map(s => (
                    <div key={s.id} className={`source-item ${sources.includes(s.id) ? 'sel' : ''}`}
                      onClick={() => toggleSource(s.id)} style={{ cursor: 'pointer' }}>
                      <div className={`src-check ${sources.includes(s.id) ? 'checked' : ''}`}>
                        {sources.includes(s.id) ? '✓' : ''}
                      </div>
                      <div>
                        <div className="src-name">{s.label}</div>
                        <div className="src-hint">{s.hint}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="artist-preview">
                <span className="prev-dot" style={{ background: color }} />
                <span className="prev-name">{name}</span>
              </div>
              <div className="hint-box">
                Importe au moins un CSV pour que l'artiste apparaisse dans Suivi & Stats. Tu peux aussi passer et importer plus tard.
              </div>
              {sources.map(source => {
                const st = importStatus[source]
                const src = SOURCES.find(s => s.id === source)
                return (
                  <div key={source} className="src-block">
                    <div className="sb-top">
                      <div className="sb-label">{src?.label}</div>
                      {st?.status === 'done' && <span className="badge-ok">✓ Importé</span>}
                    </div>
                    {st?.status === 'done' ? (
                      <div className="msg ok">{st.msg}</div>
                    ) : (
                      <label className="upload-zone">
                        <input type="file" accept=".csv,.txt,.pdf" style={{ display: 'none' }}
                          onChange={e => { if (e.target.files[0]) handleCSV(e.target.files[0], source) }} />
                        {st?.status === 'loading' ? (
                          <span style={{ color: '#f59e0b' }}>{st.msg}</span>
                        ) : st?.status === 'error' ? (
                          <span style={{ color: '#f87171' }}>{st.msg} — réessayer</span>
                        ) : (
                          <>
                            <span className="uz-icon">📂</span>
                            <span className="uz-text">Glisse ou clique — {source === 'warner' ? '.txt ou .pdf Warner' : `CSV ${src?.label}`}</span>
                          </>
                        )}
                      </label>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        <div className="mf">
          <div style={{ flex: 1 }} />
          {step === 1 && (
            <button className="btn-next" style={{ background: color }}
              onClick={handleCreate} disabled={!name.trim() || saving}>
              {saving ? 'Création…' : 'Créer l\'artiste →'}
            </button>
          )}
          {step === 2 && (
            <>
              <button className="btn-skip" onClick={() => { onSuccess(); onClose() }}>
                Passer — importer plus tard
              </button>
              <button className="btn-next" style={{ background: color }}
                onClick={() => { onSuccess(); onClose() }} disabled={!canFinish}>
                Terminer
              </button>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .ov{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .modal{background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:480px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
        .mh{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 22px;border-bottom:1px solid #1e1e1e;flex-shrink:0}
        .mh-t{font-size:15px;font-weight:700;color:#eee;margin-bottom:6px}
        .mh-s{display:flex;align-items:center;gap:6px;font-size:11px}
        .ms{color:#333}.ms.act{color:#888;font-weight:600}.sep{color:#222}
        .xb{background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0}.xb:hover{color:#eee}
        .mb{padding:20px 22px;overflow-y:auto;flex:1}
        .field{margin-bottom:18px}
        .field label{display:block;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px}
        .field input{width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#eee;font-size:14px;padding:10px 12px;outline:none;font-family:inherit}
        .field input:focus{border-color:#444}
        .hint{font-size:10px;color:#444;margin-top:5px}
        .color-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
        .color-swatch{width:32px;height:32px;border-radius:8px;cursor:pointer;transition:transform .15s}
        .color-swatch:hover{transform:scale(1.1)}
        .color-swatch.selected{transform:scale(1.15)}
        .source-list{display:flex;flex-direction:column;gap:8px}
        .source-item{display:flex;align-items:center;gap:12px;padding:12px 14px;background:#1a1a1a;border:1px solid #222;border-radius:8px;transition:border-color .2s}
        .source-item.sel{border-color:#444}
        .src-check{width:18px;height:18px;border-radius:4px;background:#1e1e1e;border:1px solid #333;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#6ee7b7;flex-shrink:0}
        .src-check.checked{background:#6ee7b722;border-color:#6ee7b7}
        .src-name{font-size:13px;font-weight:600;color:#eee;margin-bottom:2px}
        .src-hint{font-size:11px;color:#555}
        .artist-preview{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:12px 14px;background:#1a1a1a;border-radius:8px}
        .prev-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
        .prev-name{font-size:15px;font-weight:700;color:#eee}
        .hint-box{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:6px;padding:10px 12px;font-size:11px;color:#555;margin-bottom:16px;line-height:1.5}
        .src-block{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:9px;padding:14px;margin-bottom:10px}
        .sb-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
        .sb-label{font-size:12px;font-weight:700;color:#eee}
        .badge-ok{font-size:10px;padding:2px 8px;background:#0a1a0a;color:#6ee7b7;border-radius:10px}
        .upload-zone{display:flex;align-items:center;gap:10px;border:1.5px dashed #2a2a2a;border-radius:7px;padding:12px 14px;cursor:pointer;transition:all .2s;font-size:12px;color:#555}
        .upload-zone:hover{border-color:#444;color:#aaa}
        .uz-icon{font-size:18px;flex-shrink:0}
        .msg{padding:8px 12px;border-radius:5px;font-size:12px}
        .msg.ok{background:#0a1a0a;color:#6ee7b7;border:1px solid #6ee7b744}
        .mf{display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid #1e1e1e;flex-shrink:0}
        .btn-next{color:#000;border:none;border-radius:7px;font-size:13px;font-weight:700;padding:9px 20px;cursor:pointer;font-family:inherit;transition:opacity .2s}
        .btn-next:hover{opacity:.85}
        .btn-next:disabled{opacity:.4;cursor:default}
        .btn-skip{background:none;border:1px solid #2a2a2a;border-radius:7px;color:#555;font-size:13px;padding:9px 16px;cursor:pointer;font-family:inherit;transition:all .2s}
        .btn-skip:hover{color:#eee;border-color:#444}
      `}</style>
    </div>
  )
}
