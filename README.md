# NZ Alcohol Availability Explorer

A fully static data site built with Vite, TypeScript, and D3 that visualises long-run trends in New Zealand alcohol availability. The app loads the Stats NZ quarterly series client-side and presents five interactive views covering volumes, per-capita comparisons, beer strength composition, seasonality, and a spirits unit cross-check.

## Data source

The dataset comes from the Stats NZ "Alcohol Available for Consumption" release (year ended December 2024). The raw CSV is shipped in [`data/alcohol.csv`](data/alcohol.csv) and parsed on the client using `d3.csv` with additional coercion for derived fields.

## Getting started

```bash
npm ci
npm run dev
```

This starts Vite in development mode with hot module reloading. The app is entirely client-side; no server component is required.

## Building & deployment

```bash
npm run build
```

The build command emits a static bundle to `dist/`. A GitHub Actions workflow (`.github/workflows/pages.yml`) installs dependencies via `npm ci`, builds the site, and publishes to GitHub Pages. The Vite `base` path is configured to automatically honour the repository name when deploying to a subpath.

## Project structure

```
├── data/alcohol.csv
├── src/
│   ├── lib/        # Shared layout, CSV parsing, tooltip, download utilities
│   ├── views/      # Individual visualisation modules implementing the shared interface
│   ├── main.ts     # App bootstrap, navigation, and view lifecycle
│   └── styles.css  # Global styles and layout
├── index.html
├── vite.config.ts
└── tsconfig.json
```

Each view module exports an `init`/`destroy` pair so that new perspectives can be added consistently.

## Accessibility & performance

The layout supports keyboard navigation, focus outlines, and uses high-contrast colour palettes. Data transformations are memoised per view after the initial CSV parse, and expensive operations such as window resize handlers are debounced.
