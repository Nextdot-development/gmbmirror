import type { PlaceSummary } from "./places";

/**
 * Labels search results for the business finder. Nothing here picks a result: the owner always chooses.
 * exact: the listing's name is the name typed (ignoring case, punctuation, "&"/"and" and anything after
 * a " | " or " - " that Google adds). close: most of the typed words are in the name. different: neither.
 * branch: more than one result has the same name, so the address decides which one is yours.
 */
export type MatchKind = "exact" | "close" | "different";
export type DiscoveryMatch = PlaceSummary & { match: MatchKind; branch: boolean };

const words = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim().split(" ").filter(Boolean);

/** The listing's own name, without the " | Hospital in Delhi" style suffix Google sometimes adds. */
const coreName = (name: string) => name.split(/\s[|–—-]\s/)[0];

export function matchKind(typed: string, listed: string): MatchKind {
  const t = words(typed);
  const l = words(coreName(listed));
  if (!t.length || !l.length) return "different";
  if (t.join(" ") === l.join(" ")) return "exact";
  const shared = t.filter((w) => l.includes(w)).length;
  return shared / t.length >= 0.5 && shared >= 1 ? "close" : "different";
}

export function labelMatches(typed: string, places: PlaceSummary[]): DiscoveryMatch[] {
  const key = (p: PlaceSummary) => words(coreName(p.name)).join(" ");
  const counts = places.reduce<Record<string, number>>((m, p) => ((m[key(p)] = (m[key(p)] ?? 0) + 1), m), {});
  const order: Record<MatchKind, number> = { exact: 0, close: 1, different: 2 };
  return places
    .map((p, i) => ({ ...p, match: matchKind(typed, p.name), branch: counts[key(p)] > 1, i }))
    .sort((a, b) => order[a.match] - order[b.match] || a.i - b.i) // keep Google's order within each group
    .map(({ i: _i, ...p }) => p);
}
