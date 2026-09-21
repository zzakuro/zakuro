import { normalizeForMatch, canonicalTitle } from "./server/sources";

const cases = [
  ["God of War", "God of War (с русскими сабами"],
  ["God of War 3", "God of War 3"],
  ["God of War II (USA", "God of War II (Europe"],
  ["God of War", "Red Dead Redemption 2"],
];
for (const [a, b] of cases) {
  const ka = normalizeForMatch(a);
  const kb = normalizeForMatch(b);
  console.log(
    `${a.padEnd(34)} | ${b.padEnd(34)} => ${ka} ${ka === kb ? "==" : "!="} ${kb}`
  );
}
console.log("canonical:", canonicalTitle("God of War (с русскими сабами"));