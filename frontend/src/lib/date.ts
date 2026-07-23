/** YYYY-MM-DD for "today", in the client's local time. Assumes the client
 * and the backend server are in the same timezone (true for an internal
 * company deployment) - the backend groups scans by day using its own
 * local time (see backend/app/schemas.py: today_str()). */
export function todayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
