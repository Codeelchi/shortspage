import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const sourceSchema = z.object({ name: z.string().min(1), url: z.string().url() });

const shorts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/shorts' }),
  schema: z.object({
    title: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    youtubeId: z.string().min(3),
    youtubeUrl: z.string().url(),
    description: z.string().min(1),
    hook: z.string().min(1),
    category: z.enum(['AI News', 'AI Tools', 'Tech Trends']),
    publishedAt: z.coerce.date(),
    featured: z.boolean().default(false),
    tags: z.array(z.string().min(1)).default([]),
    duration: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
    thumbnail: z.string().optional(),
    sources: z.array(sourceSchema).default([]),
    status: z.enum(['NEW', 'TRENDING', 'FEATURED']).optional(),
    demo: z.boolean().default(false),
  }),
});

export const collections = { shorts };
