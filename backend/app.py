"""
HerShield Flask Backend
- SQLite database for demo app data
- Google Routes API integration for public-transit routes
- Route-specific community reviews
- Friends, guardians, safe zones, hazards and journey links

Important:
This application does not verify that a route is safe, track live GPS,
dispatch SOS alerts, or contact emergency services.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
import urllib.request
import urllib.error
import ssl
import certifi
import math

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import urllib.parse

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS


# ============================================================
# CONFIGURATION
# ============================================================

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

DATABASE = Path(
    os.environ.get("HERSHIELD_DB", ROOT / "hershield.db")
)

GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()

GOOGLE_ROUTES_URL = (
    "https://routes.googleapis.com/directions/v2:computeRoutes"
)

app = Flask(
    __name__,
    static_folder=str(FRONTEND),
    static_url_path=""
)

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://127.0.0.1:5500",
                "http://localhost:5500",
                "http://127.0.0.1:5000",
                "http://localhost:5000"
            ]
        }
    }
)


# ============================================================
# DATABASE HELPERS
# ============================================================

def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def db_connection():
    connection = get_db()

    try:
        yield connection
        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def rows_as_dicts(cursor: sqlite3.Cursor) -> list[dict]:
    return [dict(row) for row in cursor.fetchall()]


def json_body() -> dict:
    return request.get_json(silent=True) or {}


def error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def normalize_location(value: str) -> str:
    return " ".join(str(value or "").strip().lower().split())


# ============================================================
# DATABASE INITIALIZATION AND MIGRATIONS
# ============================================================

def add_column_if_missing(
    db: sqlite3.Connection,
    table: str,
    column: str,
    definition: str
):
    columns = {
        row["name"]
        for row in db.execute(f"PRAGMA table_info({table})").fetchall()
    }

    if column not in columns:
        db.execute(
            f"ALTER TABLE {table} ADD COLUMN {column} {definition}"
        )


def init_db():

    with db_connection() as db:

        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS friends (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                eta TEXT NOT NULL DEFAULT 'Offline',
                battery INTEGER NOT NULL DEFAULT 100,
                status TEXT NOT NULL DEFAULT 'safe',
                is_sharing INTEGER NOT NULL DEFAULT 0,
                avatar TEXT NOT NULL DEFAULT '',
                map_x REAL NOT NULL DEFAULT 50,
                map_y REAL NOT NULL DEFAULT 50
            );

            CREATE TABLE IF NOT EXISTS transit_stages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mode TEXT NOT NULL,
                detail TEXT NOT NULL,
                badge TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS guardians (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS safe_zones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                info TEXT NOT NULL,
                phone TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                score TEXT NOT NULL DEFAULT 'Community review',
                tags TEXT NOT NULL DEFAULT 'Community submitted',
                comment TEXT NOT NULL,
                created_at TEXT NOT NULL,
                origin TEXT NOT NULL DEFAULT '',
                destination TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS hazards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                location TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Community report',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS group_plan (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                title TEXT NOT NULL,
                target TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS checkins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS journey_links (
                token TEXT PRIMARY KEY,
                origin TEXT NOT NULL,
                destination TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )

        # Migrate databases created by the older HerShield version.
        add_column_if_missing(db, "reviews", "origin", "TEXT NOT NULL DEFAULT ''")
        add_column_if_missing(db, "reviews", "destination", "TEXT NOT NULL DEFAULT ''")
        add_column_if_missing(db, "hazards", "lat", "REAL")
        add_column_if_missing(db, "hazards", "lng", "REAL")
        add_column_if_missing(db, "friends", "phone", "TEXT NOT NULL DEFAULT ''")

        # Explicitly fictional, opt-in demo group; never described as real GPS.
        if db.execute("SELECT COUNT(*) FROM friends").fetchone()[0] == 0:
            db.executemany("""INSERT INTO friends (id,name,eta,battery,status,is_sharing,avatar,map_x,map_y) VALUES (?,?,?,?,?,?,?,?,?)""", [
                ('demo-maya','Maya Sen','Sample location',84,'safe',1,'',32,26),
                ('demo-riya','Riya Sharma','Sample location',76,'safe',1,'',56,45),
                ('demo-ananya','Ananya Gupta','Sample location',91,'safe',1,'',75,65),
            ])

        # No invented real guardian phone numbers. User can add contacts.

        # Kashmere Gate starter directory: place names for presentation only.
        if db.execute("SELECT COUNT(*) FROM safe_zones").fetchone()[0] == 0:
            db.executemany("INSERT INTO safe_zones (type,name,info,phone) VALUES (?,?,?,?)", [
                ('POLICE STATION','Kashmere Gate Police Station','Kashmere Gate, Delhi • demo directory entry; verify details',''),
                ('HOSPITAL','Hindu Rao Hospital','Civil Lines / Malka Ganj, Delhi • verify emergency services',''),
                ('HOSPITAL','St. Stephen’s Hospital','Tis Hazari, Delhi • verify emergency services',''),
                ('FIRE SERVICE','Delhi Fire Service','Delhi • emergency number 101','101'),
                ('EMERGENCY','India Emergency Response','National emergency number 112','112'),
                ('TRANSIT HUB','Kashmere Gate ISBT','Public transit hub • not a certified safe zone',''),
            ])
        if db.execute("SELECT COUNT(*) FROM reviews").fetchone()[0] == 0:
            db.executemany("""INSERT INTO reviews (name,category,score,tags,comment,created_at,origin,destination)
                VALUES (?,?,?,?,?,?,?,?)""", [
                ('Girls PG near Kashmere Gate','PGs & Hostels','Sample 4.2 ★','FICTIONAL SAMPLE RATING','Illustrative accommodation review. No property or safety rating has been verified.',now_iso(),'',''),
                ('Cafe near Kashmere Gate Metro','Cafes & Night Spots','Sample 4.4 ★','FICTIONAL SAMPLE RATING','Illustrative review for the presentation, not a real customer report.',now_iso(),'',''),
                ('Budget hotel near ISBT','Hotels','Sample 3.9 ★','FICTIONAL SAMPLE RATING','Example listing only; check current availability and safety independently.',now_iso(),'',''),
            ])
        if db.execute("SELECT COUNT(*) FROM hazards").fetchone()[0] == 0:
            db.executemany("""INSERT INTO hazards (type,location,description,status,created_at,lat,lng)
                VALUES (?,?,?,?,?,?,?)""", [
                ('STREETLIGHT ISSUE','Kashmere Gate Metro Gate area','FICTIONAL scenario: poorly lit stretch in a sample user report.','Fictional demo report — not verified',now_iso(),28.6675,77.2280),
                ('CROWDED CROSSING','Kashmere Gate ISBT vicinity','FICTIONAL scenario: heavy pedestrian crowding at peak time.','Fictional demo report — not verified',now_iso(),28.6670,77.2300),
                ('ISOLATED LANE','Civil Lines approach road','FICTIONAL scenario: low footfall in a side lane after dark.','Fictional demo report — not verified',now_iso(),28.6760,77.2230),
            ])

        db.execute(
            """
            INSERT OR IGNORE INTO group_plan (id, title, target)
            VALUES (1, ?, ?)
            """,
            (
                "Kashmere Gate Friends Meetup",
                "Kashmere Gate Metro Station • 05:30 PM"
            )
        )



# Public OpenStreetMap geocoding; throttle in the browser and respect provider limits.
@app.get('/api/location-suggest')
def location_suggest():
    query = str(request.args.get('q', '')).strip()[:140]
    if len(query) < 3:
        return jsonify({'suggestions': []})
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({
        'q': query, 'format': 'jsonv2', 'limit': 5, 'addressdetails': 0, 'countrycodes': 'in'
    })
    req = urllib.request.Request(url, headers={'User-Agent':'HerShield3-CollegeProject/1.0 (educational location search)'})
    try:
        with urllib.request.urlopen(req, timeout=8, context=ssl.create_default_context(cafile=certifi.where())) as response:
            rows = json.load(response)
        return jsonify({'suggestions': [{'name':r.get('display_name',''), 'lat':float(r['lat']), 'lng':float(r['lon'])} for r in rows[:5]]})
    except Exception as exc:
        app.logger.warning('Geocoding unavailable: %s', exc)
        return jsonify({'suggestions': [], 'message':'Location suggestions are temporarily unavailable.'})

# ============================================================
# GOOGLE ROUTES API HELPERS
# ============================================================

def calculate_transit_routes(origin: str, destination: str) -> dict:
    """
    Calls Google Routes API in TRANSIT mode.
    The API key remains on the backend.
    """

    if not GOOGLE_MAPS_API_KEY:
        raise RuntimeError(
            "Google Routes API key is missing. Configure GOOGLE_MAPS_API_KEY in the backend environment."
        )

    payload = {
        "origin": ({"location": {"latLng": origin}} if isinstance(origin, dict) else {"address": origin}),
        "destination": {"address": destination},
        "travelMode": "TRANSIT",
        "computeAlternativeRoutes": True,
        "languageCode": "en",
        "units": "METRIC"
    }

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": (
            "routes.duration,"
            "routes.distanceMeters,"
            "routes.polyline.encodedPolyline,"
            "routes.legs.steps.travelMode,"
            "routes.legs.steps.distanceMeters,"
            "routes.legs.steps.staticDuration,"
            "routes.legs.steps.navigationInstruction.instructions,"
            "routes.legs.steps.transitDetails,"
            "routes.legs.steps.polyline.encodedPolyline"
        )
    }

    request_data = json.dumps(payload).encode("utf-8")

    api_request = urllib.request.Request(
        GOOGLE_ROUTES_URL,
        data=request_data,
        headers=headers,
        method="POST"
    )

    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())

        with urllib.request.urlopen(
        api_request,
        timeout=25,
        context=ssl_context
    ) as response:
            response_data = json.loads(
            response.read().decode("utf-8")
        )

    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")

        app.logger.error(
            "Google Routes API HTTP Error %s: %s",
            exc.code,
            error_body
        )

        try:
            google_error = json.loads(error_body)
            message = google_error.get("error", {}).get(
                "message",
                "Google Routes API request failed."
            )
        except json.JSONDecodeError:
            message = "Google Routes API request failed."

        raise RuntimeError(
            f"Google Routes API error ({exc.code}): {message}"
        )

    except urllib.error.URLError as exc:
        app.logger.exception(
            "Google Routes API connection failed"
        )
        raise RuntimeError(
            f"Could not connect to Google Routes API: {exc.reason}"
        )

    except (json.JSONDecodeError, UnicodeDecodeError):
        app.logger.exception(
            "Invalid response received from Google Routes API"
        )
        raise RuntimeError(
            "Google Routes API returned an invalid response."
        )

    routes = response_data.get("routes", [])

    converted_routes = [
        convert_google_route(route)
        for route in routes
    ]

    return {
        "routes": converted_routes,
        "message": (
            "Transit routes found."
            if converted_routes
            else "No public-transit route was found for these locations."
        )
    }



# Routes API response conversion: preserve the contract expected by app.js.
def convert_google_route(route: dict) -> dict:
    def duration(value):
        try:
            seconds = int(float(str(value or '0s').removesuffix('s')))
            return f"{max(1, round(seconds / 60))} min"
        except (TypeError, ValueError):
            return 'Duration unavailable'

    steps = []
    for leg in route.get('legs', []):
        for step in leg.get('steps', []):
            transit = step.get('transitDetails') or {}
            line = transit.get('transitLine') or {}
            vehicle = line.get('vehicle') or {}
            mode = step.get('travelMode', 'WALK')
            if mode == 'TRANSIT':
                label = vehicle.get('type', 'TRANSIT').replace('_', ' ').title()
                name = line.get('nameShort') or line.get('name') or label
                stops = transit.get('stopDetails') or {}
                departure = (stops.get('departureStop') or {}).get('name', '')
                arrival = (stops.get('arrivalStop') or {}).get('name', '')
                detail = ' → '.join(filter(None, (departure, arrival))) or name
                badge = name
            else:
                label = 'Walk' if mode == 'WALK' else mode.title()
                detail = (step.get('navigationInstruction') or {}).get('instructions', 'Follow walking directions')
                badge = 'Walking'
            steps.append({'mode': label, 'travelMode': mode, 'detail': detail,
                          'badge': badge, 'distance': f"{round(step.get('distanceMeters', 0))} m",
                          'duration': duration(step.get('staticDuration')),
                          'encodedPolyline': (step.get('polyline') or {}).get('encodedPolyline', '')})
    return {'duration': duration(route.get('duration')),
            'distance': f"{route.get('distanceMeters', 0) / 1000:.1f} km",
            'encodedPolyline': (route.get('polyline') or {}).get('encodedPolyline', ''),
            'steps': steps, 'demo': False}


def encode_polyline(points):
    output = []
    last_lat = last_lng = 0
    for lat, lng in points:
        lat, lng = round(lat * 1e5), round(lng * 1e5)
        for delta in (lat - last_lat, lng - last_lng):
            number = ~(delta << 1) if delta < 0 else delta << 1
            while number >= 0x20:
                output.append(chr((0x20 | (number & 0x1f)) + 63))
                number >>= 5
            output.append(chr(number + 63))
        last_lat, last_lng = lat, lng
    return ''.join(output)


# A schematic sample, NOT live Google routing or a verified transit itinerary.
DEMO_POINTS = [(28.6675, 77.2273), (28.6637, 77.2262),
               (28.6563, 77.2237), (28.6491, 77.2213)]
DEMO_HAZARDS = [
    {'type': 'DEMO: Poor lighting', 'location': 'Sample point near Kashmere Gate',
     'description': 'Fictional training example, not a reported incident.',
     'lat': 28.6637, 'lng': 77.2263, 'status': 'FICTIONAL DEMO DATA'},
    {'type': 'DEMO: Crowded crossing', 'location': 'Sample crossing',
     'description': 'Fictional training example, not a reported incident.',
     'lat': 28.6492, 'lng': 77.2214, 'status': 'FICTIONAL DEMO DATA'}]


def nearby_demo_hazards(points, threshold_m=180):
    import math
    def distance_to_segment(p, a, z):
        # Local equirectangular projection in metres; appropriate for short Delhi segments.
        scale_x = 111320 * math.cos(math.radians(p[0]))
        ax, ay = (a[1]-p[1])*scale_x, (a[0]-p[0])*111320
        bx, by = (z[1]-p[1])*scale_x, (z[0]-p[0])*111320
        dx, dy = bx-ax, by-ay
        t = max(0, min(1, -(ax*dx+ay*dy)/(dx*dx+dy*dy))) if dx*dx+dy*dy else 0
        return math.hypot(ax+t*dx, ay+t*dy)
    return [hazard for hazard in DEMO_HAZARDS if any(
        distance_to_segment((hazard['lat'], hazard['lng']), a, z) <= threshold_m
        for a, z in zip(points, points[1:]))]


# Offline journey estimates are illustrative, not transit schedules or navigable roads.
OFFLINE_PLACES = {
    'kashmere gate': (28.6675,77.2273), 'civil lines': (28.6764,77.2250),
    'vidhan sabha': (28.6878,77.2217), 'chandni chowk': (28.6578,77.2301),
    'new delhi railway station': (28.6428,77.2197), 'new delhi metro': (28.6431,77.2210),
    'rajiv chowk': (28.6328,77.2197), 'connaught place': (28.6315,77.2167),
    'delhi gate': (28.6258,77.2406), 'red fort': (28.6562,77.2410),
    'ito': (28.6272,77.2411), 'karol bagh': (28.6440,77.1885),
    'patel chowk': (28.6234,77.2142), 'central secretariat': (28.6155,77.2110),
    'aiims': (28.5672,77.2077), 'green park': (28.5595,77.2067),
    'hauz khas': (28.5433,77.2067), 'south extension': (28.5685,77.2194),
    'ina': (28.5743,77.2094), 'lajpat nagar': (28.5708,77.2365),
    'saket': (28.5206,77.2012), 'qutub minar': (28.5130,77.1866),
    'dwarka sector 21': (28.5524,77.0582), 'noida sector 18': (28.5708,77.3261),
    'botanical garden': (28.5640,77.3343), 'igdtuw': (28.6653,77.2326),
    'indira gandhi delhi technical university for women': (28.6653,77.2326),
}

def offline_point(name):
    value = normalize_location(name).replace('metro station','').replace('metro','').strip()
    for key in sorted(OFFLINE_PLACES, key=len, reverse=True):
        if key in value or value in key and len(value) >= 4:
            return OFFLINE_PLACES[key]
    return None

def distance_km(a,b):
    import math
    x=math.radians(b[1]-a[1])*math.cos(math.radians((a[0]+b[0])/2))
    y=math.radians(b[0]-a[0])
    return 6371*math.hypot(x,y)

def offline_options(origin, destination):
    a,b=offline_point(origin),offline_point(destination)
    if not a or not b:
        return error('Offline estimates support selected Delhi landmarks only. Try Kashmere Gate, Civil Lines, Rajiv Chowk, AIIMS, or Hauz Khas.',422)
    d=distance_km(a,b)
    if d<0.12:
        return error('These locations are too close to distinguish on the offline map.',422)
    import math
    # Map lines are schematic straight connectors, NOT streets or railway tracks.
    mid=((a[0]+b[0])/2 + 0.0015,(a[1]+b[1])/2 - 0.0015)
    def stage(mode,detail,km,mins):
        return {'mode':mode,'travelMode':'TRANSIT' if mode in ('Metro','Bus') else 'WALK',
                'detail':detail,'distance':f'{km:.1f} km','duration':f'{mins} min','badge':'Estimate'}
    def route(label,steps,points):
        return {'label':label,'duration':str(sum(int(st['duration'].split()[0]) for st in steps))+' min',
                'distance':f'{d:.1f} km straight-line', 'steps':steps,
                'encodedPolyline':encode_polyline(points),'demo':True,'schematic':True}
    walk=math.ceil(d*1000/75)
    options=[]
    if d<=2.5:
        options.append(route('Walking', [stage('Walk','Walk towards your destination (estimated)',d,walk)], [a,b]))
        options.append(route('Auto-rickshaw estimate',[stage('Auto-rickshaw','Road availability and fare not verified',d,math.ceil(d*5+5))],[a,mid,b]))
    else:
        options.append(route('Metro combination',[
            stage('Walk','Reach a suitable metro station; station not verified',.4,6),
            stage('Metro','Illustrative metro leg; check actual lines and stops',max(.1,d-.8),math.ceil(d*2.8+5)),
            stage('Walk','Walk from transit to destination',.4,6)],[a,mid,b]))
        options.append(route('Bus combination',[
            stage('Walk','Reach a bus stop; stop not verified',.3,5),
            stage('Bus','Illustrative bus leg; check actual service',max(.1,d-.6),math.ceil(d*4.2+6)),
            stage('Walk','Walk to destination',.3,5)],[a,b]))
        options.append(route('Auto + metro',[
            stage('Auto-rickshaw','Estimated first-mile connection',.7,7),
            stage('Metro','Illustrative metro leg; check actual stations',max(.1,d-1.1),math.ceil(d*2.6+5)),
            stage('Walk','Estimated last-mile walk',.4,6)],[a,mid,b]))
    return jsonify({'origin':origin,'destination':destination,'routes':options,'demo':True,
        'hazards':[], 'message':'Offline illustrative estimates. Straight lines are not navigable routes; no live schedules or hazard reports.'})

@app.post('/api/offline-route')
def offline_route():
    data=json_body()
    origin=str(data.get('origin','')).strip()
    destination=str(data.get('destination','')).strip()
    if not origin or not destination or normalize_location(origin)==normalize_location(destination):
        return error('Enter two different locations.')
    return offline_options(origin,destination)

@app.post('/api/demo-route')
def demo_route():
    data = json_body()
    origin = str(data.get('origin', 'Kashmere Gate, Delhi')).strip()
    destination = str(data.get('destination', 'Civil Lines, Delhi')).strip()
    if not origin or not destination or normalize_location(origin) == normalize_location(destination):
        return error('Enter two different locations.')
    # Only a fixed demonstration corridor is available; typed locations are labels, not geocoded.
    if not ('kashmere' in origin.lower() and 'civil lines' in destination.lower()):
        return error('Demo mode supports Kashmere Gate → Civil Lines only. Choose Live Route for other journeys.')
    route = {'duration': 'Demo only', 'distance': 'Schematic route',
             'encodedPolyline': encode_polyline(DEMO_POINTS), 'demo': True,
             'steps': [
                 {'mode':'Walk', 'travelMode':'WALK', 'detail':'Illustrative walk to transit stop', 'badge':'DEMO'},
                 {'mode':'Metro', 'travelMode':'TRANSIT', 'detail':'Illustrative metro segment — not a verified service', 'badge':'DEMO'},
                 {'mode':'Walk', 'travelMode':'WALK', 'detail':'Illustrative walk to destination', 'badge':'DEMO'}]}
    return jsonify({'origin':origin,'destination':destination,'routes':[route],
                    'provider':'Illustrative offline demo', 'demo':True,
                    'hazards':nearby_demo_hazards(DEMO_POINTS),
                    'message':'Schematic demonstration only. Do not use for navigation.'})

# ============================================================
# FRONTEND AND HEALTH
# ============================================================


# Nearby places: OpenStreetMap Overpass, only when a real route has geometry.
# This is a directory, not a certification of safety or opening hours.
def decode_route_points(encoded):
    points = []
    index = lat = lng = 0
    while index < len(encoded):
        values = []
        for _ in range(2):
            result = shift = 0
            while index < len(encoded):
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 31) << shift
                shift += 5
                if byte < 32:
                    break
            values.append(~(result >> 1) if result & 1 else result >> 1)
        lat += values[0]
        lng += values[1]
        points.append((lat / 1e5, lng / 1e5))
    return points


def distance_m(a, b):
    la1, lo1 = map(math.radians, a)
    la2, lo2 = map(math.radians, b)
    v = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(v)))


def route_nearby_hazards(points, threshold=350):
    if not points:
        return []
    with db_connection() as db:
        records = rows_as_dicts(db.execute("SELECT id,type,location,description,status,lat,lng FROM hazards WHERE lat IS NOT NULL AND lng IS NOT NULL ORDER BY id DESC"))
    return [h for h in records if min(distance_m((h['lat'],h['lng']), p) for p in points) <= threshold]


@app.post('/api/route-places')
def route_places():
    data = json_body()
    encoded = str(data.get('encodedPolyline', ''))
    points = decode_route_points(encoded) if encoded else []
    if len(points) < 2:
        return jsonify({'places': [], 'message': 'Choose a route to find nearby places.'})
    # Search OpenStreetMap around points along the route. Avoid treating these as safety ratings.
    sampled = [points[round(i*(len(points)-1)/min(7,len(points)-1))] for i in range(min(7,len(points)-1)+1)]
    clauses = []
    for lat,lng in sampled:
        clauses.append(f'nwr(around:700,{lat:.6f},{lng:.6f})[amenity~"^(hospital|clinic|police|pharmacy|restaurant|cafe)$"];')
    query = '[out:json][timeout:20];(' + ''.join(clauses) + ');out center 120;'
    endpoints = ('https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter')
    last_error = None
    for endpoint in endpoints:
        try:
            req = urllib.request.Request(endpoint, data=query.encode(), headers={'User-Agent':'HerShield/4.0 (local route nearby places)','Content-Type':'application/x-www-form-urlencoded'}, method='POST')
            with urllib.request.urlopen(req, timeout=9, context=ssl.create_default_context(cafile=certifi.where())) as response:
                osm = json.load(response)
            seen = set()
            results = []
            for element in osm.get('elements', []):
                tags = element.get('tags', {})
                name = tags.get('name') or tags.get('name:en')
                identifier = (element.get('type'),element.get('id'))
                if not name or identifier in seen: continue
                seen.add(identifier)
                center = element.get('center') or element
                lat,lng = center.get('lat'),center.get('lon')
                if lat is None or lng is None: continue
                proximity = min(distance_m((lat,lng),p) for p in sampled)
                if proximity > 1100: continue
                results.append({'name':name,'type':tags.get('amenity','place').title(),'lat':lat,'lng':lng,'distanceMeters':round(proximity),'phone':tags.get('phone') or tags.get('contact:phone') or '', 'source':'OpenStreetMap'})
            results.sort(key=lambda x:x['distanceMeters'])
            return jsonify({'places':results[:40], 'message':'Nearby OpenStreetMap listings; availability and safety are not independently verified.'})
        except Exception as exc:
            last_error = exc
            app.logger.warning('Nearby place provider unavailable (%s): %s',endpoint,exc)
    return jsonify({'places':[], 'message':'Nearby place providers are currently unavailable. Try again later; journey planning still works.'})


@app.get('/api/community-hazards')
def community_hazards():
    with db_connection() as db:
        hazards = rows_as_dicts(db.execute('SELECT id,type,location,description,status,lat,lng,created_at FROM hazards ORDER BY id DESC LIMIT 100'))
    return jsonify({'hazards':hazards})

@app.get('/api/route-hazards')
def get_route_hazards():
    encoded = request.args.get('polyline','')
    points = decode_route_points(encoded) if encoded else []
    return jsonify({'hazards':route_nearby_hazards(points)})

@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/api/health")
def health():

    return jsonify({
        "status": "ok",
        "service": "HerShield API",
        "database": "SQLite",
        "route_provider": "Google Routes API",
        "route_api_key_configured": bool(GOOGLE_MAPS_API_KEY)
    })


# ============================================================
# BOOTSTRAP
# ============================================================

@app.get("/api/bootstrap")
def bootstrap():

    with db_connection() as db:

        friends = rows_as_dicts(
            db.execute("SELECT * FROM friends ORDER BY rowid")
        )

        for friend in friends:

            friend["isSharing"] = bool(
                friend.pop("is_sharing")
            )

            friend["mapX"] = friend.pop("map_x")
            friend["mapY"] = friend.pop("map_y")

        guardians = rows_as_dicts(
            db.execute(
                "SELECT id, name, phone FROM guardians ORDER BY id"
            )
        )

        safe_zones = rows_as_dicts(
            db.execute(
                "SELECT type, name, info, phone FROM safe_zones ORDER BY id"
            )
        )

        hazards = rows_as_dicts(
            db.execute(
                """
                SELECT
                    type,
                    location AS loc,
                    description AS desc,
                    status
                FROM hazards
                ORDER BY id DESC
                """
            )
        )

        sample_reviews = rows_as_dicts(db.execute("SELECT name,category AS cat,score,tags,comment FROM reviews WHERE origin = '' AND destination = '' ORDER BY id"))

        plan_row = db.execute(
            "SELECT title, target FROM group_plan WHERE id = 1"
        ).fetchone()

        plan = dict(plan_row) if plan_row else {
            "title": "Group Plan",
            "target": "Not specified"
        }

    return jsonify({
        "friends": friends,
        "transitStages": [],
        "guardians": guardians,
        "safeZoneLocations": safe_zones,
        "safeStayList": sample_reviews,
        "sampleReviews": sample_reviews,
        "hazardReportsList": hazards,
        "groupPlan": plan
    })


# ============================================================
# JOURNEY PLANNER - REAL TRANSIT ROUTE ENDPOINT
# ============================================================

@app.post("/api/route")
def get_route():

    data = json_body()

    origin_input = data.get("origin", "")
    origin = origin_input if isinstance(origin_input, dict) else str(origin_input).strip()
    destination = str(data.get("destination", "")).strip()

    if not origin or not destination:
        return error("Both origin and destination are required.")

    if isinstance(origin, dict):
        try:
            origin = {'latitude':float(origin['latitude']),'longitude':float(origin['longitude'])}
            if not (-90 <= origin['latitude'] <= 90 and -180 <= origin['longitude'] <= 180):
                return error('Invalid GPS coordinates.')
        except (ValueError, KeyError, TypeError):
            return error('Invalid GPS coordinates.')
    if normalize_location(origin) == normalize_location(destination):
        return error("Origin and destination must be different.")

    try:

        result = calculate_transit_routes(origin, destination)

        return jsonify({
            "origin": origin,
            "destination": destination,
            "routes": result["routes"],
            "message": result["message"],
            "provider": "Google Routes API",
            "hazards": route_nearby_hazards(decode_route_points(result["routes"][0].get("encodedPolyline", ""))) if result["routes"] else [],
            "safetyNotice": (
                "Route information is not a safety certification. "
                "Check current transit services and local conditions."
            )
        })

    except RuntimeError as exc:

        return error(str(exc), 502)

    except Exception as exc:

        app.logger.exception("Unexpected route calculation error")

        return error(
            "An unexpected error occurred while calculating the route.",
            500
        )


# ============================================================
# FRIENDS
# ============================================================

@app.post("/api/friends")
def add_friend():

    data = json_body()

    name = str(data.get("name", "")).strip()

    if not name:
        return error("Friend name is required.")

    friend_id = f"f-{uuid.uuid4().hex[:10]}"

    avatar = str(data.get("avatar", ""))

    with db_connection() as db:

        db.execute(
            """
            INSERT INTO friends
            (id, name, eta, battery, status, is_sharing, avatar, map_x, map_y)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                friend_id,
                name,
                "3m away",
                90,
                "safe",
                1,
                avatar,
                25,
                45
            )
        )

    phone = str(data.get('phone','')).strip()[:24]
    if phone:
        with db_connection() as db:
            db.execute('UPDATE friends SET phone=? WHERE id=?',(phone,friend_id))
    return jsonify({
        "id": friend_id,
        "name": name
    }), 201


@app.patch("/api/friends/<friend_id>/sharing")
def update_friend_sharing(friend_id: str):

    data = json_body()

    sharing = bool(data.get("isSharing"))

    with db_connection() as db:

        result = db.execute(
            """
            UPDATE friends
            SET is_sharing = ?, status = ?
            WHERE id = ?
            """,
            (
                int(sharing),
                "safe" if sharing else "offline",
                friend_id
            )
        )

        if result.rowcount == 0:
            return error("Friend not found.", 404)

    return jsonify({
        "id": friend_id,
        "isSharing": sharing
    })


# ============================================================
# TRANSIT STAGES
# ============================================================

@app.post("/api/transit-stages")
def add_transit_stage():

    data = json_body()

    mode = str(data.get("mode", "")).strip()

    if not mode:
        return error("Transit mode is required.")

    detail = str(
        data.get("detail", "Community-added stage")
    ).strip()

    with db_connection() as db:

        cursor = db.execute(
            """
            INSERT INTO transit_stages (mode, detail, badge)
            VALUES (?, ?, ?)
            """,
            (mode, detail, "Added")
        )

        stage_id = cursor.lastrowid

    return jsonify({
        "id": stage_id,
        "mode": mode,
        "detail": detail,
        "badge": "Added"
    }), 201


# ============================================================
# GUARDIANS
# ============================================================

@app.post("/api/guardians")
def add_guardian():

    data = json_body()

    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()

    if not name or not phone:
        return error("Guardian name and phone are required.")

    with db_connection() as db:

        cursor = db.execute(
            """
            INSERT INTO guardians (name, phone)
            VALUES (?, ?)
            """,
            (name, phone)
        )

        guardian_id = cursor.lastrowid

    return jsonify({
        "id": guardian_id,
        "name": name,
        "phone": phone
    }), 201


# ============================================================
# ROUTE-SPECIFIC COMMUNITY REVIEWS
# ============================================================

@app.get("/api/reviews")
def get_reviews():

    origin = str(request.args.get("origin", "")).strip()
    destination = str(request.args.get("destination", "")).strip()

    if not origin or not destination:
        return jsonify({"reviews": []})

    with db_connection() as db:

        reviews = rows_as_dicts(
            db.execute(
                """
                SELECT
                    id,
                    name,
                    category AS cat,
                    score,
                    tags,
                    comment,
                    origin,
                    destination
                FROM reviews
                WHERE LOWER(TRIM(origin)) = LOWER(TRIM(?))
                AND LOWER(TRIM(destination)) = LOWER(TRIM(?))
                ORDER BY id DESC
                """,
                (origin, destination)
            )
        )

    return jsonify({"reviews": reviews})


@app.post("/api/reviews")
def add_review():

    data = json_body()

    name = str(data.get("name", "")).strip()
    comment = str(data.get("comment", "")).strip()
    category = str(
        data.get("category", "Community place")
    ).strip()

    origin = str(data.get("origin", "")).strip()
    destination = str(data.get("destination", "")).strip()

    if not name or not comment:
        return error("Place name and review are required.")

    if not origin or not destination:
        return error(
            "Origin and destination are required for a route review."
        )

    with db_connection() as db:

        cursor = db.execute(
            """
            INSERT INTO reviews
            (
                name,
                category,
                score,
                tags,
                comment,
                created_at,
                origin,
                destination
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                category,
                "Community review",
                "Community submitted — not verified",
                comment,
                now_iso(),
                origin,
                destination
            )
        )

        review_id = cursor.lastrowid

    return jsonify({
        "id": review_id,
        "message": "Review saved for this route."
    }), 201


# ============================================================
# HAZARD REPORTS
# ============================================================

@app.post("/api/hazards")
def add_hazard():

    data = json_body()

    location = str(data.get("location", "")).strip()
    description = str(data.get("description", "")).strip()

    if not location or not description:
        return error("Location and description are required.")

    hazard_type = str(data.get("type", "COMMUNITY REPORT")).strip().upper()
    try:
        lat = float(data.get('lat')) if data.get('lat') is not None else None
        lng = float(data.get('lng')) if data.get('lng') is not None else None
    except (TypeError, ValueError):
        return error('Invalid hazard coordinates.')
    if (lat is None) != (lng is None) or (lat is not None and not (-90 <= lat <= 90 and -180 <= lng <= 180)):
        return error('Invalid hazard coordinates.')

    with db_connection() as db:

        cursor = db.execute(
            """
            INSERT INTO hazards
            (type, location, description, status, created_at, lat, lng)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                hazard_type,
                location,
                description,
                "Community report — unverified",
                now_iso(), lat, lng
            )
        )

        hazard_id = cursor.lastrowid

    return jsonify({
        "id": hazard_id,
        "status": "Community report — unverified", "lat":lat, "lng":lng
    }), 201


# ============================================================
# GROUP PLAN
# ============================================================

@app.put("/api/group-plan")
def update_group_plan():

    data = json_body()

    title = str(data.get("title", "")).strip()
    target = str(data.get("target", "")).strip()

    if not title or not target:
        return error("Plan title and destination are required.")

    with db_connection() as db:

        db.execute(
            """
            UPDATE group_plan
            SET title = ?, target = ?
            WHERE id = 1
            """,
            (title, target)
        )

    return jsonify({
        "title": title,
        "target": target
    })


# ============================================================
# CHECK-INS
# ============================================================

@app.post("/api/check-ins")
def create_checkin():

    with db_connection() as db:

        cursor = db.execute(
            """
            INSERT INTO checkins (note, created_at)
            VALUES (?, ?)
            """,
            (
                "User confirmed check-in in the demo.",
                now_iso()
            )
        )

        checkin_id = cursor.lastrowid

    return jsonify({
        "id": checkin_id,
        "message": "Demo check-in saved."
    }), 201


# ============================================================
# JOURNEY SHARING LINKS
# ============================================================

@app.post("/api/journey-links")
def create_journey_link():

    data = json_body()

    origin = str(data.get("origin", "")).strip()
    destination = str(data.get("destination", "")).strip()

    if not origin or not destination:
        return error("Origin and destination are required.")

    token = uuid.uuid4().hex[:10]

    with db_connection() as db:

        db.execute(
            """
            INSERT INTO journey_links
            (token, origin, destination, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                token,
                origin,
                destination,
                now_iso()
            )
        )

    return jsonify({
        "url": f"/journey/demo-{token}",
        "demoOnly": True
    }), 201


@app.get("/journey/<token>")
def view_journey(token: str):

    clean_token = token.removeprefix("demo-")

    with db_connection() as db:

        row = db.execute(
            """
            SELECT origin, destination, created_at
            FROM journey_links
            WHERE token = ?
            """,
            (clean_token,)
        ).fetchone()

    if row is None:
        return error("Journey link not found.", 404)

    return jsonify({
        "journey": dict(row),
        "notice": (
            "Demo link only. No live location tracking is provided."
        )
    })


# ============================================================
# ERROR HANDLERS
# ============================================================

@app.errorhandler(404)
def not_found(_error):

    if request.path.startswith("/api/"):
        return jsonify({
            "error": "API endpoint not found."
        }), 404

    return "Page not found", 404


@app.errorhandler(500)
def internal_error(_error):

    return jsonify({
        "error": "Internal server error."
    }), 500


# ============================================================
# START APPLICATION
# ============================================================

init_db()

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5001)),
        debug=False
    )