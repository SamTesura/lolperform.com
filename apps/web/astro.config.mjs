// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://lolperform.com',
  output: 'static',
  integrations: [react(), mdx(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Local dev: proxy the API to a locally-running Worker (`wrangler dev`).
    // In production the Worker serves both the site and /api from the same origin.
    server: {
      proxy: {
        '/api': 'http://localhost:8787',
      },
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
