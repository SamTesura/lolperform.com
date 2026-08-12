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
    // In production the Worker serves both the site and /api from the same
    // origin. Set API_PROXY to borrow a populated API instead — e.g.
    // `API_PROXY=https://lolperform.com pnpm --filter @lolperform/web dev`
    // — which is the only way to exercise the data-driven islands locally
    // without a seeded local D1. changeOrigin makes the upstream see its own
    // host, so the Worker's origin-locked CORS is satisfied.
    server: {
      proxy: {
        '/api': {
          target: process.env.API_PROXY ?? 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
