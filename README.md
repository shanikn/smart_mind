# Smart Mind — Android & iOS

Most note-taking apps are graveyards for ideas. Smart Mind brings your notes back —
exactly when and where you need them, as a native app for Android and iPhone (iOS).

The app is built with React Native and Expo (SDK 54) in `mobile/`, backed by a FastAPI server
in `api/` that runs on Azure.

## Overview

Write a note once and it comes back at the right place and time. "Buy milk" alerts you when you
walk into a supermarket; "study for the exam" when you get to university; "call mom at 18:00" at
six. The server understands the note (kind, place, time, date) and ranks what matters now; the
phone does the location work and shows the notifications.

## Key Features

- **Four note kinds**: To-do, Errand (needs you to go somewhere), Idea (never alerts) and Event
  (appointments, meetings, exams). Inferred from the text by keyword rules, or set by hand; a date
  or time alone never decides the kind. Time and place are separate fields on the card.
- **Places**: Home/Uni/Work plus your own (Gym, Pharmacy…). Notes are tagged by place id, so
  renaming a place never breaks them. A place's location can be set from your current position, an
  address search, a pin on a map, or pasted coordinates / a Google Maps link. **Coordinates stay on
  the phone**; the server only knows place names and keywords.
- **Arrival alerts**: geofences around your places; arriving shows the top notes for that place.
  Works offline from the notes saved at the last sync.
- **Store alerts**: with open errands, the phone watches the nearest supermarkets, pharmacies/
  drugstores and post offices (from OpenStreetMap) and alerts when you stop at one ("You're at
  Shufersal – you have errands: …"). "Alert when I stop there" (2 minutes) or "Alert when passing by".
- **Exact alarms**: notes with a time get a local alarm; others surface by place and context.
- **Search**: Google Places (when the server has a key, biased toward where you are) with
  OpenStreetMap Nominatim as the fallback; Hebrew and English; looser retries for English spellings.
- **Semantic ranking**: `all-MiniLM-L6-v2` embeddings (ChromaDB), place +3 / time +2 bonuses,
  feedback (Useful / Later / Annoying) adjusts ranking.
- **Redesigned UI**: Smart Mind theme with dark mode, Recent / Upcoming views, search, folder and
  kind filters, custom kind colors.
- **Accounts**: Firebase Auth (email/password with "Forgot password?", and Google Sign-In). Account
  deletion in Settings removes all notes, places and the sign-in account.
- **Privacy and safety**: each user only ever reaches their own data (scoped queries, per-user
  vectors), no note text in server logs, per-user rate limits, no ads or trackers.

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile app (Android, iOS) | React Native (Expo SDK 54) + TypeScript |
| Location | expo-location (geofences, last-known position) |
| Notifications | expo-notifications + expo-task-manager (local, no push server) |
| Maps | Leaflet + OpenStreetMap tiles in react-native-webview (no Google key on the phone) |
| Backend | FastAPI (Python 3.11) |
| Auth | Firebase Auth (email/password, Google Sign-In) |
| Primary storage | MongoDB Atlas |
| Vector store | ChromaDB (384-dim embeddings, rebuilt from MongoDB at startup) |
| Embeddings | sentence-transformers (`all-MiniLM-L6-v2`, local) |
| Place search | Google Places API (New) Text Search, OpenStreetMap Nominatim, Overpass (stores) |
| Deployment | Docker image on Docker Hub, Azure Web App for Containers |
| Testing | pytest (282 tests), jest (522 tests) |
| Linting | flake8 (pre-commit hook), TypeScript `tsc --noEmit` |

## Running the App

The same code in `mobile/` builds for Android and iOS.

### Android prerequisites

1. Install [Android Studio](https://developer.android.com/studio) and, from its SDK Manager,
   the Android SDK and platform tools.
2. Create and start an emulator (Device Manager), or connect an Android phone with USB debugging enabled.
3. Set `ANDROID_HOME` to your Android SDK path (on Windows usually
   `%LOCALAPPDATA%\Android\Sdk`) and add `%ANDROID_HOME%\platform-tools` to your `PATH`.

### iOS prerequisites

1. For local builds (`npx expo run:ios`), a Mac with [Xcode](https://developer.apple.com/xcode/) installed.
   Use the iOS Simulator (from Xcode), or connect an iPhone and sign the app with your Apple ID in Xcode.
2. Without a Mac (e.g. on Windows), build in the cloud with [EAS Build](https://docs.expo.dev/build/introduction/):
   `eas build --platform ios` from `mobile/`. It needs an Expo account, and an Apple Developer account
   to install the build on an iPhone.
3. Put the Firebase iOS config file `GoogleService-Info.plist` in `mobile/` (from the Firebase console).

### Build and run

```bash
cd mobile
npm install
npx expo run:android   # Android
npx expo run:ios       # iOS (on a Mac)
```

This builds the native project and installs the app on the running emulator/simulator or connected
device. Rebuild with `npx expo run:android` / `npx expo run:ios` after adding a native package (a
JavaScript reload isn't enough).

### Using a local backend

By default the app uses the deployed Azure API. To use a backend running on your own machine instead:

1. In `mobile/`, create a `.env` file.
2. Set `EXPO_PUBLIC_API_BASE_URL` to your backend's address:
   - Android emulator: `http://10.0.2.2:8000` (the emulator's alias for your computer)
   - iOS Simulator: `http://localhost:8000` (the simulator shares your Mac's network)
   - Physical device: `http://YOUR_COMPUTER_LAN_IP:8000`, e.g. `http://192.168.1.100:8000`
3. Start the backend so it listens on your network:
   `uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload`
4. Rebuild/restart the app with `npx expo run:android` or `npx expo run:ios` from `mobile/`.

Notes:
- On Android and on a physical iPhone, don't use `localhost` — there it refers to the device itself.
- On a physical device, the phone and computer must be on the same Wi-Fi.
- If Windows Firewall prompts for access, allow it for private networks.
- The backend needs its own environment (see below).

## Backend

### Endpoints

All except `GET /` need `Authorization: Bearer <Firebase ID token>`.

| Endpoint | Purpose |
|---|---|
| `POST /notes/`, `GET /notes/`, `PUT /notes/{id}`, `DELETE /notes/{id}` | Notes (the list also returns `reminder_time_source` and `store_type`) |
| `GET /reminders/?location=&hour=&minute=` | Notes for the current place and time |
| `POST /notes/{id}/feedback?action=` | `useful`, `dismiss`, `later`, `annoying`, `show less`, `never show` |
| `GET/POST /places/`, `PUT/DELETE /places/{id}` | Places (names and keywords only) |
| `GET /places/search?q=&lat=&lon=` | Address search (Google Places or Nominatim) |
| `GET /places/nearby?lat=&lon=&type=&radius_m=` | Stores near the phone (`supermarket`, `pharmacy`, `post_office`) |
| `GET /places/resolve-link?url=` | Coordinates of a Google Maps share link (Google hosts only) |
| `DELETE /account` | Deletes all of the user's data and the Firebase user |

Per-user rate limits answer `429` with a message the app shows: search 30/min and 300/day, nearby
stores and links 30/min each, note create + update 60/min, account deletion 3/hour.

### Environment

Set as environment variables (Azure app settings in production, a root `.env` locally). Never
commit their values.

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string (database `contextmind`, or `MONGO_DB_NAME`) |
| `FIREBASE_CREDENTIALS_JSON` | Firebase Admin key (JSON); without it every authenticated request gets 401 |
| `GOOGLE_MAPS_API_KEY` | Optional; enables Google Places search (else Nominatim) |
| `REINGEST_ON_STARTUP` | `true` re-runs AI enrichment on all notes at startup; leave `false` (default) |
| `CORS_ORIGINS` | Optional browser origins; none by default (the app isn't a browser) |

### Tests and lint

```bash
./venv/Scripts/python.exe -m pytest tests/ -q      # uses the contextmind_test database, never the real one
./venv/Scripts/python.exe -m flake8 --max-line-length=120 --exclude=venv,mobile,chroma_db,chroma_db_test,__pycache__ .
cd mobile && npm test && npx tsc --noEmit
```

## Deploying the backend

No CI: build, push and switch the image by hand, from an up-to-date checkout of the branch you're
deploying (a clean clone keeps local files out of the image; `.dockerignore` excludes `mobile/`,
`.env*`, keys, tests and docs). Replace `vN` with the next version.

```bash
git pull
docker build -t shaniki/contextmind:vN .
docker run --rm --entrypoint sh shaniki/contextmind:vN -c "id; ls -a /app"   # uid 1000 (app), no .env or keys
docker push shaniki/contextmind:vN

az webapp config appsettings list -n contextmind-api -g contextmind-rg --query "[].name" -o tsv   # names only
az webapp sitecontainers update -n contextmind-api -g contextmind-rg --container-name main \
  --image index.docker.io/shaniki/contextmind:vN
az webapp restart -n contextmind-api -g contextmind-rg
az webapp log tail -n contextmind-api -g contextmind-rg
```

- Check that `DEV_AUTH_BYPASS` and `RATE_LIMITS` are **not** set on Azure.
- Set secrets from a file (`--settings @file.json`), not inline, and delete the file afterwards.
- Rollback: run the `sitecontainers update` command with the previous tag.
- At startup the server creates its indexes and, in the background, embeds any notes ChromaDB is
  missing (it isn't persisted on Azure).

## Privacy policy and account deletion pages

`docs/` is published with GitHub Pages (branch `main`, folder `/docs`), so changes go live when they reach `main`:

- Privacy policy: https://shanikn.github.io/smart_mind/privacy-policy.html
- Delete your account: https://shanikn.github.io/smart_mind/delete-account.html
- Support: https://shanikn.github.io/smart_mind/support.html

Keep them in step with the app when what it collects or sends changes.
