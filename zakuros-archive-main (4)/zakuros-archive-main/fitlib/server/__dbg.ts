import { steamTitleMismatch, normalizeForMatch } from "./sources";
console.error("g=", JSON.stringify(normalizeForMatch("99Vidas: The")));
console.error("s=", JSON.stringify(normalizeForMatch("The Build And Race Hotrod Game")));
console.error("mismatch=", steamTitleMismatch("99Vidas: The", "The Build And Race Hotrod Game"));