import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { parseDistroKid, parseWarner, parseTuneCore } from '../lib/csvParser'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export default function ImportModal({ artist, source = 'distrokid', onClose, onSuccess }) {
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState(null)
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const inputRef = useRef()

  const isWarner = source === 'warner'
  const isTuneCore = source === 'tunecore'
  const label = isWarner ? 'Warner' : isTuneCore ? 'TuneCore' : 'DistroKid'

  async function handleFile(file) {
    if (!file) return
    setStatus('parsing')
    setMessage('Lecture du fichier…')

    try {
      const text = await file.text()
      const { rows, months } = isWarner ? parseWarner(text) : isTuneCore ? parseTuneCore(text) : parseDistroKid(text)

      if (!rows.length) {
        setStatus('error')
        setMessage('Aucune ligne valide trouvée.')
        return
      }

      const filtered = artist ? rows.filter(r => r.artist === artist) : rows

      if (!filtered.length) {
        setStatus('error')
        setMessage(`Aucune ligne pour "${artist}" dans ce fichier.`)
        return
      }

      const filteredMonths = [...new Set(filtered.map(r => r.month))]
      setStatus('importing')
      setMessage(`${filtered.length} lignes · ${filteredMonths.length} mois`)

      // Delete existing
      const MONTH_BATCH = 5
      for (let i = 0; i < filteredMonths.length; i += MONTH_BATCH) {
        const mb = filteredMonths.slice(i, i + MONTH_BATCH)
        let q = supabase.from('royalties').delete().in('month', mb)
        if (artist) q = q.eq('artist', artist)
        const { error } = await q
        if (error) throw error
        await sleep(100)
      }

      // Insert
      const BATCH = 100
      for (let i = 0; i < filtered.length; i += BATCH) {
        const batch = filtered.slice(i, i + BATCH)
        const { error } = await supabase.from('royalties').insert(batch)
        if (error) throw new Error(error.message)
        const pct = Math.round(((i + batch.length) / filtered.length) * 100)
        setProgress(pct)
        setMessage(`Upload… ${pct}% (${i + batch.length}/${filtered.length})`)
        await sleep(150)
      }

      // Log the import
      const sortedMonths = filteredMonths.slice().sort()
      await supabase.from('import_logs').insert({
        artist: artist,
        source: source || 'DistroKid',
        filename: file?.name || 'unknown',
        rows_imported: filtered.length,
        months_covered: sortedMonths.length > 0 ? `${sortedMonths[0]} → ${sortedMonths[sortedMonths.length-1]}` : '',
      })
      setStatus('done')
      setMessage(`✓ ${filtered.length} lignes · ${filteredMonths.length} mois importés`)
      setTimeout(() => { onSuccess?.(); onClose?.() }, 1800)

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
          <div>
            <div className="modal-title">Import {label}</div>
            {artist && <div className="modal-sub">{artist}</div>}
          </div>
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
            <div className="drop-text"><strong>Glisse le CSV {label} ici</strong><br />ou clique pour choisir</div>
            {isWarner && <div className="drop-hint">Colonnes : Month, Artist, Title, Store, Country, ISRC, Revenue (USD), Streams</div>}
            {isTuneCore && <div className="drop-hint">TuneCore → Revenus & Statistiques → Télécharger rapports de vente mensuels</div>}
            {!isWarner && !isTuneCore && <div className="drop-hint">DistroKid → Reporting → Royalties CSV</div>}
          </div>
        )}

        {status && (
          <div className={`status-block status-${status}`}>
            {busy && <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress || 5}%` }} /></div>}
            <p>{message}</p>
            {status === 'error' && <button onClick={() => setStatus(null)} className="retry-btn">Réessayer</button>}
          </div>
        )}
      </div>

      <style jsx>{`
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px}
        .modal{background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:400px;overflow:hidden}
        .modal-header{display:flex;justify-content:space-between;align-items:flex-start;padding:16px 20px;border-bottom:1px solid #1a1a1a}
        .modal-title{font-size:14px;font-weight:700;color:#eee}
        .modal-sub{font-size:11px;color:#555;margin-top:2px}
        .close-btn{background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0;line-height:1}
        .close-btn:hover{color:#eee}
        .drop-zone{margin:20px;border:1.5px dashed #2a2a2a;border-radius:8px;padding:32px 20px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s}
        .drop-zone:hover,.drop-zone.dragging{border-color:#f97316;background:#1a1008}
        .drop-icon{font-size:28px;margin-bottom:10px}
        .drop-text{font-size:13px;color:#ccc;line-height:1.5;margin-bottom:8px}
        .drop-hint{font-size:10px;color:#444;line-height:1.4}
        .status-block{padding:20px 24px 24px}
        .progress-bar{height:3px;background:#1e1e1e;border-radius:2px;overflow:hidden;margin-bottom:12px}
        .progress-fill{height:100%;background:#f97316;border-radius:2px;transition:width .3s}
        .status-block p{font-size:13px;color:#bbb}
        .status-done p{color:#6ee7b7}
        .status-error p{color:#f87171}
        .retry-btn{margin-top:12px;background:none;border:1px solid #333;color:#888;padding:5px 12px;border-radius:5px;cursor:pointer;font-size:11px;font-family:inherit}
      `}</style>
    </div>
  )
}
