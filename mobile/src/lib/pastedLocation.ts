import { LatLon } from "./geo";

// What a pasted text means as a location: "lat, lon", a full Google Maps
// link (the coordinates are in the URL), or a link only the server can
// answer: a short share link (maps.app.goo.gl) it follows, or a link with
// just a place's name or address it looks up. Same rules as the backend's
// maps_links.py.

export type PastedLocation =
  | { kind: "point"; point: LatLon }
  | { kind: "server"; url: string }
  | { kind: "invalid"; message: string }
  | { kind: "none" }; // not coordinates or a Maps link

export const NO_COORDINATES_MESSAGE =
  "Couldn't find this place from the link. In Google Maps, drop a pin and share that instead.";

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const PIN = new RegExp(`!3d${NUM}!4d${NUM}`, "g"); // a place's pin
const QUERY = new RegExp(`[?&](?:q|query|ll|sll|destination|center)=${NUM}\\s*,\\s*\\+?${NUM}(?![\\d.])`);
const AT = new RegExp(`@${NUM},${NUM}(?![\\d.])`); // the map's center
const PLAIN = new RegExp(`^\\s*${NUM}\\s*[,\\s]\\s*${NUM}\\s*$`);
const SHORT_LINK = /https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]+/;
const MAPS_LINK = /https?:\/\/(?:(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\S*/;

function checked(latitude: number, longitude: number): PastedLocation {
  if (!(latitude >= -90 && latitude <= 90)) {
    return { kind: "invalid", message: "Latitude must be between -90 and 90." };
  }
  if (!(longitude >= -180 && longitude <= 180)) {
    return { kind: "invalid", message: "Longitude must be between -180 and 180." };
  }
  return { kind: "point", point: { latitude, longitude } };
}

function decoded(text: string): string {
  let out = text;
  for (let i = 0; i < 2; i++) {
    try {
      out = decodeURIComponent(out); // links can be encoded twice
    } catch {
      break;
    }
  }
  return out;
}

function fromMapsLink(link: string): PastedLocation {
  const text = decoded(link);
  const pins = [...text.matchAll(PIN)];
  const m = pins.length > 0 ? pins[pins.length - 1] : text.match(QUERY) ?? text.match(AT);
  return m ? checked(Number(m[1]), Number(m[2])) : { kind: "server", url: link };
}

export function parsePastedLocation(text: string): PastedLocation {
  const trimmed = text.trim();
  const plain = trimmed.match(PLAIN);
  if (plain) {
    return checked(Number(plain[1]), Number(plain[2]));
  }
  const short = trimmed.match(SHORT_LINK);
  if (short) {
    return { kind: "server", url: short[0] };
  }
  const link = trimmed.match(MAPS_LINK);
  if (link) {
    return fromMapsLink(link[0]);
  }
  return { kind: "none" };
}
