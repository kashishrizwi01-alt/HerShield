# HerShield route-aware update

- Live Google Routes transit routing retained. GPS origin via browser permission (localhost works).
- Route steps show actual stations when returned by Google transitDetails.
- Nearby directory uses OpenStreetMap Overpass over the selected route geometry, subject to internet availability. **Listings are not verified safe.**
- Report hazards by clicking a location on the Journey Planner map, then using Report Hazard. Reports are unverified and saved in SQLite. Only coordinate-tagged reports close to the selected route are shown.
- No fictional hazards are seeded for the new route. Existing sample database records remain visible until the database is cleared; back up your DB before clearing.
- Offline estimates are schematic, not navigable.
- Geolocation requires user permission and localhost or HTTPS.
- Google Routes API key must be set in GOOGLE_MAPS_API_KEY.
- Live places require internet access to an OpenStreetMap Overpass server and may be unavailable due to rate limits.
