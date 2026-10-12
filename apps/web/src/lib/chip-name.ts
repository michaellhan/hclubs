/**
 * A chip's accessible name: its label, what it means, then its state or count, as sentences.
 * Help text usually ends in a period, so trailing periods are stripped before joining (no
 * ". A round open … spring.. 6 clubs"). PURE.
 */
export function chipName(label: string, info: string | undefined, state: string | null): string {
  const parts = [info, state].filter((p): p is string => Boolean(p)).map((p) => p.replace(/\.+$/, ""));
  return [label, ...parts].join(". ");
}
