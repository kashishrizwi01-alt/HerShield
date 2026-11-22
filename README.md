# Her Shield 5 — Kashmere Gate demonstration

## Start on Mac

Open the **Her Shield 5** folder in VS Code, then in its terminal run:

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r requirements.txt
python backend/app.py
```

Or double-click `START_HERSHIELD.command` (macOS may ask you to approve opening the script).

**Type** `http://127.0.0.1:5001/` **manually** into Safari. Do not use port 5000 (often occupied by AirPlay Receiver). Leave the server terminal open.

## Features retained and changes

- Login, personalized welcome, purple/lavender theme, navigation and appearance controls.
- HerCircle, trusted contacts, group plan editor, meetup pins and straight-line illustrative connections from preloaded sample friends to the meetup. Friends are **fictional**, not GPS-tracked people.
- Journey planner with Google Routes integration when a configured key is available; **BACKUP ROUTE ESTIMATES** works for supported Delhi landmarks without a key. Routes are not certified safe.
- SafeZone directory preloaded with recognizable Kashmere Gate-area services and national emergency numbers; other phone fields are blank until independently verified.
- Fictional sample hazards and fictional sample ratings/reviews, visibly marked. User-submitted hazards and route-specific reviews can be added and saved.
- Existing SOS interface, check-ins, notification history, route sharing, GPS opt-in, autocomplete, map tools, and contact call/SMS composer (where available).

## Google Routes API

In the **same terminal before starting** the server:

```bash
export GOOGLE_MAPS_API_KEY='YOUR_GOOGLE_ROUTES_KEY'
python backend/app.py
```

Enable Routes API and billing for the key in Google Cloud. Never share the key in screenshots or commit it to source control. A 403 `PERMISSION_DENIED` response means Google rejected the request; backup estimates are independent of Google.

## Important limits

This is a **college prototype**. Sample reports and ratings are not real claims about the places named. No actual friend tracking, automatic SOS dispatch, authenticated phone sign-in, or guaranteed emergency messaging is provided. Opening an SMS composer does not send a message. The OpenStreetMap tile layer needs internet. The local backend and demo listings do not require a Google key.

## Quick tests

After starting, check `http://127.0.0.1:5001/api/health` and `http://127.0.0.1:5001/api/bootstrap`. In the website: sign in, check the welcome, open HerCircle, click Group Plan and publish, check SafeZone Directory/Reviews/Hazards, then click BACKUP ROUTE ESTIMATES.
