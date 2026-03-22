const GTA_CITIES = new Set([
  "toronto", "mississauga", "brampton", "markham", "vaughan", "richmond hill",
  "oakville", "burlington", "hamilton", "pickering", "ajax", "whitby", "oshawa",
  "scarborough", "north york", "etobicoke", "york", "east york", "king", "aurora",
  "newmarket", "barrie", "milton", "halton hills", "georgetown",
]);

const OTTAWA_CITIES = new Set([
  "ottawa", "nepean", "gloucester", "kanata", "orleans", "gatineau",
  "hull", "aylmer", "buckingham", "masson-angers",
]);

export function detectRegion(city?: string | null, province?: string | null): string {
  if (!province && !city) return "Other";

  const p = (province || "").toLowerCase().trim();
  const c = (city || "").toLowerCase().trim();

  if (p === "bc" || p === "british columbia") return "British Columbia";
  if (p === "ontario" || p === "on") {
    if (OTTAWA_CITIES.has(c)) return "Ottawa";
    if (GTA_CITIES.has(c)) return "GTA";
    return "Outside GTA";
  }
  if (p === "qc" || p === "quebec" || p === "québec") return "Outside GTA";
  if (province) return province;
  return "Other";
}
