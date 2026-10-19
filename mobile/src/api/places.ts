import { apiRequest } from "./client";
import { ServerPlace } from "../lib/userPlaces";

// Place names and keywords live on the backend (per user).
// Coordinates never leave the phone.

export async function listPlaces(): Promise<ServerPlace[]> {
  return apiRequest("/places/");
}

export async function createPlace(name: string, keywords: string[] = []): Promise<ServerPlace> {
  return apiRequest("/places/", {
    method: "POST",
    body: JSON.stringify({ name, keywords }),
  });
}

export async function updatePlace(
  id: string,
  fields: { name?: string; keywords?: string[] }
): Promise<ServerPlace> {
  return apiRequest(`/places/${id}`, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}

// 3 decimals is about 100 m: plenty to find stores 2 km around
const roundTo100m = (value: number) => String(Number(value.toFixed(3)));

// stores of a type around a position, nearest first (OpenStreetMap via the
// backend); the position is rounded on the phone before it's sent
export async function nearbyStores(
  type: string,
  lat: number,
  lon: number,
  radiusM: number = 2000
): Promise<{ id: string; name: string; lat: number; lon: number }[]> {
  const params = new URLSearchParams({
    lat: roundTo100m(lat),
    lon: roundTo100m(lon),
    type,
    radius_m: String(radiusM),
  });
  return apiRequest(`/places/nearby?${params.toString()}`);
}

// coordinates of a Google Maps link; the server follows short share links and
// looks up links with only a place's name or address
export async function resolveMapsLink(url: string): Promise<{ latitude: number; longitude: number }> {
  return apiRequest(`/places/resolve-link?${new URLSearchParams({ url }).toString()}`);
}

export async function deletePlace(id: string): Promise<{ message: string }> {
  return apiRequest(`/places/${id}`, { method: "DELETE" });
}
