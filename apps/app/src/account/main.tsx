import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Account from './Account'
import '../index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Account />
  </StrictMode>,
)
