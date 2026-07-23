/**
 * Session-level deduplication: once a code has been registered, it is never
 * registered again for the rest of the scanning session, no matter how many
 * times it's re-detected (lingering in frame, or the same ticket passed in
 * front of the camera again later). The displayed list therefore always
 * shows each code exactly once.
 */
export class SeenCodesTracker {
  private seen = new Set<string>();

  hasSeen(code: string): boolean {
    return this.seen.has(code);
  }

  markSeen(code: string): void {
    this.seen.add(code);
  }

  unmarkSeen(code: string): void {
    this.seen.delete(code);
  }

  reset(): void {
    this.seen.clear();
  }
}
