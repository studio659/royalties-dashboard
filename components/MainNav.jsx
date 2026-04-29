import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

export default function MainNav({ title, showBack, onBack }) {
  const router = useRouter()
  const path = router.pathname

  const isSuivi = !path.startsWith('/recoupe')
  const isRecoupe = path.startsWith('/recoupe')

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  function goSuivi() { router.push('/') }
  function goRecoupe() { router.push('/recoupe') }

  return (
    <>
      <nav className="main-nav">
        <div className="mn-left">
          {showBack ? (
            <button className="mn-back" onClick={onBack}>←</button>
          ) : (
            <div className="mn-brand">
              <span className="mn-dot" />
              <span>Avlanche</span>
            </div>
          )}
          {title && showBack && <span className="mn-title">{title}</span>}
        </div>

        <div className="mn-right">
          {!showBack && (
            <>
              <button className="mn-icon-btn" onClick={() => router.push('/forecast')} title="Prévisionnel">📈</button>
              <button className="mn-icon-btn" onClick={() => router.push('/notifications')} title="Alertes">🔔</button>
              <button className="mn-icon-btn" onClick={() => router.push('/settings')} title="Paramètres">⚙️</button>
            </>
          )}
          <button className="mn-logout" onClick={handleLogout} title="Déconnexion">⎋</button>
        </div>
      </nav>

      <div className="main-tabs">
        <button
          className={`main-tab ${isSuivi ? 'active' : ''}`}
          onClick={goSuivi}
        >
          Suivi & Stats
        </button>
        <button
          className={`main-tab ${isRecoupe ? 'active' : ''}`}
          onClick={goRecoupe}
        >
          Recoupe
        </button>
      </div>

      <style jsx>{`
        .main-nav {
          position: sticky;
          top: 0;
          z-index: 200;
          background: rgba(13,13,13,.97);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid #1a1a1a;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          height: 50px;
        }
        .mn-left { display: flex; align-items: center; gap: 10px; }
        .mn-brand { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #eee; }
        .mn-dot { width: 7px; height: 7px; border-radius: 50%; background: #f97316; display: inline-block; }
        .mn-back {
          background: none; border: none; color: #555; font-size: 18px;
          cursor: pointer; padding: 0; line-height: 1; transition: color .2s;
        }
        .mn-back:hover { color: #eee; }
        .mn-title { font-size: 14px; font-weight: 700; color: #eee; }
        .mn-right { display: flex; align-items: center; gap: 8px; }
        .mn-icon-btn {
          background: none; border: none; color: #444; font-size: 16px;
          width: 30px; height: 30px; display: flex; align-items: center;
          justify-content: center; cursor: pointer; border-radius: 6px;
          transition: background .2s;
        }
        .mn-icon-btn:hover { background: #1a1a1a; color: #eee; }
        .mn-logout {
          background: none; border: 1px solid #1e1e1e; border-radius: 6px;
          color: #444; font-size: 15px; width: 30px; height: 30px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: color .2s, border-color .2s;
        }
        .mn-logout:hover { color: #eee; border-color: #333; }

        .main-tabs {
          display: flex;
          border-bottom: 1px solid #1a1a1a;
          background: #0d0d0d;
          padding: 0 20px;
          position: sticky;
          top: 50px;
          z-index: 199;
        }
        .main-tab {
          padding: 12px 20px;
          font-size: 13px;
          font-weight: 600;
          color: #444;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          font-family: inherit;
          margin-bottom: -1px;
          transition: color .2s;
        }
        .main-tab:hover:not(.active) { color: #888; }
        .main-tab.active { color: #eee; border-bottom-color: #eee; }
        @media (max-width: 600px) {
          .main-nav { padding: 0 12px; height: 46px; }
          .mn-title { font-size: 13px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .main-tabs { padding: 0 12px; top: 46px; }
          .main-tab { padding: 10px 14px; font-size: 12px; }
        }
      `}</style>
    </>
  )
}
