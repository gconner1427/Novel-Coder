import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled so the app looks the same on every machine, including offline.
import '@fontsource-variable/instrument-sans/index.css'
import '@fontsource-variable/instrument-sans/wght-italic.css'
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/literata/opsz-italic.css'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
