# GameStatiq Website

Marketing/sales website + future league hub. Astro + TypeScript + Tailwind, deployed na Vercel.

## Stack

- **Astro 5** — static-first framework, zero JS by default
- **TypeScript** strict mode
- **Tailwind CSS** s GameStatiq paletou jako theme tokens (`tailwind.config.mjs`)
- **Sitemap** auto-generation (`@astrojs/sitemap`)
- Inter font (Google Fonts)

## Local development

Vyžaduje Node.js 20+.

```bash
# v root projektu
npm install
npm run dev          # → http://localhost:4321
npm run build        # → dist/ (production output)
npm run preview      # preview production build
```

## Deploy na Vercel

### Jednorázové setup

1. **Push do GitHub** — vytvořit nový repo (např. `gamestatiq-com`) a push tento projekt
2. **Vercel připojení**:
   - vercel.com → Add New → Project
   - Import GitHub repo
   - Framework Preset: **Astro** (auto-detected)
   - Build Command: `npm run build` (default)
   - Output Directory: `dist` (default)
   - Deploy
3. **Doména `gamestatiq.com`**:
   - V Vercel project → Settings → Domains → Add `gamestatiq.com`
   - U registrátora (kde jsi koupil doménu) přidat DNS records:
     - `A` record `@` → `76.76.21.21` (Vercel IP)
     - `CNAME` record `www` → `cname.vercel-dns.com`
   - HTTPS Vercel zařídí automaticky (Let's Encrypt)
4. *(Volitelné)* `.eu` a `.cz` přidat jako další domains v Vercel — všechny směrovat na ten samý projekt

### Pro každý nový commit

Push do main → Vercel automaticky redeployne. Pro preview branche dostaneš preview URL.

## Struktura

```
public/brand/             # Brand assets (SVG sada z 02_FlagFootball_Stats/web/brand/)
src/
  layouts/BaseLayout.astro    # HTML <head>, header, footer wrapper
  components/
    Header.astro          # Sticky nav s logo + odkazy
    Footer.astro          # Multi-column footer
    Hero.astro            # Landing hero s scoreboard mockup
    Features.astro        # 6 produktových funkcí
    HowItWorks.astro      # 4-krokový flow
    Pricing.astro         # Klub / Liga / Federace tiery
    ContactCTA.astro      # Demo request CTA
  pages/
    index.astro           # Landing (kompozice komponent výše)
  styles/global.css       # Tailwind base + custom utilities (.btn-primary, .h-display, ...)
astro.config.mjs          # Site URL, integrations
tailwind.config.mjs       # Brand color tokens
```

## Brand tokens (Tailwind)

| Token | Hex | Use |
|---|---|---|
| `bg-ink` / `text-ink` | `#0F1B2D` | Primary brand (header text, dark sections) |
| `bg-signal` / `text-signal` | `#E63946` | CTA, highlights (5–10 % composition) |
| `bg-pearl` | `#FFFFFF` | Primary surface |
| `bg-mist` | `#F5F7FA` | Secondary surface (alternating sections) |
| `border-stone` | `#E1E5EB` | Default borders |
| `text-graphite` | `#2D3748` | Body text |
| `text-slate` | `#5B6B7E` | Muted/secondary text |
| `bg-sky` / `text-sky` | `#7AB5D9` | Active/data accent |
| `bg-verde` | `#2A9D8F` | Success / positive |
| `bg-spark` | `#F4A261` | Warning / orange accent |
| `bg-plum` | `#7B5BA6` | Tertiary chart color |

## Roadmap

- [x] **Phase 1** — Landing page (Hero + Features + How + Pricing + Contact)
- [ ] **Phase 2** — League hub (`/liga`, `/liga/[club]`) s mock daty
- [ ] **Phase 3** — Real multi-club data aggregation (master Apps Script nebo migrace na shared DB)
- [ ] **Phase 4** — `/o-nas`, `/podminky`, `/soukromi` pages, blog/case studies
- [ ] **Phase 5** — Onboarding flow pro nové kluby (self-serve sign-up)

## Existing app integration

Současná data input app (Bobcats live stats) běží na `bohuslavrom-gif.github.io/bobcats-stats/app.html`.
V Phase 2 odkazem `/liga/bobcats` na detail klubu, který bude embedovat / nativní implementaci současného `public.html` widgetu s daty z Bobcats Apps Script.

V Phase 3 multi-club aggregation rozhodne, jestli ostatní kluby použijí stejný self-hosted approach (každý svůj GAS) nebo přejdeme na shared backend.
