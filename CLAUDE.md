# CLAUDE.md — Avoro Icons

This package is the single source of truth for all UI icons in Avoro applications.

## Rules

- Icons are used by registry name only. Never hand-draw an icon in app code.
- New icons arrive by PR adding one src/svg/<name>.svg + registry entry.
- UI chrome icons (arrows, close, search, settings) stay Lucide-style:
  24 viewBox, 1.5px stroke, currentColor, round caps.
- Custom-drawn icons are allowed ONLY for Avoro-specific concepts.

## Usage

```tsx
import { AIcon } from "@avoroglobal/icons";

// Default 16px
<AIcon name="bolt" />

// With size
<AIcon name="gauge" size={24} />

// With className
<AIcon name="search" className="my-icon" />
```

## Adding a new icon

1. Add `src/svg/<name>.svg` with the standard attributes:
   - `xmlns="http://www.w3.org/2000/svg"`
   - `viewBox="0 0 24 24"`
   - `fill="none"`
   - `stroke="currentColor"`
   - `stroke-width="1.5"`
   - `stroke-linecap="round"`
   - `stroke-linejoin="round"`

2. Add the name to `src/registry.ts` (keep alphabetical)

3. Run `npm run build && npm test`

4. PR with the icon name and use case
