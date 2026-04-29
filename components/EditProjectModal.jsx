import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/artists'

export default function EditProjectModal({ serie, onClose, onSuccess }) {
  const [tab, setTab] = useState('contract') // 'contract' | 'budget'
  const [saving, setSaving] = useState(false)
  const [singles, setSingles] = useState([])

  // Contract fields
  const [artistRate, setArtistRate] = useState(serie.artist_rate)
  const [coprodName, setCoprodName] = useState(serie.coprod_name || '')
  const [coprodRate, setCoprodRate] = useState(serie.coprod_rate)
  const [labelRate, setLabelRate] = useState(serie.label_rate)
  const [mgmtRate, setMgmtRate] = useState(serie.mgmt_rate)
  const [notes, setNotes] = useState(serie.notes || '')

  useEffect(() => {
    fetchSingles()
  }, [])

  async function fetchSingles() {
    const { data } = await supabase
      .from('singles')
      .select('*, budget_lines(*)')
      .eq('series_id', serie.id)
      .order('release_date')
    setSingles(data || [])
  }

  async function saveContract() {
    setSaving(true)
    await supabase.from('series').update({
      artist_rate: parseFloat(artistRate),
      coprod_name: coprodName || null,
      coprod_rate: parseFloat(coprodRate),
      label_rate: parseFloat(labelRate),
      mgmt_rate: parseFloat(mgmtRate),
      notes,
    }).eq('id', serie.id)
    setSaving(false)
    onSuccess()
    onClose()
  }

  async function updateBudgetLine(lineId, field, value) {
    await supabase.from('budget_lines').update({ [field]: field === 'amount_eur' ? parseFloat(value)||0 : value }).eq('id', lineId)
    fetchSingles()
  }

  async function deleteBudgetLine(lineId, singleId) {
    await supabase.from('budget_lines').delete().eq('id', lineId)
    // Update single budget_eur
    const { data } = await supabase.from('budget_lines').select('amount_eur').eq('single_id', singleId)
    const total = (data || []).reduce((s, l) => s + l.amount_eur, 0)
    await supabase.from('singles').update({ budget_eur: total }).eq('id', singleId)
    fetchSingles()
  }

  async function addBudgetLine(singleId, label, amount) {
    if (!label || !amount) return
    await supabase.from('budget_lines').insert({ single_id: singleId, label, amount_eur: parseFloat(amount)||0, status: 'pending' })
    const { data } = await supabase.from('budget_lines').select('amount_eur').eq('single_id', singleId)
    const total = (data || []).reduce((s, l) => s + l.amount_eur, 0)
    await supabase.from('singles').update({ budget_eur: total }).eq('id', singleId)
    fetchSingles()
  }

  const color = COLORS[serie.artist] || '#f59e0b'

  return (
    <div className="ov" onClick={!saving ? onClose : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <div>
            <div className="mh-t">Modifier · {serie.name}</div>
            <div className="mh-tabs">
              <button className={`mt ${tab==='contract'?'act':''}`} onClick={()=>setTab('contract')}>Contrat</button>
              <button className={`mt ${tab==='budget'?'act':''}`} onClick={()=>setTab('budget')}>Budgets</button>
            </div>
          </div>
          <button className="xb" onClick={onClose}>✕</button>
        </div>

        <div className="mb">
          {tab === 'contract' && (
            <div>
              <div className="hbox">Les modifications s'appliquent aux calculs de répartition. Les royalties déjà générées ne changent pas.</div>
              <div className="row2">
                <div className="field">
                  <label>Part artiste (%)</label>
                  <input type="number" value={artistRate} onChange={e=>setArtistRate(e.target.value)} min="0" max="100" step="0.5"/>
                </div>
                <div className="field">
                  <label>Gestion Avlanche (%)</label>
                  <input type="number" value={mgmtRate} onChange={e=>setMgmtRate(e.target.value)} min="0" max="100" step="0.5"/>
                </div>
              </div>
              <div className="field">
                <label>Co-producteur</label>
                <input value={coprodName} onChange={e=>setCoprodName(e.target.value)} placeholder="ex: Solanin"/>
              </div>
              {coprodName && (
                <div className="row2">
                  <div className="field">
                    <label>Part co-prod (%)</label>
                    <input type="number" value={coprodRate} onChange={e=>{const v=parseFloat(e.target.value)||0;setCoprodRate(v);setLabelRate(100-v)}} min="0" max="100" step="5"/>
                  </div>
                  <div className="field">
                    <label>Part Avlanche label (%)</label>
                    <input type="number" value={labelRate} onChange={e=>setLabelRate(e.target.value)} min="0" max="100" step="5"/>
                  </div>
                </div>
              )}
              <div className="field">
                <label>Notes</label>
                <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Clauses particulières..."/>
              </div>
            </div>
          )}

          {tab === 'budget' && (
            <div>
              {singles.map(single => (
                <div key={single.id} className="single-block">
                  <div className="sb-title">{single.title}</div>
                  <div className="sb-budget">Budget total : €{Math.round(single.budget_eur||0).toLocaleString('fr-FR')}</div>
                  {(single.budget_lines||[]).map(line => (
                    <BudgetLineRow key={line.id} line={line} singleId={single.id}
                      onUpdate={updateBudgetLine} onDelete={deleteBudgetLine} />
                  ))}
                  <AddLineRow singleId={single.id} onAdd={addBudgetLine} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mf">
          <div style={{flex:1}}/>
          {tab === 'contract' && (
            <button className="bs" style={{background:color}} onClick={saveContract} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer le contrat'}
            </button>
          )}
          {tab === 'budget' && (
            <button className="bs" style={{background:'#555',color:'#eee'}} onClick={()=>{onSuccess();onClose()}}>
              Fermer
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .ov{position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .modal{background:#141414;border:1px solid #222;border-radius:12px;width:100%;max-width:560px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
        .mh{display:flex;justify-content:space-between;align-items:flex-start;padding:16px 20px;border-bottom:1px solid #1e1e1e;flex-shrink:0}
        .mh-t{font-size:14px;font-weight:700;color:#eee;margin-bottom:8px}
        .mh-tabs{display:flex;gap:4px}
        .mt{background:none;border:1px solid #2a2a2a;border-radius:6px;color:#555;font-size:12px;font-weight:600;padding:5px 14px;cursor:pointer;font-family:inherit;transition:all .2s}
        .mt.act{background:#1e1e1e;color:#eee;border-color:#444}
        .xb{background:none;border:none;color:#444;font-size:16px;cursor:pointer;padding:0}.xb:hover{color:#eee}
        .mb{padding:18px 20px;overflow-y:auto;flex:1}
        .field{margin-bottom:14px}
        .field label{display:block;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
        .field input,.field textarea,.field select{width:100%;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;color:#eee;font-size:13px;padding:8px 12px;outline:none;font-family:inherit}
        .field input:focus,.field textarea:focus{border-color:#444}
        .field textarea{resize:vertical}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .hbox{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:6px;padding:10px 12px;font-size:11px;color:#555;margin-bottom:14px;line-height:1.5}
        .single-block{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px;margin-bottom:10px}
        .sb-title{font-size:13px;font-weight:700;color:#eee;margin-bottom:2px}
        .sb-budget{font-size:11px;color:#555;margin-bottom:10px}
        .mf{display:flex;align-items:center;padding:14px 20px;border-top:1px solid #1e1e1e;flex-shrink:0}
        .bs{color:#000;border:none;border-radius:7px;font-size:13px;font-weight:700;padding:9px 20px;cursor:pointer;font-family:inherit}
        .bs:disabled{opacity:.4;cursor:default}
      `}</style>
    </div>
  )
}

function BudgetLineRow({ line, singleId, onUpdate, onDelete }) {
  const [label, setLabel] = useState(line.label)
  const [amount, setAmount] = useState(String(line.amount_eur))
  const [editing, setEditing] = useState(false)

  function save() {
    onUpdate(line.id, 'label', label)
    onUpdate(line.id, 'amount_eur', amount)
    setEditing(false)
  }

  if (editing) return (
    <div style={{display:'flex',gap:6,marginBottom:6,alignItems:'center'}}>
      <input value={label} onChange={e=>setLabel(e.target.value)} style={{flex:1,background:'#141414',border:'1px solid #333',borderRadius:5,color:'#eee',fontSize:12,padding:'6px 10px',outline:'none',fontFamily:'inherit'}}/>
      <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} style={{width:80,background:'#141414',border:'1px solid #333',borderRadius:5,color:'#eee',fontSize:12,padding:'6px 10px',outline:'none',fontFamily:'inherit'}}/>
      <button onClick={save} style={{background:'#6ee7b7',border:'none',borderRadius:5,color:'#000',fontSize:11,fontWeight:700,padding:'5px 10px',cursor:'pointer'}}>✓</button>
      <button onClick={()=>setEditing(false)} style={{background:'none',border:'none',color:'#555',fontSize:14,cursor:'pointer'}}>✕</button>
    </div>
  )

  return (
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid #1a1a1a',fontSize:12}}>
      <span style={{flex:1,color:'#bbb'}}>{line.label}</span>
      <span style={{color:'#eee',fontWeight:600}}>€{line.amount_eur}</span>
      <button onClick={()=>setEditing(true)} style={{background:'none',border:'none',color:'#555',fontSize:11,cursor:'pointer',padding:'0 4px'}}>✏️</button>
      <button onClick={()=>onDelete(line.id, singleId)} style={{background:'none',border:'none',color:'#333',fontSize:11,cursor:'pointer',padding:'0 4px'}}>🗑</button>
    </div>
  )
}

function AddLineRow({ singleId, onAdd }) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [show, setShow] = useState(false)

  function submit() {
    onAdd(singleId, label, amount)
    setLabel(''); setAmount(''); setShow(false)
  }

  if (!show) return (
    <button onClick={()=>setShow(true)} style={{background:'none',border:'1px dashed #1e1e1e',borderRadius:5,color:'#444',fontSize:11,padding:'5px 12px',cursor:'pointer',width:'100%',marginTop:6,fontFamily:'inherit'}}>+ Ajouter une ligne</button>
  )

  return (
    <div style={{display:'flex',gap:6,marginTop:6,alignItems:'center'}}>
      <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Poste" style={{flex:1,background:'#141414',border:'1px solid #333',borderRadius:5,color:'#eee',fontSize:12,padding:'6px 10px',outline:'none',fontFamily:'inherit'}}/>
      <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="€" style={{width:70,background:'#141414',border:'1px solid #333',borderRadius:5,color:'#eee',fontSize:12,padding:'6px 10px',outline:'none',fontFamily:'inherit'}}/>
      <button onClick={submit} style={{background:'#f59e0b',border:'none',borderRadius:5,color:'#000',fontSize:11,fontWeight:700,padding:'5px 10px',cursor:'pointer'}}>+</button>
      <button onClick={()=>setShow(false)} style={{background:'none',border:'none',color:'#555',fontSize:14,cursor:'pointer'}}>✕</button>
    </div>
  )
}
