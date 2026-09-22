# Composition prototype · 2026-09

Two interactive visual compositions using public station catalog fields. This is a review-only, silent mock: selecting a station changes the visible selection only. It has no audio engine, account, persistence, actual favorites, tracks, or queue writes.

Run `npm run dev:local` in the repository root first (API :4341 and Vite :5184), then in another terminal run:

```powershell
node docs/prototypes/composition-2026-09/serve.cjs
```

Open <http://127.0.0.1:4193>. The server binds to loopback. Its API proxy allows GET requests only to `/catalog/search` and `/catalog/points`; it forwards to the local dev API. Static access is limited to this prototype folder and `apps/webapp/public` under `/public/`.

The real Globe is available by opening the running app at `http://127.0.0.1:5184/`, then choosing its Globe navigation item. The app has no verified URL parameter for selecting the Globe, so the prototype opens the existing app rather than pretending to route directly to it. No globe points are drawn in this mock.

Variants A and B share the same loaded station records and selection. Search, country/category filters, pagination, vertical feed preview, station selection, local queue preview, More menu, light/dark mode, and two bundled background previews are interactive. Counts shown beside loaded results are the API's catalog total; no popularity or live-listener counts are added. Missing artwork uses a deliberate typographic fallback.
