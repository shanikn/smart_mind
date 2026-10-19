import { ApiError } from "../api/client";
import { resolveMapsLink } from "../api/places";
import { PastedLocationError, resolvePastedLocation } from "./pastedLocation";

jest.mock("../api/places", () => ({ resolveMapsLink: jest.fn() }));
const resolveLink = resolveMapsLink as jest.Mock;

beforeEach(() => resolveLink.mockReset());

test("coordinates and full links need no server", async () => {
  expect(await resolvePastedLocation("32.0812, 34.8105")).toEqual({ latitude: 32.0812, longitude: 34.8105 });
  expect(await resolvePastedLocation("https://www.google.com/maps/@32.08,34.81,15z")).toEqual({
    latitude: 32.08,
    longitude: 34.81,
  });
  expect(resolveLink).not.toHaveBeenCalled();
});

test("a short link is followed by the server", async () => {
  resolveLink.mockResolvedValue({ latitude: 32.0812, longitude: 34.8105 });
  expect(await resolvePastedLocation("https://maps.app.goo.gl/AbC123")).toEqual({ latitude: 32.0812, longitude: 34.8105 });
  expect(resolveLink).toHaveBeenCalledWith("https://maps.app.goo.gl/AbC123");
});

test("a link with only an address is looked up by the server", async () => {
  resolveLink.mockResolvedValue({ latitude: 32.0637, longitude: 34.7741 });
  const link = "https://maps.google.com/?q=Rothschild+10,+Tel+Aviv&ftid=0x151d4b:0x2ab4";
  expect(await resolvePastedLocation(link)).toEqual({ latitude: 32.0637, longitude: 34.7741 });
  expect(resolveLink).toHaveBeenCalledWith(link);
});

const errorFor = async (text: string) => {
  try {
    await resolvePastedLocation(text);
  } catch (e) {
    expect(e).toBeInstanceOf(PastedLocationError);
    return (e as Error).message;
  }
  throw new Error("expected an error");
};

test("clear messages for what can't be used", async () => {
  expect(await errorFor("95, 34")).toBe("Latitude must be between -90 and 90.");
  expect(await errorFor("Rothschild 10")).toBe(
    'Paste coordinates like "32.0812, 34.8105" or a Google Maps link.'
  );
  resolveLink.mockRejectedValueOnce(new ApiError(422, JSON.stringify({ detail: { kind: "no_coordinates" } })));
  expect(await errorFor("https://maps.app.goo.gl/x")).toBe(
    "Couldn't find this place from the link. In Google Maps, drop a pin and share that instead."
  );
  resolveLink.mockRejectedValueOnce(new ApiError(404, "Not Found"));
  expect(await errorFor("https://maps.app.goo.gl/x")).toBe(
    "Short links need the updated server. Open the link in Google Maps and copy the full link instead."
  );
  resolveLink.mockRejectedValueOnce(new ApiError(504, JSON.stringify({ detail: { kind: "network" } })));
  expect(await errorFor("https://maps.app.goo.gl/x")).toBe("Couldn't open the link. Check your connection and try again.");
  resolveLink.mockRejectedValueOnce(new TypeError("Network request failed"));
  expect(await errorFor("https://maps.app.goo.gl/x")).toBe("Couldn't open the link. Check your connection and try again.");
});
