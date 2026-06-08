import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 開發日誌（純 markdown，靜態 build，不碰 D1）
const devlog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/devlog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    cover: z.string().default('final'),   // snipe-demo variant 當封面
  }),
});

export const collections = { devlog };
