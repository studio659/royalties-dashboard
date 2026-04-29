import '../styles/globals.css'
import { RateProvider } from '../lib/rateContext'

export default function App({ Component, pageProps }) {
  return (
    <RateProvider>
      <Component {...pageProps} />
    </RateProvider>
  )
}
