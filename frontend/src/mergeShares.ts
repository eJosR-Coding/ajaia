import type { User } from "./api";

// union of the server list and whatever we added locally meanwhile.
// server entries first, local-only ones (added during the initial load) get appended, so nothing gets nuked.
export function mergeShares(current: User[], loaded: User[]): User[] {
  const seenId = new Set(loaded.map((s) => s.id));
  const seenEmail = new Set(loaded.map((s) => s.email.toLowerCase()));
  const localOnly = current.filter((s) => !seenId.has(s.id) && !seenEmail.has(s.email.toLowerCase()));
  return [...loaded, ...localOnly];
}
