# Agent Guidelines

## Coding standards
- Use TypeScript `strict` mode; avoid `any` and prefer explicit types.
- Follow functional composition with small reusable helpers.
- Prefer `const` and immutability where practical; avoid mutating inputs.
- Keep modules cohesive: one main export per file when possible.
- Use D3 v7+ with ES module imports from `d3`.
- Use semantic HTML elements and accessible ARIA attributes.
- Keep CSS modular via BEM-like class names scoped under `.app`.

## Data loader contract
- `loadData()` returns a promise resolving to `{ records, byGroup, bySeries }` where records conform to `DataRecord` and derived collections are memoised lookup tables.
- Each `DataRecord` exposes:
  - `period` (original string)
  - `groupKey` and `seriesKey` slugified lower-case hyphen strings.
  - `groupLabel`, `seriesLabel`
  - `year: number`
  - `month: number` (3/6/9/12)
  - `value: number | null`
  - `units: string`
- Loader must coerce numeric fields safely (invalid numbers -> `null`).
- Derived helpers should live under `src/lib` and never re-parse the CSV after first load.

## View module interface
Every view module in `src/views` exports:
```ts
export interface ViewInstance {
  init: (container: HTMLElement, data: DataModel, controls: Controls) => void;
  destroy: () => void;
}
```
- `init` sets up DOM structure and renders chart.
- `destroy` removes listeners and clears timers.
- Use layout helpers from `src/lib/layout.ts` for shell creation.
- Use download helpers for CSV/SVG export.

## Testing guidance
- Provide `npm run build` for integration.
- For new views add a lightweight DOM smoke test using JSDOM or a simple render invocation verifying no runtime errors.

## Commit conventions
- Use present-tense imperative messages (e.g., "Add per capita view").

## Accessibility & performance checklist
- Keyboard focus visible on interactive elements.
- Provide `aria-label` where needed.
- Use high contrast colors and accessible patterns.
- Debounce expensive operations on resize or input.
- Memoize derived data tables.
- Ensure downloadable assets include descriptive filenames.
