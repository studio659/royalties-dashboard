import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'

const RateContext = createContext(0.92)

export function RateProvider({ children }) {
  const [rate, setRate] = useState(0.92)

  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'eur_rate').single()
      .then(({ data }) => { if (data) setRate(parseFloat(data.value)) })
  }, [])

  async function updateRate(newRate) {
    const r = parseFloat(newRate)
    if (isNaN(r) || r <= 0) return
    await supabase.from('settings').upsert({ key: 'eur_rate', value: String(r) })
    setRate(r)
  }

  return <RateContext.Provider value={{ rate, updateRate }}>{children}</RateContext.Provider>
}

export function useRate() { return useContext(RateContext) }
