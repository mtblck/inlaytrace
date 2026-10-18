import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Buy from './Buy'
import '../index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Buy />
  </StrictMode>,
)
