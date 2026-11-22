let currentThemeMode=localStorage.getItem('hershield_theme')||'light',isGhostMode=false,isLaptopMode=false;
let friendsData=[];
const HS4_EVENT_KEY='hershield4_local_events';
function addLocalEvent(message){
    const entries=JSON.parse(localStorage.getItem(HS4_EVENT_KEY)||'[]');
    entries.unshift({message:String(message),time:new Date().toLocaleString()});
    localStorage.setItem(HS4_EVENT_KEY,JSON.stringify(entries.slice(0,12)));
    renderLocalEvents();
}
function renderLocalEvents(){
    const el=document.getElementById('notificationCentreEntries');if(!el)return;
    const entries=JSON.parse(localStorage.getItem(HS4_EVENT_KEY)||'[]');
    el.replaceChildren();
    if(!entries.length){const p=document.createElement('p');p.textContent='No new notifications.';el.append(p);return;}
    entries.forEach(e=>{const p=document.createElement('p');p.textContent=e.message+' · '+e.time;el.append(p);});
}

let transitStages=[];
let currentJourneyRoutes=[];
let selectedJourneyRouteIndex=0;
let currentRoutePlaces=[];
let chosenHazardPoint=null;
let gpsOrigin=null;
let routePlacesLayer=null;
let plannerRouteLayer=null;
let plannerRouteRequestId=0;
let guardiansList=[];
let safeZoneLocations=[];
let safeStayList=[];
let hazardReportsList=[];

function showToast(msg){let t=document.getElementById('appToast');t.textContent=msg;t.style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.style.display='none',2800)}
function applyTheme(mode){currentThemeMode=mode;localStorage.setItem('hershield_theme',mode);document.body.classList.toggle('dark-mode',mode==='dark');['light','dark'].forEach(m=>document.getElementById('themeBtn-'+m).classList.toggle('active',m===mode))}
function toggleLaptopMode(){isLaptopMode=!isLaptopMode;document.body.classList.toggle('laptop-mode',isLaptopMode);document.getElementById('themeBtn-laptop').classList.toggle('active',isLaptopMode);showToast(isLaptopMode?'Laptop / iPad mode enabled':'Mobile layout enabled')}

function switchView(id) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    document.getElementById('view-' + id).classList.add('active');
    document.querySelectorAll('.dock-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.view === id)
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
        if (id === 'hercircle' && herCircleLeafletMap) {
            herCircleLeafletMap.invalidateSize();
            renderHerCircleMapMarkers();
        }
        if (id === 'planner' && herPlannerLeafletMap) {
            herPlannerLeafletMap.invalidateSize();
        }
    }, 250);
}

function switchSafeSubTab(id){['directory','reviews','hazards'].forEach(x=>{document.getElementById('safeSub-'+x).style.display=x===id?'block':'none';document.getElementById('subTabBtn-'+x).classList.toggle('active',x===id)});if(id==='reviews')loadRouteReviews()}
function toggleDrawer(open){document.getElementById('drawerBackdrop').classList.toggle('open',open);document.getElementById('sideDrawer').classList.toggle('open',open)}

function openModal(id){
    if(id==='writeReviewModal'){
        const origin=document.getElementById('plannerOriginInput').value.trim();
        const destination=document.getElementById('plannerDestInput').value.trim();
        if(!origin||!destination){
            showToast('Enter both journey locations in Journey Planner first');
            return;
        }
        const context=document.getElementById('reviewRouteContext');
        if(context)context.textContent='Reviewing route: '+origin+' → '+destination;
    }
    document.getElementById(id).classList.add('open');
}
function closeModal(id){document.getElementById(id).classList.remove('open')}

function renderAllFriends(){
    let active=friendsData.filter(f=>f.isSharing).length; // demo contacts, not GPS sessions
    document.getElementById('homeActiveFriendsTitle').textContent=`HerCircle Demo Friends (${active})`;
    document.getElementById('squadDirectoryCount').textContent=`Squad Directory (${friendsData.length})`;

    document.getElementById('homeFriendsListContainer').innerHTML=friendsData.map(f=>`<div class="friend-item-card"><div class="friend-left"><div class="avatar-wrap"><img class="avatar-img" src="${escapeRouteText(f.avatar || "https://api.dicebear.com/9.x/initials/svg?seed="+encodeURIComponent(f.name))}" alt="${escapeRouteText(f.name)}"><span class="status-dot" style="background:${f.status==='safe'?'#10B981':f.status==='moving'?'#F59E0B':'#9CA3AF'}"></span></div><div><div class="friend-name">${escapeRouteText(f.name)}</div><div class="friend-meta">${f.isSharing?'Contact saved · GPS not connected':'Paused'}</div></div></div><span class="battery-badge">🔋 ${f.battery}%</span></div>`).join('');

    document.getElementById('squadDirectoryList').innerHTML=friendsData.map(f=>`<div class="friend-item-card"><div class="friend-left"><img class="avatar-img" src="${escapeRouteText(f.avatar || "https://api.dicebear.com/9.x/initials/svg?seed="+encodeURIComponent(f.name))}" alt="" style="width:40px;height:40px"><div><div class="friend-name">${escapeRouteText(f.name)}</div><div class="friend-meta">${f.isSharing?'GPS not connected':'Paused'}</div></div></div><button class="btn-pill-soft" onclick="toggleFriendShare('${f.id}')">${f.isSharing?'Listed':'Paused'}</button><button class="btn-pill-soft" onclick="alertFriend('${f.id}')">🔔 Alert</button></div>`).join('');

    let pins=friendsData.filter(f=>f.isSharing).map(f=>`<div class="map-pin-node" style="left:${f.mapX}%;top:${f.mapY}%" onclick="showToast('${escapeRouteText(f.name)} • ${f.battery}% battery')"><div class="map-pin-tooltip">${f.name.split(' ')[0]} • ${f.eta}</div><img class="avatar-img" style="width:40px;height:40px" src="${escapeRouteText(f.avatar || "https://api.dicebear.com/9.x/initials/svg?seed="+encodeURIComponent(f.name))}" alt="${escapeRouteText(f.name)}"></div>`);
    if(!isGhostMode)pins.push('<div class="map-pin-node" style="left:32%;top:68%"><div class="map-pin-tooltip">You (Host)</div><div class="shield-logo-box">You</div></div>');
    document.getElementById('circleMapPinsLayer').innerHTML=pins.join('');
}

//renderHerCircleMapMarkers();

function toggleFriendShare(id){
    friendsData=friendsData.map(f=>f.id===id?{...f,isSharing:!f.isSharing,status:f.isSharing?'offline':'safe'}:f);
    const changed=friendsData.find(f=>f.id===id);
    if(changed)apiRequest(`/api/friends/${encodeURIComponent(id)}/sharing`,{method:'PATCH',body:JSON.stringify({isSharing:changed.isSharing})}).catch(showApiError);
    renderAllFriends();
    renderHerCircleMapMarkers();
    showToast('Contact preference updated; this does not enable their GPS remotely');
}

function toggleGhostState(){
    isGhostMode=!isGhostMode;
    document.getElementById('ghostToggleText').textContent='Ghost Mode: '+(isGhostMode?'ON':'OFF');
    renderAllFriends();
    renderHerCircleMapMarkers();
    showToast(isGhostMode?'Your host pin is hidden':'Ghost Mode OFF');
}

function selectDuration(btn,label){
    document.querySelectorAll('.dur-pill-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    showToast('Auto-share duration set to '+label);
}

async function submitNewFriend(){
    const name=document.getElementById('inputFriendName').value.trim();
    if(!name)return showToast('Please enter a friend name');
    const avatar='';
    const phone=document.getElementById('inputFriendHandle')?.value.trim()||'';
    try{
        const saved=await apiRequest('/friends',{method:'POST',body:JSON.stringify({name,avatar,phone})});
        friendsData.push({id:saved.id,name,phone,eta:'Not connected',battery:0,status:'offline',isSharing:false,avatar,mapX:25,mapY:45});
        document.getElementById('inputFriendName').value='';
        document.getElementById('inputFriendHandle').value='';
        closeModal('addFriendModal');
        renderAllFriends();
        if(typeof renderHerCircleMapMarkers==='function')renderHerCircleMapMarkers();
        addLocalEvent('Friend contact added: '+name);showToast('Contact added. Location sharing requires the contact to connect.');
    }catch(error){showApiError(error)}
}

function submitGroupPlan(){
    let title=document.getElementById('inputPlanName').value.trim(),target=document.getElementById('inputPlanTarget').value.trim();
    if(!title||!target)return showToast('Please fill out plan details');
    document.getElementById('groupPlanNameText').textContent=title;
    document.getElementById('groupPlanTargetText').textContent='Target: '+target;
    const meetupLabel=document.getElementById('mapMeetupLabel');if(meetupLabel)meetupLabel.textContent='MEETUP: '+target.split('•')[0];
    apiRequest('/api/group-plan',{method:'PUT',body:JSON.stringify({title,target})}).catch(showApiError);
    closeModal('groupPlanModal');
    updateGroupPlanMap(target);
    addLocalEvent('Group plan updated: '+title);showToast('Group plan updated');
}

function triggerCheckInConfirm(){
    apiRequest('/api/check-ins',{method:'POST',body:JSON.stringify({})}).catch(showApiError);
    document.getElementById('checkinButtonWrap').style.display='none';
    document.getElementById('checkinConfirmedBanner').style.display='flex';
    document.getElementById('lastVerifiedStamp').textContent='Last verified: Today at '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    addLocalEvent('Safety check-in recorded locally');notifyGuardianCheckIn();
    setTimeout(()=>{
        document.getElementById('checkinButtonWrap').style.display='block';
        document.getElementById('checkinConfirmedBanner').style.display='none';
    },4000);
}

// ===============================
// JOURNEY PLANNER AND LIVE ROUTES
// ===============================

function renderTransitStages(){
    const container=document.getElementById('transitStagesList');
    if(!container)return;
    if(!transitStages.length){
        container.innerHTML='<div class="card"><p style="font-size:12px;color:var(--text-muted)">Enter your locations and select FIND ROUTE to load available public-transport connections.</p></div>';
        return;
    }
    container.innerHTML=transitStages.map((s,i)=>`<div class="stage-row-card"><div style="display:flex;gap:10px;align-items:center;min-width:0"><div class="stage-num-circle">${i+1}</div><div style="min-width:0"><b style="font-size:13px">${escapeRouteText(s.mode)}</b><div style="font-size:11px;color:var(--purple-violet)">${escapeRouteText(s.detail||'')}</div>${s.distance||s.duration?`<small style="color:var(--text-muted)">${escapeRouteText([s.distance,s.duration].filter(Boolean).join(' • '))}</small>`:''}</div></div><b style="font-size:10px;color:var(--emerald);text-align:right">${escapeRouteText(s.badge||'')}</b></div>`).join('');
}

function escapeRouteText(value){
    return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function clearPlannerRoute(){
    if(herPlannerLeafletMap&&plannerRouteLayer){
        herPlannerLeafletMap.removeLayer(plannerRouteLayer);
    }
    plannerRouteLayer=null;
    currentJourneyRoutes=[];
    transitStages=[];
    renderTransitStages();
    const summary=document.getElementById('routeSummary');
    if(summary)summary.textContent='Enter your journey locations, then find a route.';
}

function decodeGooglePolyline(encoded){
    let points=[],index=0,lat=0,lng=0;
    while(index<encoded.length){
        let result=0,shift=0,byte;
        do{
            byte=encoded.charCodeAt(index++)-63;
            result|=(byte&0x1f)<<shift;
            shift+=5;
        }while(byte>=0x20&&index<encoded.length);
        const deltaLat=(result&1)?~(result>>1):(result>>1);
        lat+=deltaLat;
        result=0;
        shift=0;
        do{
            byte=encoded.charCodeAt(index++)-63;
            result|=(byte&0x1f)<<shift;
            shift+=5;
        }while(byte>=0x20&&index<encoded.length);
        const deltaLng=(result&1)?~(result>>1):(result>>1);
        lng+=deltaLng;
        points.push([lat/1e5,lng/1e5]);
    }
    return points;
}

function drawPlannerRoute(encodedPolyline){
    if(!herPlannerLeafletMap||!encodedPolyline)return;
    const points=decodeGooglePolyline(encodedPolyline);
    if(!points.length)return;
    if(plannerRouteLayer)herPlannerLeafletMap.removeLayer(plannerRouteLayer);
    plannerRouteLayer=L.layerGroup().addTo(herPlannerLeafletMap);
    const base=L.polyline(points,{color:'#7136A8',weight:4,opacity:.55}).addTo(plannerRouteLayer);
    const route=currentJourneyRoutes[selectedJourneyRouteIndex];
    const stages=(route&&route.steps)||[];
    let segmentCount=0;
    stages.forEach((step,i)=>{
        if(!step.encodedPolyline)return;
        const segment=decodeGooglePolyline(step.encodedPolyline);
        if(segment.length<2)return;
        const mode=(step.mode||'').toLowerCase();
        const color=step.travelMode==='WALK'?'#22c55e':(mode.includes('metro')||mode.includes('subway')||mode.includes('rail')||mode.includes('train'))?'#3b82f6':'#facc15';
        L.polyline(segment,{color,weight:7,opacity:.95}).bindPopup(`${escapeRouteText(step.mode)} · ${escapeRouteText(step.detail)}`).addTo(plannerRouteLayer);
        if(segmentCount++<18)L.marker(segment[0],{icon:L.divIcon({className:'hs-transport-pin',html:`<span>${step.travelMode==='WALK'?'🚶':color==='#3b82f6'?'🚇':'🚌'}</span>`,iconSize:[28,28]})}).addTo(plannerRouteLayer);
    });
    L.circleMarker(points[0],{radius:8,color:'#22c55e',fillOpacity:1}).bindPopup('Origin').addTo(plannerRouteLayer);
    L.circleMarker(points[points.length-1],{radius:8,color:'#e94a70',fillOpacity:1}).bindPopup('Destination').addTo(plannerRouteLayer);
    herPlannerLeafletMap.fitBounds(base.getBounds().pad(.15));
}

function showRouteStatus(message,isError=false){
    const status=document.getElementById('routeStatus');
    if(status){
        status.textContent=message;
        status.style.color=isError?'#C62845':'var(--purple-violet)';
    }
}

function renderJourneyRoute(route,index=0){
    selectedJourneyRouteIndex=index;
    transitStages=route.steps||[];
    renderTransitStages();
    const summary=document.getElementById('routeSummary');
    if(summary)summary.textContent=`${route.label||'Route '+(index+1)} • ${route.duration||'Duration unavailable'} • ${route.distance||'Distance unavailable'}`;
    drawPlannerRoute(route.encodedPolyline);
    refreshRouteContext(route);

    const homeTransit=document.querySelector('.transit-stage-pill');
    if(homeTransit){
        const mainStage=transitStages.find(stage=>stage.travelMode==='TRANSIT');
        homeTransit.textContent=mainStage?`${mainStage.mode}: ${mainStage.detail}`:'Walking route';
    }

    const homeEta=document.querySelector('.pill-eta');
    if(homeEta&&route.duration)homeEta.textContent='ETA '+route.duration;
    showRouteStatus(route.demo ? 'Backup estimates: schematic geometry, not navigable directions.' : 'Google transit route loaded. Check service times before travelling.');
}

async function findJourneyRoute(demo=false){
    const origin=document.getElementById('plannerOriginInput').value.trim();
    const destination=document.getElementById('plannerDestInput').value.trim();

    if(!origin||!destination){
        showToast('Please enter both origin and destination');
        return;
    }

    const requestId=++plannerRouteRequestId;
    clearPlannerRoute();
    renderRouteHazards([],false);

    const button=document.getElementById('findRouteButton');
    if(button){
        button.disabled=true;
        button.textContent='FINDING ROUTE…';
    }

    showRouteStatus('Finding available public-transport routes…');

    const container=document.getElementById('transitStagesList');
    if(container)container.innerHTML='<div class="card"><p>Checking available transit connections…</p></div>';

    try{
        const result=await apiRequest(demo?'/offline-route':'/route',{method:'POST',body:JSON.stringify({origin:gpsOrigin && origin===gpsOrigin.label ? gpsOrigin.coords : origin,destination})});
        if(requestId!==plannerRouteRequestId)return;

        currentJourneyRoutes=result.routes||[];
        renderRouteHazards(result.hazards||[], !!result.demo);
        window.lastCalculatedOrigin=origin;
        window.lastCalculatedDestination=destination;

        if(!currentJourneyRoutes.length){
            transitStages=[];
            renderTransitStages();
            showRouteStatus(result.message||'No public-transit route was found for these locations.',true);
            const summary=document.getElementById('routeSummary');
            if(summary)summary.textContent='No route found';
            return;
        }

        renderJourneyRoute(currentJourneyRoutes[0],0);

        const alternatives=document.getElementById('routeAlternatives');
        if(alternatives){
            alternatives.innerHTML=currentJourneyRoutes.length>1
                ?currentJourneyRoutes.map((route,i)=>`<button class="btn-pill-soft" type="button" onclick="selectJourneyRoute(${i})">${escapeRouteText(route.label||'Route '+(i+1))} · ${escapeRouteText(route.duration||'')}</button>`).join(' ')
                :'';
        }

        syncPlannerEndpoints();
    }catch(error){
        if(requestId!==plannerRouteRequestId)return;
        console.error('Route calculation failed:',error);
        transitStages=[];
        renderTransitStages();
        showRouteStatus((error.message||'Could not calculate this route.')+' Try Offline Estimates for supported Delhi landmarks.',true);
        const summary=document.getElementById('routeSummary');
        if(summary)summary.textContent='Route unavailable';
        showToast(error.message||'Route calculation failed');
    }finally{
        if(requestId===plannerRouteRequestId&&button){
            button.disabled=false;
            button.textContent='FIND ROUTE';
        }
    }
}

function selectJourneyRoute(index){
    if(!currentJourneyRoutes[index])return;
    renderJourneyRoute(currentJourneyRoutes[index],index);
}

function submitNewStage(){
    let mode=document.getElementById('inputStageMode').value.trim(),note=document.getElementById('inputStageNote').value.trim()||'Verified Safe Corridor';
    if(!mode)return showToast('Please enter a transport mode');
    transitStages.push({mode,detail:note,badge:'Verified'});
    document.getElementById('inputStageMode').value='';
    document.getElementById('inputStageNote').value='';
    closeModal('addStageModal');
    renderTransitStages();
    showToast('Added transit stage: '+mode);
}

function syncPlannerEndpoints(){
    const origin=document.getElementById('plannerOriginInput').value.trim();
    const destination=document.getElementById('plannerDestInput').value.trim();

    document.getElementById('homeOriginText').textContent=origin;
    document.getElementById('homeDestText').textContent=destination;

    const label=document.getElementById('reviewsRouteLabel');
    if(label)label.textContent=origin&&destination
        ?'Showing reviews for: '+origin+' → '+destination
        :'Enter an origin and destination in Journey Planner to see route reviews.';

    if(currentJourneyRoutes.length){
        const routeChanged=window.lastCalculatedOrigin!==origin||window.lastCalculatedDestination!==destination;
        if(routeChanged){
            plannerRouteRequestId++;
            clearPlannerRoute();
            showRouteStatus('Locations changed. Select FIND ROUTE to calculate the new journey.');
        }
    }
}

async function loadRouteReviews(){
    const origin=document.getElementById('plannerOriginInput').value.trim();
    const destination=document.getElementById('plannerDestInput').value.trim();
    const container=document.getElementById('safeStayReviewsContainer');
    const label=document.getElementById('reviewsRouteLabel');

    if(!origin||!destination){
        if(label)label.textContent='Enter an origin and destination in Journey Planner to see route reviews.';
        container.innerHTML='<div class="card"><p>Sample reviews below are fictional demonstration entries. Enter a journey for route-specific user reviews.</p></div>'+safeStayList.map(r=>`<div class="card"><h3>${escapeRouteText(r.name)}</h3><p>${escapeRouteText(r.score)} · ${escapeRouteText(r.tags)}</p><p>${escapeRouteText(r.comment)}</p></div>`).join('');
        return;
    }

    if(label)label.textContent='Reviews for: '+origin+' → '+destination;
    container.innerHTML='<div class="card"><p>Loading reviews for this route…</p></div>';

    try{
        const params=new URLSearchParams({origin,destination});
        const data=await apiRequest('/reviews?'+params.toString());
        safeStayList=(data.reviews&&data.reviews.length)?data.reviews:(window.herShieldSampleReviews||[]);

        container.innerHTML=safeStayList.length
            ?safeStayList.map(r=>`<div class="card"><div class="section-header-row"><span class="pill-tag">${r.cat||'Community review'}</span><b>${r.score||'Community review'}</b></div><h3 style="margin-top:10px">${escapeRouteText(r.name)}</h3><p style="font-size:11px;color:var(--emerald);margin:6px 0">${r.tags||'Community submitted — not verified'}</p><p style="font-size:12px;color:var(--text-muted)">${escapeRouteText(r.comment)}</p></div>`).join('')
            :'<div class="card"><p>No reviews available for this route yet. Be the first to add one.</p></div>';
    }catch(error){
        console.error(error);
        container.innerHTML='<div class="card"><p>Could not load reviews. Please check that the backend is running.</p></div>';
    }
}

// ===============================
// SAFE STAY, REVIEWS AND HAZARDS
// ===============================

async function openShareLinkModal(){
    const origin=document.getElementById('plannerOriginInput').value.trim();
    const destination=document.getElementById('plannerDestInput').value.trim();

    try{
        const result=await apiRequest('/api/journey-links',{method:'POST',body:JSON.stringify({origin,destination})});
        document.getElementById('shareUrlBox').textContent=window.location.origin+result.url+' (planned route only; no live tracking)';
    }catch(error){
        showApiError(error);
        document.getElementById('shareUrlBox').textContent='Journey link could not be saved.';
    }
    openModal('shareLinkModal');
}

function copyJourneyLink(){
    let val=document.getElementById('shareUrlBox').textContent;
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(val).catch(()=>{});
    closeModal('shareLinkModal');
    showToast('Journey link copied if clipboard permission is available');
}

function renderSafeTabLists(){
    document.getElementById('safeZoneDirectoryCards').innerHTML=(currentRoutePlaces.length ? currentRoutePlaces : safeZoneLocations).map(s=>`<div class="card"><div class="section-header-row"><span class="pill-tag">${escapeRouteText(s.type)}</span><b style="color:var(--emerald);font-size:12px">${s.info ? "DEMO" : "OSM"}</b></div><h3 style="margin-top:10px">${escapeRouteText(s.name)}</h3><p style="font-size:12px;color:var(--text-muted)">${escapeRouteText(s.info || (s.distanceMeters+' m from route · OpenStreetMap'))}</p>${s.phone?`<a href="tel:${escapeRouteText(s.phone.replace(/[^+0-9]/g,''))}" class="btn-pill-soft">📞 Call ${escapeRouteText(s.type)}</a>`:''}${s.lat!=null&&s.lng!=null?`<a class="btn-pill-soft" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(s.lat)}&mlon=${encodeURIComponent(s.lng)}#map=17/${encodeURIComponent(s.lat)}/${encodeURIComponent(s.lng)}">📍 Map</a>`:""}</div>`).join('') || '<div class="card"><p>No nearby listings loaded yet. Choose a journey and select FIND ROUTE to search around it.</p></div>';

    document.getElementById('safeStayReviewsContainer').innerHTML=safeStayList.map(r=>`<div class="card"><div class="section-header-row"><span class="pill-tag">${escapeRouteText(r.cat)}</span><b>${escapeRouteText(r.score)}</b></div><h3 style="margin-top:10px">${escapeRouteText(r.name)}</h3><p style="font-size:11px;color:var(--emerald);margin:6px 0">${escapeRouteText(r.tags)}</p><p style="font-size:12px;color:var(--text-muted)">${escapeRouteText(r.comment)}</p></div>`).join('');

    document.getElementById('hazardReportsContainer').innerHTML=hazardReportsList.map(h=>`<div class="card"><span class="pill-tag">${escapeRouteText(h.type)}</span><h3 style="margin-top:10px">${escapeRouteText(h.loc)}</h3><p style="font-size:12px;color:var(--text-muted)">${escapeRouteText(h.desc)}</p><small>${escapeRouteText(h.status)}</small></div>`).join('') || '<div class="card"><p>No community reports for this journey yet. Use Report Hazard to add a location-specific report.</p></div>';

    document.getElementById('drawerGuardiansList').innerHTML=guardiansList.map(g=>`<div class="friend-item-card"><div><b>${escapeRouteText(g.name)}</b><div class="friend-meta">${escapeRouteText(g.phone)}</div></div><a href="tel:${escapeRouteText(String(g.phone).replace(/[^+0-9]/g,''))}" class="btn-pill-soft">Call</a></div>`).join('');
}

async function submitNewReview(){
    const name=inputRevPlace.value.trim(),cat=inputRevCat.value.trim(),comment=inputRevComment.value.trim();
    const origin=document.getElementById('plannerOriginInput').value.trim();
    const destination=document.getElementById('plannerDestInput').value.trim();

    if(!origin||!destination)return showToast('Select an origin and destination first');
    if(!name||!comment)return showToast('Please fill out place name and review');

    try{
        await apiRequest('/reviews',{method:'POST',body:JSON.stringify({name,category:cat,comment,origin,destination})});
        inputRevPlace.value='';
        inputRevComment.value='';
        closeModal('writeReviewModal');
        await loadRouteReviews();
        showToast('Review saved for this journey');
    }catch(error){showApiError(error)}
}

function submitNewHazard(){
    let type=inputHazardType.value.trim(),loc=inputHazardLoc.value.trim(),desc=inputHazardDesc.value.trim();
    if(!loc||!desc)return showToast('Please enter location and description');

    hazardReportsList.unshift({type:type.toUpperCase(),loc,desc,status:'Community report — unverified'});
    apiRequest('/api/hazards',{method:'POST',body:JSON.stringify({type,location:loc,description:desc,lat:chosenHazardPoint?.lat,lng:chosenHazardPoint?.lng})}).then(()=>refreshRouteContext(currentJourneyRoutes[selectedJourneyRouteIndex])).catch(showApiError);
    inputHazardLoc.value='';
    inputHazardDesc.value='';
    closeModal('reportHazardModal');
    renderSafeTabLists();
    addLocalEvent('Community hazard submitted near '+loc);showToast('Community hazard report submitted (unverified)');
    chosenHazardPoint=null;
}

async function submitNewGuardian(){
    const name=inputGuardName.value.trim(),phone=inputGuardPhone.value.trim();
    if(!name||!phone)return showToast('Please enter guardian name and phone');

    try{
        const saved=await apiRequest('/guardians',{method:'POST',body:JSON.stringify({name,phone})});
        guardiansList.push({id:saved.id,name,phone});
        inputGuardName.value='';
        inputGuardPhone.value='';
        closeModal('addGuardianModal');
        renderSafeTabLists();
        addLocalEvent('Trusted contact added: '+name);showToast('Guardian added successfully');
    }catch(error){showApiError(error)}
}

function revokeAllSharing(){
    isGhostMode=true;
    friendsData=friendsData.map(f=>({...f,isSharing:false,status:'offline'}));
    renderAllFriends();
    toggleDrawer(false);
    showToast('All simulated sharing stopped');
}

// ===============================
// SOS AND EMERGENCY DEMO FEATURES
// ===============================

let callTimer=null,callSeconds=0;

function openFakeCallOverlay(){
    clearInterval(callTimer);
    callSeconds=0;
    fakeCallStatusLine.textContent='Incoming Priority Security Call...';
    fakeCallAnswerBtn.style.display='inline-block';
    fakeCallOverlay.classList.add('open');
}

function connectFakeCall(){
    fakeCallAnswerBtn.style.display='none';
    fakeCallStatusLine.textContent='Call Connected (00:00)';
    callTimer=setInterval(()=>{
        callSeconds++;
        fakeCallStatusLine.textContent='Call Connected (00:'+String(callSeconds).padStart(2,'0')+')';
    },1000);
}

function closeFakeCallOverlay(){
    clearInterval(callTimer);
    fakeCallOverlay.classList.remove('open');
}

let audioCtx=null,oscNode=null,lfoNode=null,sirenActive=false,strobeOn=false,sosCountdownTimer=null,sosSec=3;

function startAudioSiren(){
    if(sirenActive)return;
    try{
        let AC=window.AudioContext||window.webkitAudioContext;
        if(!AC)throw Error();
        audioCtx=new AC();
        oscNode=audioCtx.createOscillator();
        lfoNode=audioCtx.createOscillator();
        let gain=audioCtx.createGain(),main=audioCtx.createGain();
        oscNode.type='sawtooth';
        oscNode.frequency.value=780;
        lfoNode.frequency.value=3.6;
        gain.gain.value=420;
        lfoNode.connect(oscNode.frequency);
        oscNode.connect(main);
        main.connect(audioCtx.destination);
        main.gain.value=.2;
        oscNode.start();
        lfoNode.start();
        sirenActive=true;
    }catch(e){
        showToast('Siren audio unavailable in this browser');
    }
    syncSirenUi();
}

function stopAudioSiren(){
    if(oscNode){
        try{oscNode.stop();lfoNode.stop();oscNode.disconnect()}catch(e){}
        oscNode=null;
        lfoNode=null;
    }
    if(audioCtx){
        audioCtx.close().catch(()=>{});
        audioCtx=null;
    }
    sirenActive=false;
    syncSirenUi();
}

function toggleLoudSiren(){sirenActive?stopAudioSiren():startAudioSiren()}

function syncSirenUi(){
    let b=document.getElementById('sirenBtnText');
    if(b)b.textContent=sirenActive?'🔇 Turn Off Siren':'🔊 Turn On Siren';
}

function toggleStrobeFlash(){
    strobeOn=!strobeOn;
    document.getElementById('strobeFlashLayer').style.display=strobeOn?'block':'none';
    document.getElementById('strobeBtnText').textContent=strobeOn?'Stop Flashing':'Flash Screen';
}

function startSosSequence(){
    clearInterval(sosCountdownTimer);
    sosSec=3;
    document.getElementById('sosStepCountdown').style.display='block';
    document.getElementById('sosStepActive').style.display='none';
    document.getElementById('sosCountdownDigit').textContent=sosSec;
    document.getElementById('sosOverlayScreen').classList.add('open');

    sosCountdownTimer=setInterval(()=>{
        sosSec--;
        if(sosSec>0){
            document.getElementById('sosCountdownDigit').textContent=sosSec;
        }else{
            clearInterval(sosCountdownTimer);
            document.getElementById('sosStepCountdown').style.display='none';
            document.getElementById('sosStepActive').style.display='block';
            startAudioSiren();
        }
    },1000);
}

function standDownSos(){
    clearInterval(sosCountdownTimer);
    stopAudioSiren();
    strobeOn=false;
    document.getElementById('strobeFlashLayer').style.display='none';
    document.getElementById('sosOverlayScreen').classList.remove('open');
    showToast('SOS alarm stopped');
}

let lastShakeStamp=0;
window.addEventListener('devicemotion',e=>{
    let cb=document.getElementById('shakeSosCheckbox');
    if(cb&&!cb.checked)return;
    let a=e.accelerationIncludingGravity;
    if(!a)return;
    let force=Math.abs(a.x||0)+Math.abs(a.y||0)+Math.abs(a.z||0),now=Date.now();
    if(force>44&&now-lastShakeStamp>6000){
        lastShakeStamp=now;
        startSosSequence();
    }
});

// ===============================
// LOGIN FEATURE — PRESERVED
// ===============================

function setHerShieldUser(name) {
    const greeting = document.getElementById('homeGreetingName');
    const drawerName = document.getElementById('drawerUserName');
    if (greeting) greeting.textContent = name;
    if (drawerName) drawerName.textContent = name;
}

function showHerShieldApp(name) {
    document.body.classList.add('logged-in');
    setHerShieldUser(name);
}

function logoutHerShield() {
    localStorage.removeItem('hershield_user_name');
    document.body.classList.remove('logged-in');
    const nameInput = document.getElementById('loginName');
    const phoneInput = document.getElementById('loginPhone');
    const error = document.getElementById('loginError');
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (error) error.textContent = '';
    toggleDrawer(false);
}

function initializeHerShieldLogin() {
    const form = document.getElementById('loginForm');
    const nameInput = document.getElementById('loginName');
    const phoneInput = document.getElementById('loginPhone');
    const error = document.getElementById('loginError');
    const savedName = localStorage.getItem('hershield_user_name');

    if (savedName) showHerShieldApp(savedName);

    if (!form) return;

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        const name = nameInput.value.trim().replace(/\s+/g, ' ');
        const phone = phoneInput.value.replace(/\D/g, '');

        if (name.length < 2) {
            error.textContent = 'Please enter your name (at least 2 characters).';
            nameInput.focus();
            return;
        }

        if (phone.length !== 10) {
            error.textContent = 'Please enter a valid 10-digit mobile number.';
            phoneInput.focus();
            return;
        }

        localStorage.setItem('hershield_user_name', name);
        // The mobile number is validated for this demo but is not stored.
        error.textContent = '';
        showHerShieldApp(name);
    });
}

window.addEventListener('DOMContentLoaded', initializeHerShieldLogin);

// ===============================
// BACKEND CONNECTION
// ===============================

const HER_SHIELD_API = window.location.port === '5500'
    ? 'http://127.0.0.1:5000/api'
    : '/api';

async function apiRequest(path, options = {}) {
    const endpoint = path.startsWith('/api/')
        ? `${HER_SHIELD_API}${path.slice(4)}`
        : `${HER_SHIELD_API}${path.startsWith('/') ? path : '/' + path}`;

    const response = await fetch(endpoint, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
}

function showApiError(error) {
    console.error('HerShield API:', error);
    showToast('Backend unavailable. This change may not be saved.');
}

async function loadHerShieldBackendData() {
    try {
        const data = await apiRequest('/bootstrap');

        friendsData = data.friends || friendsData;
        // Route stages are populated only by a successful live route calculation.
        transitStages = [];
        guardiansList = data.guardians || guardiansList;
        safeZoneLocations = data.safeZoneLocations || safeZoneLocations;
        safeStayList = data.sampleReviews || [];
        window.herShieldSampleReviews = data.sampleReviews || [];
        hazardReportsList = data.hazardReportsList || hazardReportsList;

        if (data.groupPlan) {
            const nameElement = document.getElementById('groupPlanNameText');
            const targetElement = document.getElementById('groupPlanTargetText');

            if (nameElement) {
                nameElement.textContent = data.groupPlan.title || 'Group Plan';
            }

            if (targetElement) {
                targetElement.textContent = 'Target: ' + (data.groupPlan.target || 'Not specified');
            }
        }

        renderAllFriends();
        renderTransitStages();
        renderSafeTabLists();
        renderLocalEvents();renderHerCircleMapMarkers();showToast('HerShield backend connected');
    } catch (error) {
        console.warn('HerShield backend is not connected.', error);
        showToast('Backend connection unavailable');
    }
}

window.addEventListener('DOMContentLoaded', loadHerShieldBackendData);

// ===============================
// LEAFLET MAP SETUP
// ===============================

let herCircleLeafletMap = null;
let herPlannerLeafletMap = null;

function initializeHerShieldMaps() {
    const circleElement = document.getElementById("circleMap");

    if (circleElement && !herCircleLeafletMap) {
        herCircleLeafletMap = L.map("circleMap").setView(
            [28.6675, 77.2273],
            14
        );

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(herCircleLeafletMap);
    }

    const plannerElement = document.getElementById("plannerMap");

    if (plannerElement && !herPlannerLeafletMap) {
        herPlannerLeafletMap = L.map("plannerMap").setView(
            [28.6675, 77.2273],
            14
        );

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(herPlannerLeafletMap);
        herPlannerLeafletMap.on('click', e => {
            chosenHazardPoint={lat:e.latlng.lat,lng:e.latlng.lng};
            const field=document.getElementById('inputHazardLoc');
            if(field)field.value=`Pinned map location (${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`;
            showToast('Location pinned for your next hazard report');
        });
    }
}

document.addEventListener("DOMContentLoaded", function () {
    initializeHerShieldMaps();
});

// ===============================
// HER CIRCLE FRIEND & MEETUP MAP
// DEMO LOCATIONS
// ===============================

let herCircleMarkers = [];
let herCircleRoutes = [];
let meetupMarker = null;

let demoHostLocation = [28.6675, 77.2273]; // Initial map center, not a claimed GPS fix

function getFriendDemoLocation(friend) {
    return [
        28.685 - Number(friend.mapY||50) * 0.00025,
        77.209 + Number(friend.mapX||50) * 0.00028
    ];
}

function clearHerCircleMapLayers() {
    herCircleMarkers.forEach(marker => {
        herCircleLeafletMap.removeLayer(marker);
    });

    herCircleRoutes.forEach(route => {
        herCircleLeafletMap.removeLayer(route);
    });

    herCircleMarkers = [];
    herCircleRoutes = [];
}

function renderHerCircleMapMarkers() {
    if (!herCircleLeafletMap) return;

    clearHerCircleMapLayers();

    friendsData.filter(friend => friend.isSharing).forEach(friend => {
        const location = friend.lat != null && friend.lng != null ? [Number(friend.lat),Number(friend.lng)] : getFriendDemoLocation(friend);

        const marker = L.marker(location)
            .addTo(herCircleLeafletMap)
            .bindTooltip(
                friend.name + ' • Sample location (not live GPS)',
                { permanent: false }
            );

        herCircleMarkers.push(marker);
    });

    if (!isGhostMode) {
        const hostMarker = L.marker(gpsOrigin ? [gpsOrigin.coords.latitude,gpsOrigin.coords.longitude] : demoHostLocation)
            .addTo(herCircleLeafletMap)
            .bindTooltip(gpsOrigin ? 'You (Host)' : 'You (sample starting point)', { permanent: false });

        herCircleMarkers.push(hostMarker);
    }

    if (herCircleMarkers.length > 0) {
        const group = L.featureGroup(herCircleMarkers);
        herCircleLeafletMap.fitBounds(group.getBounds().pad(0.2));
    }
    drawMeetupMap();
}

let circleMeetupMarker = null;
let circleRouteLines = [];

function drawMeetupMap() {
    if (!herCircleLeafletMap) return;

    circleRouteLines.forEach(line => herCircleLeafletMap.removeLayer(line));
    circleRouteLines = [];

    if (circleMeetupMarker) {
        herCircleLeafletMap.removeLayer(circleMeetupMarker);
    }

    const meetup = window.groupMeetupCoordinates || [28.6675,77.2273];

    circleMeetupMarker = L.marker(meetup)
        .addTo(herCircleLeafletMap)
        .bindTooltip("Group Meetup");

    friendsData.filter(f => f.isSharing).forEach(friend => {
        const start = friend.lat != null && friend.lng != null ? [Number(friend.lat),Number(friend.lng)] : getFriendDemoLocation(friend);

        const line = L.polyline([start, meetup], {
            color: "#8B5CF6",
            weight: 4,
            opacity: 0.85,
            dashArray: "8, 8"
        }).addTo(herCircleLeafletMap);

        circleRouteLines.push(line);
    });

    if(!isGhostMode){
        const host=gpsOrigin ? [gpsOrigin.coords.latitude,gpsOrigin.coords.longitude] : demoHostLocation;
        circleRouteLines.push(L.polyline([host,meetup],{color:'#16a34a',weight:4,dashArray:'6,8'}).bindTooltip('Your position → Meetup (straight-line guide)').addTo(herCircleLeafletMap));
    }
    if(window.groupDestinationCoordinates){
        const dest=window.groupDestinationCoordinates;
        circleRouteLines.push(L.polyline([meetup,dest],{color:'#3b82f6',weight:5}).bindTooltip('Meetup → Destination (straight-line guide)').addTo(herCircleLeafletMap));
        circleRouteLines.push(L.marker(dest).bindTooltip('Destination').addTo(herCircleLeafletMap));
    }
    const layers=[circleMeetupMarker,...circleRouteLines,...herCircleMarkers];
    if(layers.length>1)herCircleLeafletMap.fitBounds(L.featureGroup(layers).getBounds().pad(0.2));
}

// ===============================
// INITIALIZATION
// ===============================

window.addEventListener('DOMContentLoaded',()=>{
    applyTheme(currentThemeMode);
    renderAllFriends();
    setupLocationSuggestions();
    renderTransitStages();
    renderSafeTabLists();
    renderLocalEvents();
    syncPlannerEndpoints();
});

let plannerHazardLayer = null;
function renderRouteHazards(hazards, demo) {
    const container = document.getElementById('routeHazards');
    if (!container) return;
    if (herPlannerLeafletMap && plannerHazardLayer) herPlannerLeafletMap.removeLayer(plannerHazardLayer);
    plannerHazardLayer = herPlannerLeafletMap ? L.layerGroup().addTo(herPlannerLeafletMap) : null;
    if (!hazards.length) {
        container.textContent = 'No coordinate-confirmed hazard reports are available for this route. This does not mean the route is safe.';
        return;
    }
    container.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = demo ? 'FICTIONAL DEMONSTRATION HAZARDS' : 'Route-adjacent reports (unverified)';
    container.append(heading);
    hazards.forEach(h => {
        const p = document.createElement('p');
        p.textContent = `${h.type}: ${h.description}`;
        p.style.marginTop = '8px';
        container.append(p);
        if (plannerHazardLayer && Number.isFinite(h.lat) && Number.isFinite(h.lng)) {
            L.circleMarker([h.lat,h.lng], {radius:9,color:'#E53950',fillOpacity:.75})
              .bindPopup(`${escapeRouteText(h.type)} — ${escapeRouteText(h.status)}`)
              .addTo(plannerHazardLayer);
        }
    });
}

function loadKashmereDemo() {
    document.getElementById('plannerOriginInput').value = 'Kashmere Gate, Delhi';
    document.getElementById('plannerDestInput').value = 'Civil Lines, Delhi';
    syncPlannerEndpoints();
    findJourneyRoute(true);
}


// Permission-based device location: only shared with Google when FIND ROUTE is pressed.
function useCurrentLocation(){
    if(!navigator.geolocation){showToast('Location is not supported in this browser');return;}
    showRouteStatus('Requesting location permission…');
    navigator.geolocation.getCurrentPosition(position=>{
        const lat=position.coords.latitude, lng=position.coords.longitude;
        gpsOrigin={label:`My location (${lat.toFixed(5)}, ${lng.toFixed(5)})`,coords:{latitude:lat,longitude:lng}};
        document.getElementById('plannerOriginInput').value=gpsOrigin.label;
        if(herPlannerLeafletMap)herPlannerLeafletMap.setView([lat,lng],15);
        demoHostLocation=[lat,lng];
        renderHerCircleMapMarkers();
        syncPlannerEndpoints();
        showRouteStatus('Current location ready. Enter your destination and select FIND ROUTE.');
    },err=>showRouteStatus('Location unavailable: '+err.message,true),{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
}

let contextLoadCounter=0;
async function refreshRouteContext(route){
    if(!route?.encodedPolyline)return;
    const seq=++contextLoadCounter;
    const placeStatus=document.getElementById('nearbyPlaceStatus');
    if(placeStatus)placeStatus.textContent='Searching for hospitals, restaurants, cafés and other places near your selected route…';
    currentRoutePlaces=[];
    renderSafeTabLists();
    if(herPlannerLeafletMap && routePlacesLayer)herPlannerLeafletMap.removeLayer(routePlacesLayer);
    routePlacesLayer=herPlannerLeafletMap?L.layerGroup().addTo(herPlannerLeafletMap):null;
    try{
        const [places, reports]=await Promise.all([
            apiRequest('/route-places',{method:'POST',body:JSON.stringify({encodedPolyline:route.encodedPolyline})}),
            route.demo?Promise.resolve({hazards:[]}):apiRequest('/route-hazards?polyline='+encodeURIComponent(route.encodedPolyline))
        ]);
        if(seq!==contextLoadCounter)return;
        currentRoutePlaces=places.places||[];
        if(placeStatus)placeStatus.textContent=places.message||'OpenStreetMap places near your route. Not safety-verified.';
        renderSafeTabLists();
        if(routePlacesLayer)currentRoutePlaces.forEach(p=>L.circleMarker([p.lat,p.lng],{radius:6,color:'#10B981',fillOpacity:.75}).bindPopup(`${escapeRouteText(p.name)} · ${escapeRouteText(p.type)}`).addTo(routePlacesLayer));
        renderRouteHazards(reports.hazards||[],false);
        if((reports.hazards||[]).length)hazardReportsList=reports.hazards.map(h=>({...h,loc:h.location,desc:h.description}));
        else {const all=await apiRequest('/community-hazards');hazardReportsList=(all.hazards||[]).map(h=>({...h,loc:h.location,desc:h.description}));}
        renderSafeTabLists();
    }catch(e){if(seq===contextLoadCounter && placeStatus)placeStatus.textContent='Nearby places unavailable. Route guidance is unaffected.';}
}


// HER SHIELD 3 — user-controlled notifications, place search, and map tools.
function toggleMapExpanded(){
    const shell=document.getElementById('plannerMapShell');
    if(!shell)return;
    shell.classList.toggle('map-expanded');
    document.getElementById('expandMapBtn').textContent=shell.classList.contains('map-expanded')?'✕ Close expanded map':'⛶ Expand map';
    setTimeout(()=>herPlannerLeafletMap?.invalidateSize(),180);
}
function notifyGuardianCheckIn(){
    const phones=guardiansList.map(g=>String(g.phone||'').replace(/[^+0-9]/g,'')).filter(Boolean);
    if(!phones.length){showToast('Check-in saved. Add a trusted contact to notify them.');return;}
    const name=localStorage.getItem('hershield_user_name')||'HerShield user';
    const loc=gpsOrigin?` My last GPS position: https://www.openstreetmap.org/?mlat=${gpsOrigin.coords.latitude}&mlon=${gpsOrigin.coords.longitude}`:'';
    const message=`${name} checked in as safe on HerShield at ${new Date().toLocaleString()}.${loc}`;
    const target=`sms:${phones.join(',')}?body=${encodeURIComponent(message)}`;
    if(confirm('Your check-in was saved. Open your SMS app to notify your trusted contacts? Sending requires your confirmation.'))window.location.href=target;
}
function alertFriend(id){
    const friend=friendsData.find(f=>f.id===id);
    if(!friend)return;
    let phone=friend.phone||'';
    if(!phone){phone=prompt(`Enter ${friend.name}'s phone number to open an SMS alert:`)||'';}
    if(!phone){showToast('Add a phone number for this friend to send an alert.');return;}
    const message=`Hi ${friend.name}, please check in with me on HerShield when you can.`;
    window.location.href=`sms:${phone.replace(/[^+0-9]/g,'')}?body=${encodeURIComponent(message)}`;
}
let suggestTimer=null, suggestSeq=0;
function setupLocationSuggestions(){
    [['plannerOriginInput','originSuggestions'],['plannerDestInput','destinationSuggestions']].forEach(([inputId,containerId])=>{
        const input=document.getElementById(inputId), container=document.getElementById(containerId);
        if(!input||!container)return;
        input.addEventListener('input',()=>{
            clearTimeout(suggestTimer);const seq=++suggestSeq;
            container.replaceChildren();
            if(inputId==='plannerOriginInput')gpsOrigin=null;
            if(input.value.trim().length<3)return;
            suggestTimer=setTimeout(async()=>{
                try{
                    const response=await apiRequest('/location-suggest?q='+encodeURIComponent(input.value.trim()));
                    if(seq!==suggestSeq)return;
                    container.replaceChildren();
                    (response.suggestions||[]).forEach(place=>{
                        const button=document.createElement('button');button.type='button';button.textContent=place.name;
                        button.addEventListener('click',()=>{input.value=place.name;container.replaceChildren();syncPlannerEndpoints();});
                        container.appendChild(button);
                    });
                }catch(e){container.replaceChildren();}
            },950);
        });
    });
}
async function updateGroupPlanMap(destination){
    const query=String(destination||'').split('•')[0].trim();
    if(!query)return;
    try{
        const result=await apiRequest('/location-suggest?q='+encodeURIComponent(query));
        if(result.suggestions?.length){
            const loc=result.suggestions[0];window.groupMeetupCoordinates=[loc.lat,loc.lng];window.groupDestinationCoordinates=null;
            renderHerCircleMapMarkers();drawMeetupMap();
        }
    }catch(e){showToast('Could not locate group destination on map');}
}

// Her Shield 4: load community reports independently of route-provider availability.
async function loadCommunityHazards(){
    try{
        const data=await apiRequest('/community-hazards');
        if(!currentJourneyRoutes.length){hazardReportsList=(data.hazards||[]).map(h=>({...h,loc:h.location,desc:h.description}));renderSafeTabLists();}
    }catch(e){console.warn('Could not load community reports',e);}
}
window.addEventListener('DOMContentLoaded',loadCommunityHazards);
