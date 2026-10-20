# Smart Mind – App Store listing

Bundle id: `com.shanini.smartmind` · iPhone only · Support URL: https://shanikn.github.io/smart_mind/support.html · Privacy policy URL: https://shanikn.github.io/smart_mind/privacy-policy.html

## Subtitle (max 30)

Reminders by place and time

## Promotional text (max 170)

Write a note once. Smart Mind reminds you when you get home, reach work or pass a pharmacy, so the right note shows up at the right moment.

## Description

Smart Mind is a note app that reminds you at the right place and time.

Write a note the way you'd say it: "buy milk when I get home", "call the dentist at 6pm", "print the slides at uni". Smart Mind sorts it into a to-do, errand, idea or event and picks up the place and time from your words. You can always change them by hand.

ARRIVE, AND THE NOTE IS THERE
Save your places (Home, Uni and Work are ready, add the gym or anywhere else) by searching an address, picking a point on the map, pasting a Google Maps link or using where you are now. When you arrive, Smart Mind shows the notes for that place, even when the app is closed.

ERRANDS NEAR YOU
Have an open errand for the supermarket, pharmacy or post office? Smart Mind can alert you when you stop at one nearby, or as you pass by. You choose.

ON TIME
Notes with a time get a reminder right then, on the day you set. Ideas never alert you; they just wait in your list.

FIND ANYTHING
Search your notes, filter by kind or place, sort them into folders, and switch between recent and upcoming notes. Pick your own colors for each kind, and use light or dark mode.

PRIVATE BY DESIGN
Your places' locations stay on your phone. Arrival alerts are worked out on the phone, and your location history is never uploaded. No ads, no tracking.

Sign in with Apple, Google or email. You can delete your account and all your notes from Settings at any time.

## Keywords (max 100, no spaces)

reminder,notes,todo,location,errand,grocery,list,places,arrive,alarm,planner,memo,task,geofence,home

## App Privacy answers

Tracking: **No** data is used for tracking. No ads, analytics or crash-reporting SDKs.

| Data type (Apple category) | Collected | Linked to the user | Tracking | Purpose | Where in the code |
|---|---|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | No | App Functionality (account) | Firebase Auth (email/password, Google, Apple; Apple may give a private relay address) |
| Contact Info → Name | Yes | Yes | No | App Functionality (account) | Firebase Auth keeps the name Google or Apple shares; our server never reads it |
| User Content → Other User Content | Yes | Yes | No | App Functionality | Note text, kind, place, time, folder; stored in MongoDB with an embedding |
| Identifiers → User ID | Yes | Yes | No | App Functionality | Firebase uid on every API request; keys all notes and places |
| Location → Coarse Location | Yes | No | No | App Functionality | Position rounded to ~100 m (`/places/nearby`) or ~1 km (`/places/search`); not stored, cached in server memory by area only, without a user id |
| Location → Precise Location | No | – | – | – | Places' coordinates, address and radius are stored only on the phone (`lib/userPlaces.ts`); the server's `Place` has name and keywords only. A point picked on the map is sent once to look up its address, then not stored or tied to the user |
| Search History | No | – | – | – | Address searches are answered and cached briefly by query text, not stored or tied to the user |
| Usage Data, Diagnostics, Contacts, Health, Financial, Browsing History, Purchases, Sensitive Info | No | – | – | – | – |

Notes for the form:
- Place names and keywords (Home, Gym…) are stored on the server; they fall under User Content above.
- Map tiles load from OpenStreetMap and the map library from unpkg.com inside a web view; they see the IP address like any website. Apple doesn't count that as collection by the app if those parties don't receive data linked to the user.

## Notes for the reviewer

**Sign-in.** Tap **Sign in with Apple**, or use this test account: email `<TODO>`, password `<TODO>`. Google sign-in also works. Notes are tied to the account, so the test account already has a few notes and places.

**Why background location.** Smart Mind's main feature is reminding you about notes when you arrive at a saved place (Home, Work…) or reach a store for an open errand. It uses iOS region monitoring (geofences) for the saved places and for up to 12 nearby stores, which needs "Always" location so it works when the app is closed. It does not track your route; the app is only woken when you enter or leave one of those areas. Precise coordinates stay on the phone. Location is optional: without it, notes still work and time reminders still fire.

**How to see an arrival alert.**
1. Sign in, open **Settings**, tap **Turn on automatic location**, and allow location **Always** and notifications.
2. Under Places, open **Home** and set its location with **Use current location**.
3. Add a note on the Notes tab: "buy milk when I get home". The app tags it with Home.
4. Walk at least ~200 m away (or, in the Simulator, set a custom location far away), wait a minute, then come back (or set the location back). On entering Home you get a "Smart Mind reminder" notification with the note.
Quicker check: in Settings, set "Where you are now" to Home and tap **Check alerts now**; the Home note shows as an alert.

**Account deletion.** Settings → Delete account → type DELETE. Apple accounts are asked to confirm with Apple once more, so the app can revoke its Apple token.

## Screenshots (6.9" and 6.5" iPhone)

1. **Notes list** – My Notes with a mix of kinds (to-do, errand, idea, event), colored chips, place and time on each card, a folder row at the top.
2. **Note details** – the saved note "buy milk when I get home" open, with the Kind and Place cards showing what Smart picked (Errand, Home) and the time.
3. **Arrival alert** – lock screen with the "Smart Mind reminder" notification showing "buy milk when I get home".
4. **Places in Settings** – Home, Uni, Work and Gym with their addresses and radius; "Where you are now" set to Home.
5. **Pick on map** – the map picker with a pin on a place and its address filled in.
