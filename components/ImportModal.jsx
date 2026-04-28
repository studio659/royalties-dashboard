import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { parseDistroKid } from '../lib/csvParser'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export default function ImportModal({ onClose, onSuccess }) {
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState(null)
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const inputRef = useRef()

  async function handleFile(file) {
    if (!file) return
    setStatus('parsing')
    setMessage('Lecture du CSV…')

    try {
      const text = await file.text()
      const { rows, months } = parseDistroKid(text)

      if (!rows.length) {
        setStatus('error')
        setMessage('Aucune ligne valide trouvée dans ce fichier.')
        return
      }

      setStatus('importing')
      setMessage(`${rows.length} lignes · ${months.length} mois détectés`)

      // Supprime les mois du CSV par petits groupes
      const MONTH_BATCH = 10
      for (let i = 0; i < months.length; i += MONTH_BATCH) {
        const mb = months.slice(i, i + MONTH_BATCH)
        const { error } = await supabase.from('royalties').delete().in('month', mb)
        if (error) throw error
        await sleep(100)
      }

      // Insert par petits batches de 100 lignes
      const BATCH = 100
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const { error } = await supabase.from('royalties').insert(batch)
        if (error) throw new Error(`Erreur batch ${i}-${i+BATCH}: ${error.message}`)
        const pct = Math.round(((i + batch.length) / rows.length) * 100)
        setProgress(pct)
        setMessage(`Upload… ${pct}% (${i + batch.length}/${rows.length} lignes)`)
        await sleep(150)
      }

      setStatus('done')
      setMessage(`✓ ${rows.length} lignes importées sur ${months.length} mois`)
      setTimeout(() => { onSuccess(); onClose() }, 2000)

    } catch (err) {
      setStatus('error')
      setMessage('Erreur : ' + (err.message || 'inconnue'))
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const busy = status === 'parsing' || status === 'importing'

  return (
    <div className="modal-overlay" onClick={!busy ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Importer un CSV DistroKid</span>
          {!busy && <button className="close-btn" onClick={onClose}>✕</button>}
        </div>

        {!status && (
          <div
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
            <div className="drop-icon">📄</div>
            <div className="drop-text"><strong>Glisse ton CSV ici</strong><br />ou clique pour choisir</div>
            <div className="drop-hint">Export DistroKid → Reporting → Royalties CSV</div>
          </div>
        )}

        {status && (
          <div className={`status-block status-${status}`}>
            {busy && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress || 5}%` }} />
              </div>
            )}
            <p>{message}</p>
            {status === 'error' && (
              <button onClick={() => setStatus(null)} style={{marginTop:12,background:'none',border:'1px solid #444',color:'#aaa',padding:'6px 12px',borderRadius:5,cursor:'pointer',fontSize:12}}>
                Réessayer
              </button>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px }
        .modal { background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:420px;overflow:hidden }
        .modal-header { display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #1e1e1e;font-size:14px;font-weight:700;color:#eee }
        .close-btn { background:none;border:none;color:#555;font-size:16px;cursor:pointer;padding:0;line-height:1 }
        .close-btn:hover { color:#eee }
        .drop-zone { margin:20px;border:1.5px dashed #2a2a2a;border-radius:8px;padding:36px 24px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s }
        .drop-zone:hover,.drop-zone.dragging { border-color:#f97316;background:#1a1008 }
        .drop-icon { font-size:32px;margin-bottom:10px }
        .drop-text { font-size:14px;color:#ccc;line-height:1.5;margin-bottom:8px }
        .drop-hint { font-size:11px;color:#444 }
        .status-block { padding:20px 24px 24px }
        .progress-bar { height:4px;background:#1e1e1e;border-radius:2px;overflow:hidden;margin-bottom:12px }
        .progress-fill { height:100%;background:#f97316;border-radius:2px;transition:width .3s }
        .status-block p { font-size:13px;color:#bbb }
        .status-done p { color:#6ee7b7 }
        .status-error p { color:#f87171 }
      `}</style>
    </div>
  )
}
