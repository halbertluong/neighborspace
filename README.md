# Neighborhood Vacant Spaces

A platform for neighbors and local communities to dream, vote, and pledge support for what businesses they want in vacant commercial spaces.

## Features

- **Phase 0 – Discover**: Map and list of vacant commercial spaces (Portland, OR). Filter by neighborhood. Each listing shows a **photo or Street View** (when `GOOGLE_MAPS_API_KEY` is set) and a link to view the location on Google Maps. Space details: address, square footage, zoning, previous use.
- **Phase 1 – Ideas**: Submit ideas for what you’d like to see in a space. Ideas are checked for feasibility (size, zoning) so they’re grounded in what’s possible (e.g. no pickleball in a tiny storefront).
- **Phase 2 – Themes & vote**: Consolidate ideas into themes (e.g. “Cafe & coffee shop”). Assign ideas to themes. Vote for the themes you want.
- **Phase 3 – Pledge**: Pledge a gift-card amount you’d spend when a business matching a theme opens. Surfaces community demand for business owners and landlords.

## Stack

- **Next.js 16** (App Router), **TypeScript**, **Tailwind**
- **Prisma** + **SQLite** (no external DB required)
- **Leaflet** + **OpenStreetMap** for the map

## Setup

```bash
npm install
npx prisma db push      # create SQLite DB
npx tsx prisma/seed.ts  # seed Portland sample spaces
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Open on your iPhone (same Wi‑Fi)

1. **Start the dev server** so it’s reachable on your network:
   ```bash
   npm run dev:mobile
   ```
2. **Find your Mac’s IP address** (e.g. 192.168.1.5):
   ```bash
   ipconfig getifaddr en0
   ```
   (Use `en0` for Wi‑Fi; if that’s empty, try `en1` or check **System Settings → Network → Wi‑Fi → Details**.)
3. **On your iPhone** (connected to the same Wi‑Fi), open **Safari** and go to:
   ```
   http://YOUR_MAC_IP:3000
   ```
   Example: `http://192.168.1.5:3000`
4. **Optional – Add to Home Screen:** In Safari, tap the Share button → **Add to Home Screen**. The app will open full-screen like a native app.

**Photos & Street View:** Add `GOOGLE_MAPS_API_KEY` to a `.env` file (see `.env.example`) to show Street View imagery in the app. Without it, listings still show a placeholder and a “View on Google Maps” / “Street view” link. You can also set an optional `imageUrl` per space in the database for a custom main photo.

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npx prisma db push` | Sync schema to SQLite |
| `npx tsx prisma/seed.ts` | Seed sample Portland spaces |
| `npx tsx scripts/ingest-portland.ts` | Ingest from `data/portland-vacant.json` (see script for format) |

## Portland open data

To back Phase 0 with real vacant/commercial data:

1. **Vacant and Developed Land** (Metro/Portland): e.g. [BTAA Geoportal](https://geo.btaa.org/catalog/2ce80461a32d4b2bb9ac8a4493b1e09c_0).
2. **Buildings** (City of Portland): [PDX Buildings](https://gis-pdx.opendata.arcgis.com/datasets/PDX::buildings/about).
3. **Zoning**: PortlandMaps Open Data.

Export to GeoJSON/CSV with address, lat, lng, square footage, zoning, and (if available) previous use. Convert to the JSON format described in `scripts/ingest-portland.ts` and run the ingest script.

## Data model

- **Space**: Vacant commercial location (address, coords, sq ft, zoning, previous use).
- **Idea**: User-submitted idea for a space (title, description, category, feasibility status).
- **Theme**: Named group of ideas for a space (e.g. “Cafe”).
- **ThemeVote**: One vote per theme per voter (cookie-based voter id).
- **Pledge**: Gift-card pledge (theme, amount, pledger contact).
