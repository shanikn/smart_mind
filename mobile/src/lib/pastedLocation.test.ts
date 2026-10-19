import { parsePastedLocation } from "./pastedLocation";

describe("coordinates", () => {
  test.each([
    ["32.0812, 34.8105", 32.0812, 34.8105],
    ["32.0812,34.8105", 32.0812, 34.8105],
    ["  32.0812 34.8105 ", 32.0812, 34.8105],
    ["-33.8688, 151.2093", -33.8688, 151.2093],
  ])("%p", (text, latitude, longitude) => {
    expect(parsePastedLocation(text)).toEqual({ kind: "point", point: { latitude, longitude } });
  });

  test("out of range: a clear message", () => {
    expect(parsePastedLocation("95.1, 34.8")).toEqual({
      kind: "invalid",
      message: "Latitude must be between -90 and 90.",
    });
    expect(parsePastedLocation("32.1, 181")).toEqual({
      kind: "invalid",
      message: "Longitude must be between -180 and 180.",
    });
  });
});

describe("Google Maps links", () => {
  test("a place link: the pin, not the map's center", () => {
    expect(
      parsePastedLocation(
        "https://www.google.com/maps/place/Azrieli/@32.07,34.79,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d32.0745!4d34.7918"
      )
    ).toEqual({ kind: "point", point: { latitude: 32.0745, longitude: 34.7918 } });
  });

  test.each([
    "https://www.google.com/maps/@32.0812,34.8105,15z",
    "https://maps.google.com/?q=32.0812,34.8105",
    "https://www.google.com/maps/search/?api=1&query=32.0812%2C34.8105",
    "https://www.google.co.il/maps?ll=32.0812,34.8105&z=16",
  ])("%p", (link) => {
    expect(parsePastedLocation(link)).toEqual({ kind: "point", point: { latitude: 32.0812, longitude: 34.8105 } });
  });

  test("short share links go to the server to be followed", () => {
    expect(parsePastedLocation("https://maps.app.goo.gl/AbC123xyz")).toEqual({
      kind: "server",
      url: "https://maps.app.goo.gl/AbC123xyz",
    });
    expect(parsePastedLocation("Check this out https://maps.app.goo.gl/AbC123xyz")).toEqual({
      kind: "server",
      url: "https://maps.app.goo.gl/AbC123xyz",
    });
  });

  test("a link with only a place's name or address goes to the server to be looked up", () => {
    expect(parsePastedLocation("https://www.google.com/maps/place/Azrieli+Center")).toEqual({
      kind: "server",
      url: "https://www.google.com/maps/place/Azrieli+Center",
    });
    expect(parsePastedLocation("https://maps.google.com/?q=Rothschild+10,+Tel+Aviv&ftid=0x151d4b:0x2ab4")).toEqual({
      kind: "server",
      url: "https://maps.google.com/?q=Rothschild+10,+Tel+Aviv&ftid=0x151d4b:0x2ab4",
    });
  });
});

test("anything else isn't a location (an address search can take it)", () => {
  expect(parsePastedLocation("Rothschild 10, Tel Aviv")).toEqual({ kind: "none" });
  expect(parsePastedLocation("")).toEqual({ kind: "none" });
  expect(parsePastedLocation("https://example.com/32.1,34.8")).toEqual({ kind: "none" });
});
