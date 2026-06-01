// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // 靜態 build：landing / catalog / gundam pages
  // 動態（/api/*、/admin/*）由 functions/ Pages Functions 處理
  vite: {
    plugins: [tailwindcss()]
  }
});
