# Data sources

Every file in `data/` and where it came from. Anything not listed here is not real data.

| File | What | Source | Real or synthetic |
|---|---|---|---|
| `data/raw/rain.json` | Daily rain (mm) for Bengaluru, 2022-01-01 to 2025-12-31 (1,461 days, no gaps) | Open-Meteo Historical Weather API, `https://archive-api.open-meteo.com/v1/archive?latitude=12.9716&longitude=77.5946&start_date=2022-01-01&end_date=2025-12-31&daily=precipitation_sum&timezone=Asia%2FKolkata`. Re-download with `npm run fetch-rain`. Re-checked 2026-10-08: a fresh download matched the saved file on every day. | Real. Note: it is weather-model reanalysis for one grid cell (12.970 N, 77.564 E), not a rain gauge, and we apply the same value to every ward. Reanalysis smooths peaks: no day in 2022-2025 reaches IMD "heavy rain" (64.5 mm). |
| `data/wards.geojson` | Bengaluru (BBMP) ward boundaries, 243 wards (2022 delimitation) | **Bangalore Municipal Spatial Data by DataMeet India community**, file `Bangalore/BBMP.geojson`, https://github.com/datameet/Municipal_Spatial_Data (folder `Bangalore`). Underlying source: KGIS/KSRSAC (https://kgis.ksrsac.in/bengalurugis/), "scraped from KSRSAC" per the folder Readme. Verified 2026-10-08: our file is byte-identical to the published file (SHA-1 09580fdc...a6d836). **Licence: Creative Commons Attribution-ShareAlike 2.5 India** (http://creativecommons.org/licenses/by-sa/2.5/in/), as stated in the `Bangalore/Readme.md`. The repository default (CC BY 4.0) applies only "unless explicitly stated", and this folder states CC BY-SA 2.5 India. ShareAlike: data derived from it (e.g. `data/city.json`) must be shared under the same licence. | Real |
| `data/raw/bwssb_subdivisions.kml` | BWSSB water supply sub-divisions (43) | **BWSSB Sub-division Boundary Maps, via OpenCity, source KSRSAC, credit Vaidyanathan R**, https://data.opencity.in/dataset/bwssb-boundary-maps/resource/c9b44bab-65b6-45d8-a320-ae952d63fb05 (resource last updated 2025-11-25). Licence: listed as **Public Domain** ("Other (Public Domain)") on OpenCity. Verified 2026-10-08: our file is byte-identical to the OpenCity download (SHA-1 fee3ebe1...ebe11016). | Real |
| `data/zones.geojson` | The same 43 BWSSB sub-divisions as GeoJSON, keeping only `KGISSub_DivisionID` and `Sub_DivisionName`; altitude and repeated points removed | Converted from the KML by `npm run check-city-data` (@tmcw/togeojson + @xmldom/xmldom) | Real (converted) |
| `data/raw/osm_food.json` | 6,309 food venues (`amenity` = restaurant, fast_food, cafe, food_court) in the ward area, raw Overpass reply, OSM data as of 2026-10-06T12:46:16Z | OpenStreetMap via the Overpass API (`https://overpass-api.de/api/interpreter`). Re-download with `npm run fetch-osm-food`. **© OpenStreetMap contributors, available under the Open Database License (ODbL), https://www.openstreetmap.org/copyright** | Real. OSM coverage is uneven: a ward with few mapped venues may just be less mapped. |
| `data/city.json` | Real city model (licence: CC BY-SA 2.5 India, because it is derived from the DataMeet wards; also contains ODbL OpenStreetMap data): 243 wards (id = KGISWardNo), centroids, areas, neighbours, best-match water zone, food venue counts and flags | Built by `npm run build-city` from the three files above. Neighbours (borders within 20 m), zone (largest-share sub-division, null under 50%) and food flag (top 10% by venues per sq km) are **computed best matches**, not official records. Contains data © OpenStreetMap contributors (ODbL). | Derived from real data |

Other sourced facts used in `src/params.ts`:

| Fact | Source |
|---|---|
| Festival dates 2022-2025 (Makar Sankranti, Ugadi, Ganesh Chaturthi, Deepavali) | Google Calendar public "Holidays in India" feed (`en.indian#holiday@group.v.calendar.google.com`), downloaded 2026-10-08. Karnataka's official holiday may differ by a day. |
| "Moderate rain" starts at 15.6 mm/day | IMD rainfall intensity terminology. TODO: add exact IMD URL. |
| Monsoon = June-September, post-monsoon = October-December | IMD season definitions. |

Complaint, pharmacy and hospital numbers are **synthetic** (made by `src/simulator.ts`, tagged `sourceTag: "synthetic"`).
