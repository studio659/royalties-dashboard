import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { COLORS, fmt } from '../lib/artists'
import MainNav from '../components/MainNav'

export default function NotificationsPage() {
  const router = useRouter()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login')
    })
    computeAlerts()
  }, [])

  async function computeAlerts() {
    setLoading(true)
    const rate = 0.92

    // Fetch all series with singles and royalties
    const { data: series } = await supabase.from('series').select('*, singles(*, budget_lines(*))')
    let allRoy = [], from = 0
    while (true) {
      const { data } = await supabase.from('royalties').select('title,artist,usd,month').range(from, from+999)
      if (!data?.length) break
      allRoy = allRoy.concat(data)
      if (data.length < 1000) break
      from += 1000
    }

    const notifs = []
    for (const serie of series || []) {
      for (const single of serie.singles || []) {
        const rows = allRoy.filter(r => r.artist === single.artist && r.title.toLowerCase() === single.title.toLowerCase())
        const totalUsd = rows.reduce((s,r) => s+r.usd, 0)
        const budgetUsd = (single.budget_eur || 0) / rate
        const pct = budgetUsd > 0 ? (totalUsd / budgetUsd) * 100 : 0

        // Alert: approaching 100%
        if (pct >= 80 && pct < 100) {
          notifs.push({ type: 'approaching', priority: 'high', serie: serie.name, title: single.title, artist: single.artist, pct, remaining: budgetUsd - totalUsd })
        }
        // Alert: just recouped (100%+)
        if (pct >= 100) {
          notifs.push({ type: 'recouped', priority: 'success', serie: serie.name, title: single.title, artist: single.artist, pct, profit: totalUsd - budgetUsd })
        }
        // Alert: no data yet (title in project but 0 royalties)
        if (totalUsd === 0 && single.budget_eur > 0) {
          notifs.push({ type: 'nodata', priority: 'info', serie: serie.name, title: single.title, artist: single.artist, pct: 0 })
        }
      }
    }

    // Sort: high priority first
    notifs.sort((a,b) => {
      const order = { high:0, success:1, info:2 }
      return order[a.priority] - order[b.priority]
    })
    setAlerts(notifs)
    setLoading(false)
  }

  const icons = { approaching: '⚡', recouped: '✅', nodata: 'ℹ️' }
  const colors = { approaching: '#f59e0b', recouped: '#6ee7b7', nodata: '#555' }
  const labels = { approaching: 'Approche de la recoupe', recouped: 'Recoupé !', nodata: 'Aucune donnée' }

  return (
    <div className="app">
      <MainNav title="Alertes" showBack onBack={() => router.push('/')} />
      <div className="page" style={{ maxWidth: 700, margin: '0 auto', padding: '28px 20px' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, color: '#555' }}>{alerts.length} alerte{alerts.length !== 1 ? 's' : ''} active{alerts.length !== 1 ? 's' : ''}</div>
        </div>

        {loading ? (
          <div className="loading-screen"><div className="loading-spinner" style={{ borderTopColor: '#f59e0b' }} /></div>
        ) : alerts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#333' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 15, color: '#555' }}>Tout est à jour, aucune alerte</div>
          </div>
        ) : (
          alerts.map((alert, i) => (
            <div key={i} style={{
              background: '#141414', border: `1px solid ${colors[alert.type]}33`,
              borderRadius: 10, padding: '16px 18px', marginBottom: 10,
              display: 'flex', alignItems: 'flex-start', gap: 14
            }}>
              <div style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>{icons[alert.type]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#eee' }}>{alert.title}</span>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: colors[alert.type]+'22', color: colors[alert.type] }}>{labels[alert.type]}</span>
                </div>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
                  {alert.artist} · {alert.serie}
                </div>
                {alert.type === 'approaching' && (
                  <div style={{ fontSize: 12, color: '#f59e0b' }}>
                    {alert.pct.toFixed(1)}% recoupé · Il reste {fmt(alert.remaining)} avant que {alert.serie.includes('Solanin') ? 'Solanin' : 'la co-prod'} commence à percevoir
                  </div>
                )}
                {alert.type === 'recouped' && (
                  <div style={{ fontSize: 12, color: '#6ee7b7' }}>
                    Bénéfice net : {fmt(alert.profit)} · La co-prod perçoit sa part depuis la prochaine échéance
                  </div>
                )}
                {alert.type === 'nodata' && (
                  <div style={{ fontSize: 12, color: '#555' }}>
                    Ce titre est dans un projet de recoupe mais aucune royaltie n'a encore été importée.
                  </div>
                )}
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: colors[alert.type], flexShrink: 0 }}>
                {alert.pct.toFixed(0)}%
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
