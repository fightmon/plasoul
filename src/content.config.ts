import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 開發日誌（純 markdown，靜態 build，不碰 D1）
const devlog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/devlog' }),
  schema: z.object({
    title: z.string(),
    seoTitle: z.string().optional(),       // <title> 用（含關鍵字）；省略則用 title
    date: z.coerce.date(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),   // meta keywords / JSON-LD
    cover: z.string().default('final'),   // snipe-demo variant 當封面
  }),
});

export const collections = { devlog };
