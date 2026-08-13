# AI&TECH TRENDS — Shorts Content Hub

Static Astro site for the AI&TECH TRENDS YouTube Shorts channel.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Preview

```bash
npm run preview
```

The production site is configured for GitHub Pages at `/shortspage/`. Internal URLs use `import.meta.env.BASE_URL` so local and GitHub Pages builds share the same source.

## Add a new Short

1. Create a Markdown file in `src/content/shorts/`, for example `my-new-signal.md`.
2. Add the YouTube ID and the full `youtubeUrl`.
3. Add title, hook, category, description and publication date.
4. Add tags and optionally `featured`, `status`, `duration`, `thumbnail` and `sources`.
5. Commit and push. A push to `main` triggers the existing GitHub Pages workflow automatically.

Example:

```yaml
---
title: "Claude just changed AI coding"
slug: "claude-ai-coding-update"
youtubeId: "XXXXXXXXXXX"
youtubeUrl: "https://www.youtube.com/shorts/XXXXXXXXXXX"
description: "The short context for the signal."
hook: "The one-line reason to care."
category: "AI News"
publishedAt: 2026-08-13
featured: false
tags: ["Claude", "Anthropic", "AI Coding"]
duration: "0:42"
sources:
  - name: "Anthropic"
    url: "https://example.com/source"
---

Add the fuller takeaway or context here in Markdown.
```

Supported categories are `AI News`, `AI Tools` and `Tech Trends`.

### Thumbnails

If `thumbnail` is omitted, the site generates a YouTube thumbnail URL from `youtubeId`. A local thumbnail can be placed under `public/` and referenced without the GitHub Pages base path, for example:

```yaml
thumbnail: "thumbnails/my-short.webp"
```

### Sources

Sources are optional. When present, they are shown on the Short detail page. Prefer official blogs, documentation, research papers and other primary sources.

### Demo content

Entries with `demo: true` are clearly labeled as demo signals, are excluded from the generated sitemap, and their detail pages are marked `noindex`. Replace the included demo entries with published channel metadata when ready.
