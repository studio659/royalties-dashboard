import { useState } from 'react'
import { useRouter } from 'next/router'
import { useRate } from '../lib/rateContext'
import MainNav from '../components/MainNav'

export default function SettingsPage() {
  const router = useRouter()
  const { rate, updateRate } = useRate()
  const [input, setInput] = useState(String(rate))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const val = parseFloat(input)
    if (isNaN(val) || val <= 0 || val >= 1) {
      alert('Taux invalide. Exemple : 0.92 signifie que 1 USD = 0,92 EUR')
      return
    }
    setSaving(true)
    await updateRate(val)
    setSaved(true)
    setSaving(false)
    setTimeout(() => setSaved(false), 2500)
  }

  const usdToEur = parseFloat(input) || rate
  const eurToUsd = 1 / usdToEur

  return (
    <div className="app">
      <MainNav title="Paramètres" showBack onBack={() => router.push('/')} />
      <div className="page">

        <div className="section">
          <div className="section-title">Taux de change EUR / USD</div>
          <div className="section-sub">
            Utilisé pour convertir les royalties Warner (€) en USD et vice-versa. 
            Mis à jour manuellement — vérifiez le taux actuel sur xe.com.
          </div>

          <div className="rate-card">
            <div className="rate-row">
              <div className="rate-label">1 USD =</div>
              <div className="rate-input-wrap">
                <input
                  type="number"
                  value={input}
                  onChange={e => { setInput(e.target.value); setSaved(false) }}
                  step="0.001"
                  min="0.5"
                  max="0.999"
                  className="rate-input"
                />
              </div>
              <div className="rate-unit">EUR</div>
            </div>

            <div className="rate-preview">
              <span>→ 1 € = <strong>{eurToUsd.toFixed(4)} $</strong></span>
              <span>→ 100 € = <strong>{(100 * eurToUsd).toFixed(2)} $</strong></span>
              <span>→ 1 000 $ = <strong>{(1000 * usdToEur).toFixed(2)} €</strong></span>
            </div>

            <button
              className={`btn-save ${saved ? 'saved' : ''}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Enregistrement…' : saved ? '✓ Taux mis à jour' : 'Enregistrer'}
            </button>
          </div>

          <div className="info-box">
            💡 Ce taux affecte l'affichage de tous les montants convertis : carte Avlanche Music, 
            page Label, et calculs de Recoupe. Les montants natifs en base (€ pour Warner, $ pour DistroKid) 
            ne sont pas modifiés.
          </div>
        </div>

      </div>

      <style jsx>{`
        .page { max-width: 560px; }
        .section { margin-bottom: 32px; }
        .section-title { font-size: 14px; font-weight: 700; color: #eee; margin-bottom: 6px; }
        .section-sub { font-size: 12px; color: #555; line-height: 1.6; margin-bottom: 20px; }
        .rate-card { background: #141414; border: 1px solid #1e1e1e; border-radius: 10px; padding: 22px; }
        .rate-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
        .rate-label { font-size: 15px; font-weight: 600; color: #888; width: 60px; }
        .rate-input-wrap { flex: 1; }
        .rate-input { width: 100%; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 7px; color: #eee; font-size: 22px; font-weight: 700; padding: 10px 14px; outline: none; font-family: inherit; transition: border-color .2s; }
        .rate-input:focus { border-color: #f97316; }
        .rate-unit { font-size: 15px; font-weight: 600; color: #888; width: 40px; }
        .rate-preview { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #555; margin-bottom: 20px; padding: 12px 14px; background: #0f0f0f; border-radius: 6px; }
        .rate-preview strong { color: #aaa; }
        .btn-save { width: 100%; padding: 12px; background: #f97316; color: #000; border: none; border-radius: 7px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; transition: all .2s; }
        .btn-save:hover:not(:disabled) { opacity: .85; }
        .btn-save:disabled { opacity: .5; cursor: default; }
        .btn-save.saved { background: #6ee7b7; }
        .info-box { margin-top: 16px; background: #0f0f0f; border: 1px solid #1e1e1e; border-radius: 7px; padding: 12px 14px; font-size: 11px; color: #444; line-height: 1.6; }
      `}</style>
    </div>
  )
}
