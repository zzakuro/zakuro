import { canonicalTitle, normalizeForMatch } from "./sources";
const t = "The Build And Race Hotrod Game";
console.error("canonical:", JSON.stringify(canonicalTitle(t)));
console.error("norm:", JSON.stringify(normalizeForMatch(t)));
console.error("norm(hit):", JSON.stringify(normalizeForMatch("#BLUD")));
console.error("norm(hit2):", JSON.stringify(normalizeForMatch("1000xRESIST")));