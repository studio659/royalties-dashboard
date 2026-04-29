import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { useRate } from '../lib/rateContext'
import MainNav from '../components/MainNav'

export default function SettingsPage() {
  const router = useRouter()
  const { rate, updateRate } = useRate()
  const [rateInput, setRateInput] = useState('')
  const [saved, setSaved] = useState(false)
  const [importLogs, setImportLogs] = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
    setRateInput(String(rate))
    fetchImportLogs()
  }, [rate])

  async function fetchImportLogs() {
    const { data } = await supabase
      .from('import_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    setImportLogs(data || [])
  }

  async function handleSaveRate() {
    await updateRate(rateInput)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="app">
      <MainNav title="Paramètres" showBack onBack={() => router.push('/')} />
      <div className="page" style={{ maxWidth: 600, margin: '0 auto', padding: '28px 20px' }}>

        {/* TAUX EUR/USD */}
        <div className="section">
          <div className="section-title">Taux de change EUR / USD</div>
          <div className="section-sub">Utilisé pour convertir les budgets en € vers $ dans le module Recoupe.</div>
          <div className="rate-row">
            <div className="rate-label">1 € =</div>
            <input
              type="number"
              value={rateInput}
              onChange={e => setRateInput(e.target.value)}
              step="0.01"
              min="0.5"
              max="2"
              className="rate-input"
            />
            <div className="rate-label">USD</div>
            <button className={`save-btn ${saved ? 'saved' : ''}`} onClick={handleSaveRate}>
              {saved ? '✓ Enregistré' : 'Enregistrer'}
            </button>
          </div>
          <div className="rate-hint">
            Taux actuel : 1 € = {rate} $ · Source conseillée : <a href="https://www.xe.com/currencyconverter/convert/?Amount=1&From=EUR&To=USD" target="_blank" rel="noreferrer" style={{color:'#f59e0b'}}>XE.com</a>
          </div>
        </div>

        {/* HISTORIQUE IMPORTS */}
        <div className="section">
          <div className="section-title">Historique des imports CSV</div>
          <div className="section-sub">Suivi de tous les fichiers importés dans Suivi & Stats.</div>
          {importLogs.length === 0 ? (
            <div className="empty-logs">Aucun import enregistré</div>
          ) : (
            <div className="logs-list">
              {importLogs.map(log => (
                <div key={log.id} className="log-row">
                  <div className="log-left">
                    <div className="log-artist" style={{ color: '#eee' }}>{log.artist}</div>
                    <div className="log-meta">{log.source} · {log.rows_imported} lignes · {log.months_covered}</div>
                  </div>
                  <div className="log-date">{new Date(log.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' })}</div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      <style jsx>{`
        .section { background:#141414; border:1px solid #1e1e1e; border-radius:10px; padding:20px; margin-bottom:16px; }
        .section-title { font-size:14px; font-weight:700; color:#eee; margin-bottom:5px; }
        .section-sub { font-size:12px; color:#555; margin-bottom:16px; line-height:1.5; }
        .rate-row { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
        .rate-label { font-size:13px; color:#888; flex-shrink:0; }
        .rate-input { width:90px; background:#1a1a1a; border:1px solid #2a2a2a; border-radius:6px; color:#eee; font-size:14px; font-weight:700; padding:8px 12px; outline:none; font-family:inherit; }
        .rate-input:focus { border-color:#f59e0b; }
        .save-btn { background:#f59e0b; color:#000; border:none; border-radius:6px; font-size:12px; font-weight:700; padding:8px 16px; cursor:pointer; font-family:inherit; transition:all .2s; }
        .save-btn.saved { background:#6ee7b7; }
        .rate-hint { font-size:11px; color:#444; }
        .empty-logs { color:#444; font-size:13px; padding:12px 0; }
        .logs-list { display:flex; flex-direction:column; gap:1px; background:#1a1a1a; border-radius:7px; overflow:hidden; }
        .log-row { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:#141414; }
        .log-artist { font-size:13px; font-weight:600; margin-bottom:2px; }
        .log-meta { font-size:11px; color:#555; }
        .log-date { font-size:11px; color:#444; flex-shrink:0; }
      `}</style>
    </div>
  )
}
