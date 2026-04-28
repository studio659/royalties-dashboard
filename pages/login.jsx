import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/')
    })
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else router.replace('/')
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-dot" />
          <span className="login-title">Royalties</span>
        </div>
        <p className="login-sub">Dashboard Label</p>
        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ton@email.com"
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>

      <style jsx>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0d0d0d;
          padding: 20px;
        }
        .login-card {
          background: #141414;
          border: 1px solid #222;
          border-radius: 12px;
          padding: 36px 32px;
          width: 100%;
          max-width: 360px;
        }
        .login-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }
        .login-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #f97316;
          display: inline-block;
        }
        .login-title {
          font-size: 20px;
          font-weight: 700;
          color: #eee;
          letter-spacing: -0.3px;
        }
        .login-sub {
          font-size: 12px;
          color: #555;
          margin-bottom: 28px;
          padding-left: 20px;
        }
        .field {
          margin-bottom: 14px;
        }
        .field label {
          display: block;
          font-size: 11px;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 6px;
        }
        .field input {
          width: 100%;
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 6px;
          color: #eee;
          font-size: 14px;
          padding: 10px 12px;
          outline: none;
          transition: border-color .2s;
        }
        .field input:focus { border-color: #f97316; }
        .error-msg {
          background: #2a0f0f;
          color: #f87171;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 12px;
          margin-bottom: 14px;
        }
        .btn-primary {
          width: 100%;
          background: #f97316;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 700;
          padding: 11px;
          cursor: pointer;
          margin-top: 6px;
          transition: opacity .2s;
        }
        .btn-primary:hover:not(:disabled) { opacity: .85; }
        .btn-primary:disabled { opacity: .5; cursor: default; }
      `}</style>
    </div>
  )
}
