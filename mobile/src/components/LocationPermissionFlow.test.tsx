import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, ReactTestRenderer } from "react-test-renderer";
import { LocationPermissionModal } from "./LocationPermissionFlow";

jest.mock("../services/locationPermissions", () => ({
  getGrantedPermissions: jest.fn(),
  requestPermissionFor: jest.fn(),
}));

async function disclosureText(): Promise<string> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LocationPermissionModal screen="disclosure" onContinue={jest.fn()} onSkip={jest.fn()} />);
  });
  return tree.root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat().join(""))
    .join(" ");
}

// Google Play's prominent disclosure: what is collected, for which feature,
// that it happens when the app is closed or not in use, and what is sent where
describe("background location disclosure", () => {
  test("says location data is collected for arrivals and store alerts, even when the app is closed or not in use", async () => {
    const text = await disclosureText();
    expect(text).toContain("Smart Mind collects location data");
    expect(text).toMatch(/arrive at your saved places/);
    expect(text).toMatch(/near stores for your shopping notes/);
    expect(text).toContain("even when the app is closed or not in use");
  });

  test("says what stays on the phone and what is sent", async () => {
    const text = await disclosureText();
    expect(text).toMatch(/coordinates stay on your phone/);
    expect(text).toMatch(/approximate position is sent to the server only to find nearby stores and to rank address search results/);
    expect(text).toMatch(/not stored/);
    // the old wording claimed only a place name ever leaves the phone
    expect(text).not.toMatch(/only the place name is sent/);
  });

  test('keeps the "Allow all the time" instruction', async () => {
    expect(await disclosureText()).toContain('choose "Allow all the time"');
  });
});
