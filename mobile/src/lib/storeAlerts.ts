import { Note } from "../types/notes";
import { canAlert } from "./alertRules";
import { GeofenceRegion } from "./geofenceLogic";
import { normalizeCategory } from "./categoryColors";
import { distanceMeters, LatLon } from "./geo";

export { distanceMeters };
export type { LatLon };

// Pure logic for errand alerts near any store of the right type (a
// supermarket for "buy milk", a pharmacy for "buy vitamins"...). The I/O is
// in services/storeAlerts.ts.
//
// Battery: nothing polls. The phone looks for stores once around where you
// are and registers geofences for the nearest ones, plus one big "refresh"
// geofence around that spot. Android watches geofences with the network and
// low-power location it already has; only leaving the refresh fence (about
// 1 km away) wakes the app to look for stores again.

export const STORE_TYPES = ["supermarket", "pharmacy", "post_office"] as const;
export type StoreType = (typeof STORE_TYPES)[number];

export interface Store {
  id: string; // OpenStreetMap id, e.g. "node/123"
  name: string;
  lat: number;
  lon: number;
}

export interface StoreCache {
  center: LatLon; // where the stores were looked up
  fetchedAt: number;
  byType: Partial<Record<StoreType, Store[]>>;
}

export const SEARCH_RADIUS_M = 2000;
export const REFRESH_DISTANCE_M = 1000; // look again after moving about this far
export const STORE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const STORE_RADIUS_M = 100; // around a store; Android's geofences aren't reliable below ~100 m
// Android allows 100 geofences per app; stay well under, saved places first
export const MAX_TOTAL_GEOFENCES = 40;
export const MAX_STORE_FENCES = 12;

export const REFRESH_REGION_ID = "store-refresh";
const STORE_PREFIX = "store:";

function isStoreType(value: unknown): value is StoreType {
  return typeof value === "string" && (STORE_TYPES as readonly string[]).includes(value);
}

// ---- which errands ----

function isCoolingDown(note: Note, now: number): boolean {
  if (!note.cooldown_until) {
    return false;
  }
  const until = new Date(note.cooldown_until).getTime();
  return !Number.isNaN(until) && until > now;
}

// Errands that can still alert: not ideas (canAlert), alerts on, not
// "never show", not snoozed. Deleted errands simply aren't in the list.
export function openErrands(notes: Note[], now: number): Note[] {
  return notes.filter(
    (n) => normalizeCategory(n.category) === "errand" && canAlert(n) && !n.never_show && !isCoolingDown(n, now)
  );
}

// the backend says which store an errand needs; an older one doesn't, and
// most errands are for the supermarket anyway
export function errandStoreType(note: Note): StoreType {
  return isStoreType(note.store_type) ? note.store_type : "supermarket";
}

export function neededStoreTypes(errands: Note[]): StoreType[] {
  const needed = new Set(errands.map(errandStoreType));
  return STORE_TYPES.filter((t) => needed.has(t));
}

// ---- when to look for stores again ----

export function needsStoreRefresh(
  cache: StoreCache | null,
  position: LatLon,
  types: StoreType[],
  now: number
): boolean {
  if (!cache) {
    return true;
  }
  return (
    distanceMeters(cache.center, position) >= REFRESH_DISTANCE_M ||
    now - cache.fetchedAt >= STORE_CACHE_MAX_AGE_MS ||
    types.some((t) => !cache.byType[t])
  );
}

// ---- geofences ----

export function storeRegionId(type: StoreType, storeId: string): string {
  return `${STORE_PREFIX}${type}:${storeId}`;
}

export function parseStoreRegionId(id: string): { storeType: StoreType; storeId: string } | null {
  if (!id.startsWith(STORE_PREFIX)) {
    return null;
  }
  const rest = id.slice(STORE_PREFIX.length);
  const colon = rest.indexOf(":");
  const storeType = rest.slice(0, colon);
  const storeId = rest.slice(colon + 1);
  return colon > 0 && isStoreType(storeType) && storeId ? { storeType, storeId } : null;
}

export function isStoreRegionId(id: string): boolean {
  return id === REFRESH_REGION_ID || parseStoreRegionId(id) !== null;
}

// The nearest stores of each needed type, taking turns between types so one
// type can't use up the whole budget.
export function storeRegions(
  byType: Partial<Record<StoreType, Store[]>>,
  types: StoreType[],
  position: LatLon,
  max: number = MAX_STORE_FENCES
): GeofenceRegion[] {
  const queues = types.map((type) =>
    (byType[type] ?? [])
      .map((s) => ({ s, d: distanceMeters(position, { latitude: s.lat, longitude: s.lon }) }))
      .sort((a, b) => a.d - b.d)
      .map(({ s }) => ({ type, s }))
  );
  const regions: GeofenceRegion[] = [];
  for (let i = 0; regions.length < max && queues.some((q) => i < q.length); i++) {
    for (const q of queues) {
      if (i < q.length && regions.length < max) {
        const { type, s } = q[i];
        regions.push({
          identifier: storeRegionId(type, s.id),
          latitude: s.lat,
          longitude: s.lon,
          radius: STORE_RADIUS_M,
          notifyOnEnter: true,
          notifyOnExit: true,
        });
      }
    }
  }
  return regions;
}

// leaving it means you've moved about 1 km: time to look for stores again
export function refreshRegion(center: LatLon): GeofenceRegion {
  return {
    identifier: REFRESH_REGION_ID,
    latitude: center.latitude,
    longitude: center.longitude,
    radius: REFRESH_DISTANCE_M,
    notifyOnEnter: false,
    notifyOnExit: true,
  };
}

// Saved places always fit; stores get what's left of the budget.
export function combineRegions(
  places: GeofenceRegion[],
  stores: GeofenceRegion[],
  refresh: GeofenceRegion | null
): GeofenceRegion[] {
  const placeRegions = places.slice(0, MAX_TOTAL_GEOFENCES);
  const room = Math.min(MAX_STORE_FENCES, MAX_TOTAL_GEOFENCES - placeRegions.length - 1);
  if (stores.length === 0 || !refresh || room <= 0) {
    return placeRegions;
  }
  return [...placeRegions, refresh, ...stores.slice(0, room)];
}

// ---- stopping there (dwell) ----

// "Alert when I stop there" (default) or "Alert when passing by"
export type StoreAlertMode = "stop" | "pass";

// Geofences only report enter and exit, so on enter the alert is scheduled
// for DWELL_MS later and cancelled if you leave first (an exit event, or a
// fix taken when the time is up that's more than DWELL_RADIUS_M away).
export const DWELL_MS = 2 * 60 * 1000;
export const DWELL_RADIUS_M = 60;
const DWELL_ACCURACY_SLACK_M = 40; // a rough fix can't stretch "still there" further than this

export function isStillThere(
  store: { lat: number; lon: number },
  fix: LatLon & { accuracy?: number | null }
): boolean {
  const slack = Math.min(fix.accuracy ?? 0, DWELL_ACCURACY_SLACK_M);
  return distanceMeters(fix, { latitude: store.lat, longitude: store.lon }) <= DWELL_RADIUS_M + slack;
}

// ---- once per visit ----

export interface StoreVisit {
  notifiedAt: number; // last alert for this store
  exitedAt: number | null; // last time we left it after that
}
export type StoreVisits = Record<string, StoreVisit>;

const REVISIT_GAP_MS = 30 * 60 * 1000; // a quick exit + enter at the edge is the same visit
const MISSED_EXIT_MS = 12 * 60 * 60 * 1000; // Android can miss an EXIT
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

export function shouldNotifyStore(visit: StoreVisit | undefined, now: number): boolean {
  if (!visit) {
    return true;
  }
  const since = now - visit.notifiedAt;
  if (since >= MISSED_EXIT_MS) {
    return true;
  }
  return visit.exitedAt !== null && visit.exitedAt >= visit.notifiedAt && since >= REVISIT_GAP_MS;
}

function pruned(visits: StoreVisits, now: number): StoreVisits {
  return Object.fromEntries(Object.entries(visits).filter(([, v]) => now - v.notifiedAt < FORGET_AFTER_MS));
}

export function recordStoreEnter(visits: StoreVisits, regionId: string, now: number, notified: boolean): StoreVisits {
  const next = pruned(visits, now);
  if (notified) {
    next[regionId] = { notifiedAt: now, exitedAt: null };
  }
  return next;
}

// an alert that was cancelled (you walked on) doesn't count as this visit's
export function forgetStoreVisit(visits: StoreVisits, regionId: string): StoreVisits {
  const next = { ...visits };
  delete next[regionId];
  return next;
}

export function recordStoreExit(visits: StoreVisits, regionId: string, now: number): StoreVisits {
  const next = pruned(visits, now);
  if (next[regionId]) {
    next[regionId] = { ...next[regionId], exitedAt: now };
  }
  return next;
}

// ---- the notification ----

const MAX_LISTED = 3;
const MAX_ERRAND_CHARS = 40;

function short(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_ERRAND_CHARS ? `${oneLine.slice(0, MAX_ERRAND_CHARS - 1)}…` : oneLine;
}

export function storeAlertMessage(storeName: string, errands: Note[]): { title: string; body: string } {
  const listed = errands.slice(0, MAX_LISTED).map((e) => short(e.content));
  const more = errands.length - listed.length;
  const list = listed.join(", ") + (more > 0 ? ` and ${more} more` : "");
  return { title: "Shopping nearby", body: `You're at ${storeName} – on your list: ${list}` };
}
