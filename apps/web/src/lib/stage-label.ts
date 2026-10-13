/** "Information Session" already says "Info session": the kind line would only repeat it. */
export function labelSaysKind(label: string, kindLabel: string): boolean {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/\binformation\b/g, "info")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return norm(label).includes(norm(kindLabel));
}
