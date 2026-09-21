import { normalizeForMatch } from "./server/sources";

const cases = [
  "102 Dalmatiner (Germany",
  "102 Dalmatiner (Europe) (En,Fr,De,Es,It,Nl) (Rev 1",
  "God of War (с русскими сабами",
  "God of War",
  "God of War II (USA",
  "God of War II (Europe, Australia) (En,Fr,De,Es,It,Ru",
  "10,000,000",
  "100 Crime Cats (2025, Casual",
  "1943 - The Battle of Midway (Japan) (Beta",
];
for (const c of cases) console.log(`${c.padEnd(58)} => ${normalizeForMatch(c)}`);