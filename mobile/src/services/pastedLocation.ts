import { ApiError } from "../api/client";
import { resolveMapsLink } from "../api/places";
import { LatLon } from "../lib/geo";
import { NO_COORDINATES_MESSAGE, parsePastedLocation } from "../lib/pastedLocation";

// A pasted location as a point: coordinates and full Google Maps links are
// read on the phone; the server follows short share links and looks up links
// with only a place's name or address.

export class PastedLocationError extends Error {}

const NOT_A_LOCATION = 'Paste coordinates like "32.0812, 34.8105" or a Google Maps link.';
const OFFLINE = "Couldn't open the link. Check your connection and try again.";

function kindOf(e: ApiError): string | undefined {
  try {
    return JSON.parse(e.body)?.detail?.kind;
  } catch {
    return undefined;
  }
}

export async function resolvePastedLocation(text: string): Promise<LatLon> {
  const parsed = parsePastedLocation(text);
  switch (parsed.kind) {
    case "point":
      return parsed.point;
    case "invalid":
      throw new PastedLocationError(parsed.message);
    case "none":
      throw new PastedLocationError(NOT_A_LOCATION);
  }
  try {
    return await resolveMapsLink(parsed.url);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 404) {
        throw new PastedLocationError(
          "Short links need the updated server. Open the link in Google Maps and copy the full link instead."
        );
      }
      const kind = kindOf(e);
      if (kind === "no_coordinates") {
        throw new PastedLocationError(NO_COORDINATES_MESSAGE);
      }
      if (kind === "not_allowed") {
        throw new PastedLocationError("Only Google Maps links can be opened.");
      }
    }
    throw new PastedLocationError(OFFLINE);
  }
}
