import {
  combineRegions,
  distanceMeters,
  errandStoreType,
  MAX_STORE_FENCES,
  MAX_TOTAL_GEOFENCES,
  needsStoreRefresh,
  neededStoreTypes,
  isStoreRegionId,
  openErrands,
  parseStoreRegionId,
  recordStoreEnter,
  recordStoreExit,
  REFRESH_DISTANCE_M,
  REFRESH_REGION_ID,
  refreshRegion,
  shouldNotifyStore,
  STORE_RADIUS_M,
  storeAlertMessage,
  storeRegions,
  StoreCache,
  StoreVisits,
} from "./storeAlerts";
import { GeofenceRegion } from "./geofenceLogic";
import { Note } from "../types/notes";

const NOW = new Date(2026, 9, 5, 12, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const HERE = { latitude: 32.1, longitude: 34.8 };

let n = 0;
const note = (content: string, fields: Partial<Note> = {}) =>
  ({
    _id: `n${++n}`,
    content,
    category: "errand",
    reminders_enabled: true,
    never_show: false,
    cooldown_until: null,
    store_type: "supermarket",
    ...fields,
  }) as Note;

describe("which errands count", () => {
  test("open errands only: not ideas, to-dos, alerts off, never show or cooling down", () => {
    const milk = note("buy milk");
    const notes = [
      milk,
      note("idea: a shop app", { category: "idea" }),
      note("call mom", { category: "todo" }),
      note("buy bread", { reminders_enabled: false }),
      note("buy eggs", { never_show: true }),
      note("buy jam", { cooldown_until: new Date(NOW + HOUR).toISOString() }),
    ];
    expect(openErrands(notes, NOW)).toEqual([milk]);
  });

  test("a cooldown that ended doesn't block", () => {
    const jam = note("buy jam", { cooldown_until: new Date(NOW - HOUR).toISOString() });
    expect(openErrands([jam], NOW)).toEqual([jam]);
  });

  test("store type from the backend; an older backend without it means the supermarket", () => {
    expect(errandStoreType(note("buy pills", { store_type: "pharmacy" }))).toBe("pharmacy");
    const legacy = note("buy milk") as Partial<Note>;
    delete legacy.store_type;
    expect(errandStoreType(legacy as Note)).toBe("supermarket");
    expect(errandStoreType(note("x", { store_type: "bakery" as never }))).toBe("supermarket");
  });

  test("only the store types I have open errands for, in a fixed order", () => {
    const errands = [note("send parcel", { store_type: "post_office" }), note("buy milk"), note("buy bread")];
    expect(neededStoreTypes(errands)).toEqual(["supermarket", "post_office"]);
    expect(neededStoreTypes([])).toEqual([]);
  });
});

describe("when to ask the backend for stores again", () => {
  const cache: StoreCache = {
    center: HERE,
    fetchedAt: NOW - HOUR,
    byType: { supermarket: [] },
  };

  test("no cache: refresh", () => {
    expect(needsStoreRefresh(null, HERE, ["supermarket"], NOW)).toBe(true);
  });

  test("same area, same types, recent: reuse", () => {
    expect(needsStoreRefresh(cache, HERE, ["supermarket"], NOW)).toBe(false);
  });

  test("moved about 1 km: refresh", () => {
    const moved = { latitude: HERE.latitude + 0.0095, longitude: HERE.longitude }; // ~1.06 km
    expect(distanceMeters(HERE, moved)).toBeGreaterThan(REFRESH_DISTANCE_M);
    expect(needsStoreRefresh(cache, moved, ["supermarket"], NOW)).toBe(true);
    const near = { latitude: HERE.latitude + 0.004, longitude: HERE.longitude }; // ~450 m
    expect(needsStoreRefresh(cache, near, ["supermarket"], NOW)).toBe(false);
  });

  test("a store type I don't have yet: refresh", () => {
    expect(needsStoreRefresh(cache, HERE, ["supermarket", "pharmacy"], NOW)).toBe(true);
  });

  test("older than a day: refresh", () => {
    expect(needsStoreRefresh({ ...cache, fetchedAt: NOW - 25 * HOUR }, HERE, ["supermarket"], NOW)).toBe(true);
  });
});

describe("geofences", () => {
  const store = (id: string, dLat: number, name = id) => ({
    id,
    name,
    lat: HERE.latitude + dLat,
    lon: HERE.longitude,
  });

  test("nearest stores of each needed type, small radius, enter and exit", () => {
    const regions = storeRegions(
      { supermarket: [store("node/2", 0.01), store("node/1", 0.001)], pharmacy: [store("node/9", 0.002)] },
      ["supermarket", "pharmacy"],
      HERE,
      10
    );
    expect(regions.map((r) => r.identifier)).toEqual([
      "store:supermarket:node/1",
      "store:pharmacy:node/9",
      "store:supermarket:node/2",
    ]);
    expect(regions[0]).toMatchObject({ radius: STORE_RADIUS_M, notifyOnEnter: true, notifyOnExit: true });
  });

  test("only the types asked for", () => {
    const regions = storeRegions(
      { supermarket: [store("node/1", 0.001)], pharmacy: [store("node/9", 0.002)] },
      ["pharmacy"],
      HERE,
      10
    );
    expect(regions.map((r) => r.identifier)).toEqual(["store:pharmacy:node/9"]);
  });

  test("the budget is shared fairly between types (round robin, nearest first)", () => {
    const many = (prefix: string) => Array.from({ length: 10 }, (_, i) => store(`${prefix}/${i}`, 0.001 * (i + 1)));
    const regions = storeRegions({ supermarket: many("s"), post_office: many("p") }, ["supermarket", "post_office"], HERE, 4);
    expect(regions.map((r) => r.identifier)).toEqual([
      "store:supermarket:s/0",
      "store:post_office:p/0",
      "store:supermarket:s/1",
      "store:post_office:p/1",
    ]);
  });

  test("the refresh fence: 1 km around where I am, only reports leaving it", () => {
    expect(refreshRegion(HERE)).toEqual({
      identifier: REFRESH_REGION_ID,
      latitude: HERE.latitude,
      longitude: HERE.longitude,
      radius: REFRESH_DISTANCE_M,
      notifyOnEnter: false,
      notifyOnExit: true,
    });
  });

  test("combined: saved places first, then the refresh fence and stores, well under Android's 100", () => {
    const place = (i: number): GeofenceRegion => ({
      identifier: `place-${i}`,
      latitude: 0,
      longitude: 0,
      radius: 200,
      notifyOnEnter: true,
      notifyOnExit: true,
    });
    const stores = Array.from({ length: 30 }, (_, i) => ({ ...place(i), identifier: `store:supermarket:node/${i}` }));
    const refresh = refreshRegion(HERE);

    const few = combineRegions([place(1), place(2)], stores, refresh);
    expect(few.slice(0, 2).map((r) => r.identifier)).toEqual(["place-1", "place-2"]);
    expect(few[2].identifier).toBe(REFRESH_REGION_ID);
    expect(few.length).toBe(2 + 1 + MAX_STORE_FENCES);

    const lots = combineRegions(Array.from({ length: 45 }, (_, i) => place(i)), stores, refresh);
    expect(lots.length).toBe(MAX_TOTAL_GEOFENCES);
    expect(MAX_TOTAL_GEOFENCES).toBeLessThanOrEqual(50);
  });

  test("no store fences: no refresh fence either", () => {
    expect(combineRegions([], [], refreshRegion(HERE))).toEqual([]);
    expect(combineRegions([], [], null)).toEqual([]);
  });

  test("region ids", () => {
    expect(parseStoreRegionId("store:post_office:way/12")).toEqual({ storeType: "post_office", storeId: "way/12" });
    expect(parseStoreRegionId("c4775e8b-place-id")).toBeNull();
    expect(parseStoreRegionId(REFRESH_REGION_ID)).toBeNull();
    expect(parseStoreRegionId("store:bakery:node/1")).toBeNull();
    expect(isStoreRegionId("store:supermarket:node/1")).toBe(true);
    expect(isStoreRegionId(REFRESH_REGION_ID)).toBe(true);
    expect(isStoreRegionId("c4775e8b-place-id")).toBe(false);
  });
});

describe("once per store visit", () => {
  const ID = "store:supermarket:node/1";

  test("first time at a store: notify", () => {
    expect(shouldNotifyStore(undefined, NOW)).toBe(true);
  });

  test("still inside (Android repeats ENTER): no second alert", () => {
    const visits = recordStoreEnter({}, ID, NOW, true);
    expect(shouldNotifyStore(visits[ID], NOW + 10 * MIN)).toBe(false);
  });

  test("left and came back later: a new visit", () => {
    let visits: StoreVisits = recordStoreEnter({}, ID, NOW, true);
    visits = recordStoreExit(visits, ID, NOW + 20 * MIN);
    expect(shouldNotifyStore(visits[ID], NOW + 2 * HOUR)).toBe(true);
  });

  test("a quick exit and re-enter at the edge isn't a new visit", () => {
    let visits: StoreVisits = recordStoreEnter({}, ID, NOW, true);
    visits = recordStoreExit(visits, ID, NOW + 2 * MIN);
    expect(shouldNotifyStore(visits[ID], NOW + 5 * MIN)).toBe(false);
  });

  test("an exit that never arrived: a new visit after 12 hours", () => {
    const visits = recordStoreEnter({}, ID, NOW, true);
    expect(shouldNotifyStore(visits[ID], NOW + 11 * HOUR)).toBe(false);
    expect(shouldNotifyStore(visits[ID], NOW + 12 * HOUR)).toBe(true);
  });

  test("an enter without an alert (no errands) doesn't use up the visit", () => {
    const visits = recordStoreEnter({}, ID, NOW, false);
    expect(shouldNotifyStore(visits[ID], NOW + MIN)).toBe(true);
  });

  test("old visits are forgotten", () => {
    const visits = recordStoreEnter({ "store:supermarket:node/old": { notifiedAt: NOW - 3 * 24 * HOUR, exitedAt: null } }, ID, NOW, true);
    expect(Object.keys(visits)).toEqual([ID]);
  });
});

test("the message lists the errands for that store", () => {
  const errands = [note("buy milk"), note("get carrots")];
  expect(storeAlertMessage("Shufersal", errands)).toEqual({
    title: "Shopping nearby",
    body: "You're at Shufersal – on your list: buy milk, get carrots",
  });
  const five = ["a", "b", "c", "d", "e"].map((c) => note(c));
  expect(storeAlertMessage("AM:PM", five).body).toBe("You're at AM:PM – on your list: a, b, c and 2 more");
  const long = note("x".repeat(80));
  expect(storeAlertMessage("S", [long]).body.length).toBeLessThan(90);
});

describe("stopping at a store (dwell)", () => {
  const { DWELL_MS, DWELL_RADIUS_M, forgetStoreVisit, isStillThere } = require("./storeAlerts");
  const store = { lat: 32.1, lon: 34.8 };
  // ~111 m per 0.001 degrees of latitude
  const fixAt = (dLat: number, accuracy: number | null = 10) => ({ latitude: 32.1 + dLat, longitude: 34.8, accuracy });

  test("about 2 minutes within about 60 m", () => {
    expect(DWELL_MS).toBe(2 * 60_000);
    expect(DWELL_RADIUS_M).toBe(60);
  });

  test("still there: within 60 m, with some room for the fix's accuracy (at most 40 m)", () => {
    expect(isStillThere(store, fixAt(0))).toBe(true);
    expect(isStillThere(store, fixAt(0.0005))).toBe(true); // ~55 m
    expect(isStillThere(store, fixAt(0.0008, 35))).toBe(true); // ~90 m, give or take 35
    expect(isStillThere(store, fixAt(0.0008, 10))).toBe(false);
    expect(isStillThere(store, fixAt(0.0015, 300))).toBe(false); // ~165 m: a rough fix doesn't stretch past 100 m
  });

  test("a cancelled alert doesn't use up the visit", () => {
    const visits = recordStoreEnter({}, "store:supermarket:node/1", NOW, true);
    const after = forgetStoreVisit(visits, "store:supermarket:node/1");
    expect(shouldNotifyStore(after["store:supermarket:node/1"], NOW + MIN)).toBe(true);
  });
});
