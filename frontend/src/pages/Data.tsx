import { ExternalLink } from "lucide-react";
import type { SourceTag } from "@/contract/types";
import { SourceBadge } from "@/components/Chips";
import { HonestyPill, PageHeader } from "@/components/Shell";
import { SoftCard } from "@/components/SoftCard";

/* Every row here is checked in data/SOURCES.md of the detection repository. */
const ROWS: Array<{ what: string; tag: SourceTag; detail: string }> = [
  { what: "Ward boundaries (243 BBMP wards, 2022)", tag: "real", detail: "DataMeet Municipal Spatial Data, from KGIS/KSRSAC. Byte-identical to the published file." },
  { what: "Water-supply zones (43 BWSSB sub-divisions)", tag: "real", detail: "OpenCity, source KSRSAC. Byte-identical to the published file." },
  { what: "Daily rain", tag: "real", detail: "Open-Meteo, one value for the whole city (weather-model data, not a rain gauge). Fetched every hour; if a fetch fails, nothing is written." },
  { what: "Food venues (6,309)", tag: "real", detail: "OpenStreetMap; coverage is uneven between wards." },
  { what: "Citizen complaints (history and daily feed)", tag: "synthetic", detail: "Simulated by our generator." },
  { what: "Citizen complaints from the Report form", tag: "user", detail: "Real reports sent through the Report page. Each report counts once for its ward that day; the text is not stored." },
  { what: "Pharmacy sales", tag: "synthetic", detail: "Simulated: real sales data is private." },
  { what: "Hospital visits", tag: "synthetic", detail: "Simulated: real hospital data is private. Arrives 1 to 3 days late, like the real thing would." },
  { what: "Outbreaks used for the Proof page", tag: "synthetic", detail: "Planted by our simulator, with an answer key." },
];

const SOURCES: Array<{ name: string; credit: string; licence: string; href: string }> = [
  { name: "Ward boundaries", credit: "Bangalore Municipal Spatial Data by DataMeet India community; underlying source KGIS/KSRSAC", licence: "CC BY-SA 2.5 India (stated in the Bangalore folder)", href: "https://github.com/datameet/Municipal_Spatial_Data" },
  { name: "BWSSB sub-division boundaries", credit: "Via OpenCity, source KSRSAC, credit Vaidyanathan R", licence: "Listed as Public Domain", href: "https://data.opencity.in/dataset/bwssb-boundary-maps/resource/c9b44bab-65b6-45d8-a320-ae952d63fb05" },
  { name: "Food venues", credit: "© OpenStreetMap contributors", licence: "ODbL", href: "https://www.openstreetmap.org/copyright" },
  { name: "Rain", credit: "Weather data by Open-Meteo.com", licence: "CC BY 4.0", href: "https://open-meteo.com/" },
  { name: "Map tiles", credit: "OpenFreeMap, © OpenMapTiles, data from OpenStreetMap", licence: "OpenStreetMap data under ODbL", href: "https://openfreemap.org/" },
];

const BEST_MATCH = [
  "Neighbours: two wards count as neighbours if their borders touch or come within 20 m.",
  "Water zone of a ward: the BWSSB sub-division covering the largest share of it; no zone if that share is under 50% (13 wards).",
  "Food venue wards: the top 10% of wards by OpenStreetMap food venues per square kilometre.",
  "Relative risk and alerts: computed from the simulated health signals, so they show how the system behaves, not real illness.",
];

export function DataPage() {
  return (
    <>
      <PageHeader title="Data and sources"><HonestyPill /></PageHeader>
      <SoftCard className="grid gap-4 p-6 md:p-8" aria-labelledby="rs-h">
        <h2 id="rs-h" className="text-2xl font-bold">What is real and what is simulated</h2>
        <ul className="grid gap-3">
          {ROWS.map((r) => (
            <li key={r.what} className="soft-sm grid gap-1 rounded-btn px-5 py-4 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)] md:items-center md:gap-6">
              <span className="font-bold">{r.what}</span>
              <span><SourceBadge tag={r.tag} /></span>
              <span className="text-muted">{r.detail}</span>
            </li>
          ))}
        </ul>
      </SoftCard>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:gap-8">
        <SoftCard className="grid content-start gap-4 p-6 md:p-8" aria-labelledby="src-h">
          <h2 id="src-h" className="text-2xl font-bold">Sources and licences</h2>
          <ul className="grid gap-4">
            {SOURCES.map((s) => (
              <li key={s.name} className="grid gap-1">
                <span className="font-bold">{s.name}</span>
                <span>{s.credit}. Licence: {s.licence}.</span>
                <a href={s.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all">{s.href}<ExternalLink className="size-4 shrink-0" aria-hidden="true" /></a>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Because the ward boundaries are ShareAlike, the city model built from them (city.json) is shared under the same licence.</p>
        </SoftCard>
        <SoftCard className="grid content-start gap-4 p-6 md:p-8" aria-labelledby="bm-h">
          <h2 id="bm-h" className="text-2xl font-bold">Best matches we computed</h2>
          <p className="text-muted">These are our own calculations from the real shapes, not official records.</p>
          <ul className="grid list-disc gap-2 pl-6">{BEST_MATCH.map((b) => <li key={b}>{b}</li>)}</ul>
        </SoftCard>
      </div>
    </>
  );
}
