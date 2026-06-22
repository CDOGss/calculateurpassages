import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base relative ('./') : fonctionne tel quel sur GitHub Pages (projet ou
// domaine perso) ET en local, sans avoir à coder le nom du dépôt en dur.
export default defineConfig({
  base: './',
  plugins: [react()],
})
