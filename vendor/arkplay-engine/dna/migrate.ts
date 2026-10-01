/* DNA migrations. Version 1 is the first published schema, so there is nothing to migrate
 * yet; this is where the v1 → v2 step goes when one is needed. The rule: a migration
 * turns an old document into one that renders the same way under the new schema. */

export function migrate(src: Record<string, unknown>, warn: (m: string) => void): Record<string, unknown> {
  const v = Number(src.v ?? 1)
  if (v > 1) warn(`This avatar was made with a newer version (v${v}); some details may not show.`)
  return src
}
