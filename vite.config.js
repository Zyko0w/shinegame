import { defineConfig } from 'vite';

// Découpage du bundle : three et le post-traitement changent rarement →
// fichiers séparés, mis en cache indépendamment du code du jeu.
// N8AO est importé dynamiquement (chargé seulement si un palier l'active).
export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 2 },
            { name: 'postprocessing', test: /node_modules[\\/]postprocessing[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
