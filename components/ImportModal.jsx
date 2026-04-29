import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { parseDistroKid, parseWarner, parseTuneCore, parseWarnerPDF } from '../lib/csvParser'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function extractPDFText(arrayBuffer) {
  // Load PDF.js dynamically
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }

  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items.map(item => item.str).join(' ')
    fullText += pageText + '\n'
  }
  return fullText
}


export default function ImportModal({ artist, source = 'distrokid', onClose, onSuccess }) {
  const [dragging, setDragging] = useState(false)
  const [files, setFiles] = useState([]) // list of File objects
  const [results, setResults] = useState([]) // { file, status, message }
  const [globalStatus, setGlobalStatus] = useState(null) // null | 'running' | 'done' | 'error'
  const [progress, setProgress] = useState(0) // 0-100 across all files
  const [eurRate, setEurRate] = useState(0.92)
  const inputRef = useRef()

  const isWarner = source === 'warner'
  const isTuneCore = source === 'tunecore'
  const label = isWarner ? 'Warner' : isTuneCore ? 'TuneCore' : 'DistroKid'
  const accept = isWarner ? '.txt,.pdf,.csv' : '.csv'

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'eur_rate').single()
      .then(({ data }) => { if (data) setEurRate(parseFloat(data.value)) })
  }, [])

  function pickFiles(newFiles) {
    const arr = Array.from(newFiles)
    setFiles(arr)
    setResults(arr.map(f => ({ name: f.name, status: 'pending', message: '' })))
    setGlobalStatus(null)
    setProgress(0)
  }

  async function handleImport() {
    if (!files.length) return
    setGlobalStatus('running')

    let totalRows = 0
    let totalMonths = new Set()
    let hasError = false

    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi]
      updateResult(fi, 'running', 'Lecture…')

      try {
        const isPDF = file.name.toLowerCase().endsWith('.pdf')
        let parsed

        if (isWarner && isPDF) {
          // Extract text from PDF using PDF.js
          const arrayBuffer = await file.arrayBuffer()
          const pdfText = await extractPDFText(arrayBuffer)
          parsed = parseWarnerPDF(pdfText, eurRate)
        } else if (isWarner) {
          const text = await file.text()
          parsed = parseWarner(text, eurRate)
        } else if (isTuneCore) {
          const text = await file.text()
          parsed = parseTuneCore(text)
        } else {
          const text = await file.text()
          parsed = parseDistroKid(text)
        }

        const { rows, months } = parsed

        if (!rows.length) {
          updateResult(fi, 'error', 'Aucune ligne valide trouvée')
          hasError = true
          continue
        }

        const filtered = artist ? rows.filter(r => r.artist === artist) : rows
        if (!filtered.length) {
          updateResult(fi, 'error', `Aucune ligne pour "${artist}"`)
          hasError = true
          continue
        }

        const filteredMonths = [...new Set(filtered.map(r => r.month))]
        updateResult(fi, 'running', `${filtered.length} lignes · suppression anciens mois…`)

        // Delete existing data for those months+artist
        const MONTH_BATCH = 5
        for (let i = 0; i < filteredMonths.length; i += MONTH_BATCH) {
          const mb = filteredMonths.slice(i, i + MONTH_BATCH)
          let q = supabase.from('royalties').delete().in('month', mb)
          if (artist) q = q.eq('artist', artist)
          const { error } = await q
          if (error) throw error
          await sleep(80)
        }

        // Insert in batches
        const BATCH = 100
        for (let i = 0; i < filtered.length; i += BATCH) {
          const batch = filtered.slice(i, i + BATCH)
          const { error } = await supabase.from('royalties').insert(batch)
          if (error) throw new Error(error.message)
          const filePct = Math.round(((i + batch.length) / filtered.length) * 100)
          const globalPct = Math.round(((fi / files.length) + (filePct / 100 / files.length)) * 100)
          setProgress(globalPct)
          updateResult(fi, 'running', `Upload… ${filePct}%`)
          await sleep(100)
        }

        // Log
        const sortedMonths = filteredMonths.slice().sort()
        await supabase.from('import_logs').insert({
          artist,
          source: source || 'DistroKid',
          filename: file.name,
          rows_imported: filtered.length,
          months_covered: sortedMonths.length > 0 ? `${sortedMonths[0]} → ${sortedMonths[sortedMonths.length - 1]}` : '',
        })

        totalRows += filtered.length
        filteredMonths.forEach(m => totalMonths.add(m))
        updateResult(fi, 'done', `✓ ${filtered.length} lignes · ${filteredMonths.length} mois`)

      } catch (err) {
        updateResult(fi, 'error', 'Erreur : ' + (err.message || 'inconnue'))
        hasError = true
      }

      setProgress(Math.round(((fi + 1) / files.length) * 100))
    }

    setGlobalStatus(hasError ? 'error' : 'done')
    if (!hasError) {
      setTimeout(() => { onSuccess?.(); onClose?.() }, 2000)
    }
  }

  function updateResult(i, status, message) {
    setResults(prev => {
      const next = [...prev]
      next[i] = { ...next[i], status, message }
      return next
    })
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    pickFiles(e.dataTransfer.files)
  }

  const busy = globalStatus === 'running'
  const hasFiles = files.length > 0
  const canImport = hasFiles && globalStatus !== 'running' && globalStatus !== 'done'

  return (
    <div className="ov" onClick={!busy ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>

        <div className="mh">
          <div>
            <div className="mt">Import {label}</div>
            {artist && <div className="ms">{artist}</div>}
          </div>
          {!busy && <button className="xb" onClick={onClose}>✕</button>}
        </div>

        {/* DROP ZONE */}
        {!globalStatus && (
          <div
            className={`drop-zone ${dragging ? 'dz-drag' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" accept={accept} multiple style={{ display: 'none' }}
              onChange={e => pickFiles(e.target.files)} />
            <div className="dz-icon">📂</div>
            <div className="dz-text">
              {isWarner
                ? <><strong>Glisse les fichiers Warner ici</strong><br />.txt (données complètes) ou .pdf (données agrégées par titre)<br />Tu peux en sélectionner plusieurs à la fois</>
                : <><strong>Glisse le CSV {label} ici</strong><br />ou clique pour choisir</>
              }
            </div>
            {isWarner && (
              <div className="dz-hint">
                Format Warner France · TSV · montants en € convertis en $ (taux : 1€ = {(1/eurRate).toFixed(3)}$)
              </div>
            )}
            {isTuneCore && <div className="dz-hint">TuneCore → Revenus & Statistiques → Télécharger rapports de vente mensuels</div>}
            {!isWarner && !isTuneCore && <div className="dz-hint">DistroKid → Reporting → Royalties CSV</div>}
          </div>
        )}

        {/* FILE LIST */}
        {hasFiles && globalStatus !== null && (
          <div className="file-list">
            {results.map((r, i) => (
              <div key={i} className={`file-row fr-${r.status}`}>
                <div className="fr-icon">
                  {r.status === 'done' ? '✓' : r.status === 'error' ? '✕' : r.status === 'running' ? '⟳' : '○'}
                </div>
                <div className="fr-name" title={r.name}>{r.name.length > 36 ? r.name.slice(0, 33) + '…' : r.name}</div>
                <div className="fr-msg">{r.message}</div>
              </div>
            ))}
          </div>
        )}

        {/* PENDING FILE LIST (before import) */}
        {hasFiles && globalStatus === null && (
          <div className="file-list">
            {files.map((f, i) => (
              <div key={i} className="file-row fr-pending">
                <div className="fr-icon">○</div>
                <div className="fr-name">{f.name.length > 36 ? f.name.slice(0, 33) + '…' : f.name}</div>
                <div className="fr-msg">{isWarner ? '.txt Warner' : `.csv ${label}`}</div>
              </div>
            ))}
          </div>
        )}

        {/* PROGRESS */}
        {globalStatus === 'running' && (
          <div className="prog-wrap">
            <div className="prog-bar"><div className="prog-fill" style={{ width: `${progress}%` }} /></div>
            <div className="prog-label">{progress}% · {results.filter(r => r.status === 'done').length}/{files.length} fichiers</div>
          </div>
        )}

        {/* SUMMARY */}
        {globalStatus === 'done' && (
          <div className="summary ok">
            ✓ {results.filter(r => r.status === 'done').length} fichier{results.filter(r => r.status === 'done').length > 1 ? 's' : ''} importé{results.filter(r => r.status === 'done').length > 1 ? 's' : ''} avec succès
          </div>
        )}

        {globalStatus === 'error' && (
          <div className="summary err">
            {results.filter(r => r.status === 'error').length} erreur{results.filter(r => r.status === 'error').length > 1 ? 's' : ''} — {results.filter(r => r.status === 'done').length} fichier{results.filter(r => r.status === 'done').length > 1 ? 's' : ''} importé{results.filter(r => r.status === 'done').length > 1 ? 's' : ''}
          </div>
        )}

        {/* FOOTER */}
        <div className="mf">
          {!busy && globalStatus !== 'done' && (
            <button className="btn-cancel" onClick={onClose}>Annuler</button>
          )}
          <div style={{ flex: 1 }} />
          {canImport && (
            <button className="btn-import" onClick={handleImport}>
              ↑ Importer {files.length > 1 ? `${files.length} fichiers` : '1 fichier'}
            </button>
          )}
          {!hasFiles && (
            <button className="btn-import" onClick={() => inputRef.current?.click()}>
              Choisir {isWarner ? 'les fichiers (.txt ou .pdf)' : 'un fichier'}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .ov{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .modal{background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:480px;display:flex;flex-direction:column;overflow:hidden;max-height:88vh}
        .mh{display:flex;justify-content:space-between;align-items:flex-start;padding:16px 20px;border-bottom:1px solid #1a1a1a;flex-shrink:0}
        .mt{font-size:14px;font-weight:700;color:#eee}
        .ms{font-size:11px;color:#555;margin-top:2px}
        .xb{background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0}.xb:hover{color:#eee}
        .drop-zone{margin:16px;border:1.5px dashed #2a2a2a;border-radius:8px;padding:28px 20px;text-align:center;cursor:pointer;transition:all .2s}
        .drop-zone:hover,.dz-drag{border-color:#f97316;background:#1a1008}
        .dz-icon{font-size:28px;margin-bottom:10px}
        .dz-text{font-size:13px;color:#ccc;line-height:1.6;margin-bottom:8px}
        .dz-hint{font-size:10px;color:#444;line-height:1.4;margin-top:4px}
        .file-list{max-height:280px;overflow-y:auto;padding:8px 16px;flex:1}
        .file-row{display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid #1a1a1a;font-size:12px}
        .file-row:last-child{border-bottom:none}
        .fr-icon{width:14px;flex-shrink:0;font-size:12px}
        .fr-pending .fr-icon{color:#444}
        .fr-running .fr-icon{color:#f59e0b;animation:spin 1s linear infinite}
        .fr-done .fr-icon{color:#6ee7b7}
        .fr-error .fr-icon{color:#f87171}
        @keyframes spin{to{transform:rotate(360deg)}}
        .fr-name{flex:1;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .fr-msg{font-size:10px;color:#555;flex-shrink:0;max-width:130px;text-align:right}
        .fr-done .fr-msg{color:#6ee7b7}
        .fr-error .fr-msg{color:#f87171}
        .prog-wrap{padding:10px 16px;flex-shrink:0}
        .prog-bar{height:3px;background:#1e1e1e;border-radius:2px;overflow:hidden;margin-bottom:6px}
        .prog-fill{height:100%;background:#f97316;border-radius:2px;transition:width .3s}
        .prog-label{font-size:11px;color:#555;text-align:center}
        .summary{padding:10px 16px;font-size:13px;text-align:center;flex-shrink:0}
        .summary.ok{color:#6ee7b7}
        .summary.err{color:#f59e0b}
        .mf{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid #1a1a1a;flex-shrink:0}
        .btn-cancel{background:none;border:1px solid #2a2a2a;border-radius:6px;color:#555;font-size:12px;padding:8px 14px;cursor:pointer;font-family:inherit;transition:all .2s}
        .btn-cancel:hover{color:#eee;border-color:#444}
        .btn-import{background:#f97316;color:#000;border:none;border-radius:6px;font-size:13px;font-weight:700;padding:8px 18px;cursor:pointer;font-family:inherit;transition:opacity .2s}
        .btn-import:hover{opacity:.85}
      `}</style>
    </div>
  )
}
