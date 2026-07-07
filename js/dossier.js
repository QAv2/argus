// dossier.js — Side panel for entity/location details

const Dossier = (() => {
  const panel = document.getElementById('dossier-panel');
  const titleEl = document.getElementById('dossier-title');
  const bodyEl = document.getElementById('dossier-body');
  let currentId = null;
  let previousFocus = null;

  function init() {
    document.getElementById('dossier-close').addEventListener('click', close);
  }

  function openPanel() {
    previousFocus = document.activeElement;
    panel.classList.add('open');
    panel.focus();
  }

  function showBase(baseId) {
    const base = Bases.getBaseById(baseId);
    if (!base) return;

    currentId = baseId;
    titleEl.textContent = base.name;

    const tierColor = getTierColor(base.evidence_tier);

    let html = `
      <div class="dossier-type-tag" style="background:${tierColor}22;color:${tierColor}">
        ${base.type.replace(/_/g, ' ')}
      </div>

      ${renderPhoto(base.photo_url, base.name)}

      <div class="dossier-field">
        <div class="dossier-field-label">Evidence Tier</div>
        <div class="dossier-field-value">
          <span class="tier-badge ${base.evidence_tier}">${base.evidence_tier}</span>
        </div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${base.lat.toFixed(4)}, ${base.lon.toFixed(4)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Depth Estimate</div>
        <div class="dossier-field-value">${esc(base.depth_estimate)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Primary Source</div>
        <div class="dossier-field-value">${esc(base.source)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Notes</div>
        <div class="dossier-field-value">${esc(base.notes)}</div>
      </div>
    `;

    // Connected facilities
    if (base.connections && base.connections.length > 0) {
      html += `
        <div class="dossier-field">
          <div class="dossier-field-label">Connected Facilities</div>
          <ul class="dossier-connections">
            ${base.connections.map(id => {
              const connected = Bases.getBaseById(id);
              const name = connected ? connected.name : id;
              return `<li data-base-id="${esc(id)}">${esc(name)}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    // Earthquake correlation
    const viewer = Globe.getViewer();
    const nearby = Bases.showCorrelation(viewer, baseId);

    if (nearby.length > 0) {
      html += `
        <div class="correlation-alert">
          <div class="correlation-alert-title">Seismic Activity (${Bases.getData().length ? '150' : '—'}km radius)</div>
          ${nearby.slice(0, 5).map(q => {
            const mag = q.properties.mag;
            const place = q.properties.place || 'Unknown';
            const dist = q.distance.toFixed(0);
            const depth = q.geometry.coordinates[2];
            return `<div class="correlation-alert-item">M${mag.toFixed(1)} — ${esc(place)} (${dist}km, ${depth.toFixed(0)}km deep)</div>`;
          }).join('')}
          ${nearby.length > 5 ? `<div class="correlation-alert-item" style="color:var(--text-tertiary)">+ ${nearby.length - 5} more</div>` : ''}
        </div>
      `;
    }

    bodyEl.innerHTML = html;
    openPanel();

    // Connection click handlers
    bodyEl.querySelectorAll('.dossier-connections li').forEach(li => {
      li.addEventListener('click', () => {
        const id = li.getAttribute('data-base-id');
        const connected = Bases.getBaseById(id);
        if (connected) {
          Globe.flyTo(connected.lon, connected.lat, 50000, 1.5);
          showBase(id);
        }
      });
    });
  }

  function showMilitary(baseId) {
    const base = Military.getBaseById(baseId);
    if (!base) return;

    currentId = baseId;
    titleEl.textContent = base.name;

    const branchColors = {
      army: '#8b5cf6',
      navy: '#3b82f6',
      air_force: '#06b6d4',
      marines: '#ef4444',
      space_force: '#a855f7',
      joint: '#f59e0b',
      intelligence: '#ec4899',
      foreign_military: '#6b7280',
    };
    const branchColor = branchColors[base.branch] || '#6b7280';
    const branchLabel = base.branch ? base.branch.replace(/_/g, ' ') : 'unknown';
    const typeLabel = base.type ? base.type.replace(/_/g, ' ') : 'unknown';

    let html = `
      <div class="dossier-type-tag" style="background:${branchColor}22;color:${branchColor}">
        ${branchLabel}
      </div>

      ${renderPhoto(base.photo_url, base.name)}

      <div class="dossier-field">
        <div class="dossier-field-label">Installation Type</div>
        <div class="dossier-field-value">${esc(typeLabel)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Operator</div>
        <div class="dossier-field-value">${esc(base.operator)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Country</div>
        <div class="dossier-field-value">${esc(base.country)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Status</div>
        <div class="dossier-field-value">${esc(base.status)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${base.lat.toFixed(4)}, ${base.lon.toFixed(4)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Notes</div>
        <div class="dossier-field-value">${esc(base.notes)}</div>
      </div>
    `;

    bodyEl.innerHTML = html;
    openPanel();
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showIntel(entityId) {
    const ent = Intel.getEntityById(entityId);
    if (!ent) return;

    currentId = entityId;
    titleEl.textContent = ent.name;

    // Branch on source
    if (ent.source === 'intel-console') {
      showConsoleIntel(ent);
    } else {
      showCuratedIntel(ent);
    }

    openPanel();
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showCuratedIntel(ent) {
    const tierColor = getTierColor(ent.tier);
    const typeColors = {
      facility: '#f5b942',
      organization: '#c084fc',
      location: '#fbbf24',
      person: '#f87171',
    };
    const typeColor = typeColors[ent.type] || '#f5b942';

    let html = `
      <div class="dossier-type-tag" style="background:${typeColor}22;color:${typeColor}">
        ${ent.type}
      </div>

      ${renderPhoto(ent.photo_url, ent.name)}

      <div class="dossier-field">
        <div class="dossier-field-label">Evidence Tier</div>
        <div class="dossier-field-value">
          <span class="tier-badge ${ent.tier}">${ent.tier}</span>
        </div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${ent.lat.toFixed(4)}, ${ent.lon.toFixed(4)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Description</div>
        <div class="dossier-field-value">${esc(ent.description)}</div>
      </div>
    `;

    bodyEl.innerHTML = html;
  }

  function showConsoleIntel(ent) {
    const consoleColors = {
      facility: '#f59e0b',
      organization: '#ec4899',
      agency: '#ef4444',
      person: '#a78bfa',
    };
    const typeColor = consoleColors[ent.type] || '#f59e0b';

    const signals = Intel.getSignalsForEntity(ent.id);

    let html = `
      <div class="dossier-type-tag" style="background:${typeColor}22;color:${typeColor}">
        ${ent.type}
      </div>

      ${renderPhoto(ent.photo_url, ent.name)}

      <div class="dossier-field">
        <div class="dossier-field-label">Evidence Tier</div>
        <div class="dossier-field-value">
          <span class="tier-badge ${ent.tier}">${ent.tier}</span>
        </div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${ent.lat.toFixed(4)}, ${ent.lon.toFixed(4)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Network Centrality</div>
        <div class="dossier-field-value">${(ent.centrality || 0).toFixed(4)} (${ent.connection_count || 0} connections)</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Description</div>
        <div class="dossier-field-value">${esc(ent.description)}</div>
      </div>
    `;

    // Recent signals
    if (signals.length > 0) {
      const shown = signals.slice(0, 5);
      html += `
        <div class="dossier-field">
          <div class="dossier-field-label">Recent Signals (${signals.length})</div>
          <div class="signal-feed">
            ${shown.map(s => {
              const time = s.collected_at ? new Date(s.collected_at).toISOString().replace('T', ' ').slice(0, 16) : '';
              const safe = safeHref(s.url);
              const headline = safe
                ? `<a class="signal-headline" href="${esc(safe)}" target="_blank" rel="noopener">${esc(s.headline)}</a>`
                : `<span class="signal-headline">${esc(s.headline)}</span>`;
              return `<div class="signal-item">
                <span class="signal-feed-badge">${esc(s.source_feed)}</span>
                ${headline}
                <span class="signal-time">${time}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Console link
    html += `
      <a class="console-link" href="https://qav2.github.io/intel-console/" target="_blank" rel="noopener">
        Open in Intel Console
      </a>
    `;

    bodyEl.innerHTML = html;
  }

  function showEarthquake(props) {
    currentId = null;
    const mag = props.magnitude?.getValue ? props.magnitude.getValue() : props.magnitude;
    const depth = props.depth?.getValue ? props.depth.getValue() : props.depth;
    const place = props.place?.getValue ? props.place.getValue() : props.place;
    const time = props.time?.getValue ? props.time.getValue() : props.time;
    const url = props.url?.getValue ? props.url.getValue() : props.url;

    titleEl.textContent = `M${Number(mag).toFixed(1)} Earthquake`;

    const date = new Date(time);

    let html = `
      <div class="dossier-type-tag" style="background:#fbbf2422;color:var(--quake-shallow)">
        earthquake
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Magnitude</div>
        <div class="dossier-field-value">${Number(mag).toFixed(1)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Depth</div>
        <div class="dossier-field-value">${Number(depth).toFixed(1)} km</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Location</div>
        <div class="dossier-field-value">${esc(String(place))}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Time (UTC)</div>
        <div class="dossier-field-value">${date.toISOString().replace('T', ' ').slice(0, 19)}</div>
      </div>

      ${(() => {
        const safe = safeHref(url);
        return safe ? `
      <div class="dossier-field">
        <div class="dossier-field-label">USGS Detail</div>
        <div class="dossier-field-value"><a href="${esc(safe)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(String(url))}</a></div>
      </div>` : '';
      })()}
    `;

    bodyEl.innerHTML = html;
    openPanel();
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showAircraft(props) {
    currentId = null;
    const callsign = props.callsign?.getValue ? props.callsign.getValue() : props.callsign;
    const hex = props.hex?.getValue ? props.hex.getValue() : props.hex;
    const isMil = props.isMilitary?.getValue ? props.isMilitary.getValue() : props.isMilitary;
    const alt = props.altitude?.getValue ? props.altitude.getValue() : props.altitude;
    const speed = props.speed?.getValue ? props.speed.getValue() : props.speed;
    const heading = props.heading?.getValue ? props.heading.getValue() : props.heading;
    const squawk = props.squawk?.getValue ? props.squawk.getValue() : props.squawk;
    const reg = props.registration?.getValue ? props.registration.getValue() : props.registration;
    const acType = props.aircraftType?.getValue ? props.aircraftType.getValue() : props.aircraftType;
    const operator = props.operator?.getValue ? props.operator.getValue() : props.operator;
    const country = props.originCountry?.getValue ? props.originCountry.getValue() : props.originCountry;

    titleEl.textContent = callsign || hex || 'Aircraft';

    const tagColor = isMil ? 'var(--aircraft-mil)' : 'var(--aircraft-civil)';

    let html = `
      <div class="dossier-type-tag" style="background:${tagColor}22;color:${tagColor}">
        ${isMil ? 'military' : 'civilian'} aircraft
      </div>

      ${callsign ? `<div class="dossier-field"><div class="dossier-field-label">Callsign</div><div class="dossier-field-value">${esc(String(callsign))}</div></div>` : ''}
      ${hex ? `<div class="dossier-field"><div class="dossier-field-label">ICAO Hex</div><div class="dossier-field-value">${esc(String(hex))}</div></div>` : ''}
      ${reg ? `<div class="dossier-field"><div class="dossier-field-label">Registration</div><div class="dossier-field-value">${esc(String(reg))}</div></div>` : ''}
      ${acType ? `<div class="dossier-field"><div class="dossier-field-label">Type</div><div class="dossier-field-value">${esc(String(acType))}</div></div>` : ''}
      ${operator ? `<div class="dossier-field"><div class="dossier-field-label">Operator</div><div class="dossier-field-value">${esc(String(operator))}</div></div>` : ''}
      ${country ? `<div class="dossier-field"><div class="dossier-field-label">Origin</div><div class="dossier-field-value">${esc(String(country))}</div></div>` : ''}
      <div class="dossier-field"><div class="dossier-field-label">Altitude</div><div class="dossier-field-value">${alt ? (Number(alt) * 3.28084).toFixed(0) + ' ft' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Ground Speed</div><div class="dossier-field-value">${speed ? Number(speed).toFixed(0) + ' kts' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Heading</div><div class="dossier-field-value">${heading ? Number(heading).toFixed(0) + '°' : '—'}</div></div>
      ${squawk ? `<div class="dossier-field"><div class="dossier-field-label">Squawk</div><div class="dossier-field-value">${esc(String(squawk))}</div></div>` : ''}
    `;

    bodyEl.innerHTML = html;
    openPanel();
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showSatellite(props) {
    currentId = null;
    const name = props.name?.getValue ? props.name.getValue() : props.name;
    const noradId = props.noradId?.getValue ? props.noradId.getValue() : props.noradId;
    const objectType = props.objectType?.getValue ? props.objectType.getValue() : props.objectType;
    const period = props.period?.getValue ? props.period.getValue() : props.period;
    const inclination = props.inclination?.getValue ? props.inclination.getValue() : props.inclination;
    const apogee = props.apogee?.getValue ? props.apogee.getValue() : props.apogee;
    const perigee = props.perigee?.getValue ? props.perigee.getValue() : props.perigee;

    titleEl.textContent = name || 'Satellite';

    let html = `
      <div class="dossier-type-tag" style="background:#60a5fa22;color:var(--sat-color)">
        satellite
      </div>

      ${name ? `<div class="dossier-field"><div class="dossier-field-label">Name</div><div class="dossier-field-value">${esc(String(name))}</div></div>` : ''}
      ${noradId ? `<div class="dossier-field"><div class="dossier-field-label">NORAD ID</div><div class="dossier-field-value">${noradId}</div></div>` : ''}
      ${objectType ? `<div class="dossier-field"><div class="dossier-field-label">Object Type</div><div class="dossier-field-value">${esc(String(objectType))}</div></div>` : ''}
      ${period ? `<div class="dossier-field"><div class="dossier-field-label">Orbital Period</div><div class="dossier-field-value">${Number(period).toFixed(1)} min</div></div>` : ''}
      ${inclination ? `<div class="dossier-field"><div class="dossier-field-label">Inclination</div><div class="dossier-field-value">${Number(inclination).toFixed(1)}°</div></div>` : ''}
      ${apogee ? `<div class="dossier-field"><div class="dossier-field-label">Apogee</div><div class="dossier-field-value">${Number(apogee).toFixed(0)} km</div></div>` : ''}
      ${perigee ? `<div class="dossier-field"><div class="dossier-field-label">Perigee</div><div class="dossier-field-value">${Number(perigee).toFixed(0)} km</div></div>` : ''}
    `;

    bodyEl.innerHTML = html;
    openPanel();
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showVessel(props) {
    currentId = null;
    const mmsi = props.mmsi?.getValue ? props.mmsi.getValue() : props.mmsi;
    const name = props.name?.getValue ? props.name.getValue() : props.name;
    const callsign = props.callsign?.getValue ? props.callsign.getValue() : props.callsign;
    const shipType = props.shipType?.getValue ? props.shipType.getValue() : props.shipType;
    const flag = props.flag?.getValue ? props.flag.getValue() : props.flag;
    const lat = props.lat?.getValue ? props.lat.getValue() : props.lat;
    const lon = props.lon?.getValue ? props.lon.getValue() : props.lon;
    const speed = props.speed?.getValue ? props.speed.getValue() : props.speed;
    const course = props.course?.getValue ? props.course.getValue() : props.course;
    const heading = props.heading?.getValue ? props.heading.getValue() : props.heading;
    const status = props.status?.getValue ? props.status.getValue() : props.status;
    const lastUpdate = props.lastUpdate?.getValue ? props.lastUpdate.getValue() : props.lastUpdate;

    titleEl.textContent = name || `MMSI ${mmsi}`;

    const navStatus = Vessels.getNavStatusText(status);
    const updateTime = lastUpdate ? new Date(lastUpdate).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
    const typeColorHex = Vessels.getTypeColorHex(shipType);
    const typeName = Vessels.getShipTypeName(shipType);
    const flagEmoji = Vessels.countryToFlag(flag);

    let html = `
      <div class="dossier-type-tag" style="background:${typeColorHex}22;color:${typeColorHex}">
        ${esc(typeName)}
      </div>

      ${name ? `<div class="dossier-field"><div class="dossier-field-label">Vessel Name</div><div class="dossier-field-value">${esc(String(name))}</div></div>` : ''}
      <div class="dossier-field"><div class="dossier-field-label">MMSI</div><div class="dossier-field-value">${esc(String(mmsi))}</div></div>
      ${callsign ? `<div class="dossier-field"><div class="dossier-field-label">Callsign</div><div class="dossier-field-value">${esc(String(callsign))}</div></div>` : ''}
      ${flag ? `<div class="dossier-field"><div class="dossier-field-label">Flag</div><div class="dossier-field-value">${flagEmoji ? flagEmoji + ' ' : ''}${esc(String(flag))}</div></div>` : ''}
      ${shipType != null ? `<div class="dossier-field"><div class="dossier-field-label">Ship Type</div><div class="dossier-field-value">${esc(typeName)} (${shipType})</div></div>` : ''}
      <div class="dossier-field"><div class="dossier-field-label">Speed</div><div class="dossier-field-value">${speed != null ? Number(speed).toFixed(1) + ' kts' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Course</div><div class="dossier-field-value">${course != null ? Number(course).toFixed(0) + '°' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Heading</div><div class="dossier-field-value">${heading != null ? Number(heading).toFixed(0) + '°' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Nav Status</div><div class="dossier-field-value">${esc(navStatus)}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Coordinates</div><div class="dossier-field-value">${lat != null ? Number(lat).toFixed(4) : '—'}, ${lon != null ? Number(lon).toFixed(4) : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Last Update</div><div class="dossier-field-value">${updateTime}</div></div>
    `;

    bodyEl.innerHTML = html;
    openPanel();
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showConflict(props) {
    currentId = null;
    const id = props.id?.getValue ? props.id.getValue() : props.id;
    const name = props.name?.getValue ? props.name.getValue() : props.name;
    const eventType = props.eventType?.getValue ? props.eventType.getValue() : props.eventType;
    const theater = props.theater?.getValue ? props.theater.getValue() : props.theater;
    const date = props.date?.getValue ? props.date.getValue() : props.date;
    const operation = props.operation?.getValue ? props.operation.getValue() : props.operation;
    const parties = props.parties?.getValue ? props.parties.getValue() : props.parties;
    const target = props.target?.getValue ? props.target.getValue() : props.target;
    const casualties = props.casualties?.getValue ? props.casualties.getValue() : props.casualties;
    const description = props.description?.getValue ? props.description.getValue() : props.description;
    const eventSources = props.eventSources?.getValue ? props.eventSources.getValue() : props.eventSources;
    const eventColor = props.eventColor?.getValue ? props.eventColor.getValue() : props.eventColor;
    const lat = props.lat?.getValue ? props.lat.getValue() : props.lat;
    const lon = props.lon?.getValue ? props.lon.getValue() : props.lon;
    const photoUrl = props.photoUrl?.getValue ? props.photoUrl.getValue() : props.photoUrl;

    titleEl.textContent = name || 'Conflict Event';

    const color = eventColor || '#ef4444';
    const typeLabel = eventType ? eventType.replace(/_/g, ' ') : 'event';
    const dateStr = date ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';

    let html = `
      <div class="dossier-type-tag" style="background:${color}22;color:${color}">
        ${esc(typeLabel)}
      </div>

      ${renderPhoto(photoUrl, name)}

      ${theater ? `<div class="dossier-field"><div class="dossier-field-label">Theater</div><div class="dossier-field-value" style="text-transform:capitalize">${esc(String(theater).replace(/-/g, ' '))}</div></div>` : ''}

      <div class="dossier-field">
        <div class="dossier-field-label">Date</div>
        <div class="dossier-field-value">${dateStr}</div>
      </div>

      ${operation ? `<div class="dossier-field"><div class="dossier-field-label">Operation</div><div class="dossier-field-value">${esc(String(operation))}</div></div>` : ''}
      ${parties ? `<div class="dossier-field"><div class="dossier-field-label">Parties</div><div class="dossier-field-value">${esc(String(parties))}</div></div>` : ''}
      ${target ? `<div class="dossier-field"><div class="dossier-field-label">Target</div><div class="dossier-field-value">${esc(String(target))}</div></div>` : ''}
      ${casualties ? `<div class="dossier-field"><div class="dossier-field-label">Casualties</div><div class="dossier-field-value">${esc(String(casualties))}</div></div>` : ''}

      <div class="dossier-field">
        <div class="dossier-field-label">Description</div>
        <div class="dossier-field-value">${esc(String(description || ''))}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${lat != null ? Number(lat).toFixed(4) : '—'}, ${lon != null ? Number(lon).toFixed(4) : '—'}</div>
      </div>

      ${eventSources ? `<div class="dossier-field"><div class="dossier-field-label">Sources</div><div class="dossier-field-value" style="font-size:0.85em;color:var(--text-secondary)">${esc(String(eventSources))}</div></div>` : ''}
    `;

    bodyEl.innerHTML = html;
    openPanel();
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showAntarctica(props) {
    currentId = null;
    const subType = props.subType?.getValue ? props.subType.getValue() : props.subType;
    const name = props.name?.getValue ? props.name.getValue() : props.name;

    titleEl.textContent = name || 'Antarctica';

    let html = '';
    const antColor = '#38bdf8';

    switch (subType) {
      case 'station': {
        const country = props.country?.getValue ? props.country.getValue() : props.country;
        const year = props.year?.getValue ? props.year.getValue() : props.year;
        const seasonality = props.seasonality?.getValue ? props.seasonality.getValue() : props.seasonality;
        const status = props.stationStatus?.getValue ? props.stationStatus.getValue() : props.stationStatus;
        const stnType = props.stationType?.getValue ? props.stationType.getValue() : props.stationType;
        const pop = props.peakPop?.getValue ? props.peakPop.getValue() : props.peakPop;
        const elev = props.elevation?.getValue ? props.elevation.getValue() : props.elevation;
        const notes = props.notes?.getValue ? props.notes.getValue() : props.notes;
        const lat = props.lat?.getValue ? props.lat.getValue() : props.lat;
        const lon = props.lon?.getValue ? props.lon.getValue() : props.lon;
        const photoUrl = props.photoUrl?.getValue ? props.photoUrl.getValue() : props.photoUrl;
        const webcamUrl = props.webcamUrl?.getValue ? props.webcamUrl.getValue() : props.webcamUrl;

        html = `
          <div class="dossier-type-tag" style="background:${antColor}22;color:${antColor}">research station</div>
          ${renderPhoto(photoUrl, name)}
          <div class="dossier-field"><div class="dossier-field-label">Country</div><div class="dossier-field-value">${esc(String(country || ''))}</div></div>
          ${year ? `<div class="dossier-field"><div class="dossier-field-label">Established</div><div class="dossier-field-value">${year}</div></div>` : ''}
          <div class="dossier-field"><div class="dossier-field-label">Seasonality</div><div class="dossier-field-value">${esc(String(seasonality || ''))}</div></div>
          <div class="dossier-field"><div class="dossier-field-label">Status</div><div class="dossier-field-value">${esc(String(status || ''))}</div></div>
          ${stnType ? `<div class="dossier-field"><div class="dossier-field-label">Type</div><div class="dossier-field-value">${esc(String(stnType))}</div></div>` : ''}
          ${pop ? `<div class="dossier-field"><div class="dossier-field-label">Peak Population</div><div class="dossier-field-value">${pop}</div></div>` : ''}
          ${elev != null ? `<div class="dossier-field"><div class="dossier-field-label">Elevation</div><div class="dossier-field-value">${elev}m</div></div>` : ''}
          <div class="dossier-field"><div class="dossier-field-label">Coordinates</div><div class="dossier-field-value">${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}</div></div>
          ${webcamUrl ? `<div class="dossier-field"><div class="dossier-field-label">Webcam</div><div class="dossier-field-value"><a href="${esc(webcamUrl)}" target="_blank" rel="noopener" style="color:${antColor}">View live</a></div></div>` : ''}
          ${notes ? `<div class="dossier-field"><div class="dossier-field-label">Notes</div><div class="dossier-field-value">${esc(String(notes))}</div></div>` : ''}
        `;
        break;
      }

      case 'claim': {
        const country = props.country?.getValue ? props.country.getValue() : props.country;
        const yearClaimed = props.yearClaimed?.getValue ? props.yearClaimed.getValue() : props.yearClaimed;
        const notes = props.notes?.getValue ? props.notes.getValue() : props.notes;

        html = `
          <div class="dossier-type-tag" style="background:#a78bfa22;color:#a78bfa">territorial claim</div>
          <div class="dossier-field"><div class="dossier-field-label">Claimant</div><div class="dossier-field-value">${esc(String(country || ''))}</div></div>
          ${yearClaimed ? `<div class="dossier-field"><div class="dossier-field-label">Year Claimed</div><div class="dossier-field-value">${yearClaimed}</div></div>` : ''}
          ${notes ? `<div class="dossier-field"><div class="dossier-field-label">Notes</div><div class="dossier-field-value">${esc(String(notes))}</div></div>` : ''}
        `;
        break;
      }

      case 'historic': {
        const year = props.year?.getValue ? props.year.getValue() : props.year;
        const expedition = props.expedition?.getValue ? props.expedition.getValue() : props.expedition;
        const explorer = props.explorer?.getValue ? props.explorer.getValue() : props.explorer;
        const hsm = props.hsm?.getValue ? props.hsm.getValue() : props.hsm;
        const notes = props.notes?.getValue ? props.notes.getValue() : props.notes;
        const lat = props.lat?.getValue ? props.lat.getValue() : props.lat;
        const lon = props.lon?.getValue ? props.lon.getValue() : props.lon;

        html = `
          <div class="dossier-type-tag" style="background:#d9770622;color:#d97706">historic site</div>
          ${explorer ? `<div class="dossier-field"><div class="dossier-field-label">Explorer</div><div class="dossier-field-value">${esc(String(explorer))}</div></div>` : ''}
          ${expedition ? `<div class="dossier-field"><div class="dossier-field-label">Expedition</div><div class="dossier-field-value">${esc(String(expedition))}</div></div>` : ''}
          ${year ? `<div class="dossier-field"><div class="dossier-field-label">Year</div><div class="dossier-field-value">${year}</div></div>` : ''}
          ${hsm ? `<div class="dossier-field"><div class="dossier-field-label">HSM Number</div><div class="dossier-field-value">${hsm}</div></div>` : ''}
          <div class="dossier-field"><div class="dossier-field-label">Coordinates</div><div class="dossier-field-value">${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}</div></div>
          ${notes ? `<div class="dossier-field"><div class="dossier-field-label">Notes</div><div class="dossier-field-value">${esc(String(notes))}</div></div>` : ''}
        `;
        break;
      }

      case 'military': {
        const opName = props.operationName?.getValue ? props.operationName.getValue() : props.operationName;
        const dates = props.dates?.getValue ? props.dates.getValue() : props.dates;
        const commander = props.commander?.getValue ? props.commander.getValue() : props.commander;
        const personnel = props.personnel?.getValue ? props.personnel.getValue() : props.personnel;
        const ships = props.ships?.getValue ? props.ships.getValue() : props.ships;
        const aircraft = props.aircraft?.getValue ? props.aircraft.getValue() : props.aircraft;
        const notes = props.notes?.getValue ? props.notes.getValue() : props.notes;
        const earlyTerm = props.earlyTermination?.getValue ? props.earlyTermination.getValue() : props.earlyTermination;
        const earlyTermReason = props.earlyTerminationReason?.getValue ? props.earlyTerminationReason.getValue() : props.earlyTerminationReason;
        const byrdQuote = props.byrdQuote?.getValue ? props.byrdQuote.getValue() : props.byrdQuote;
        const quoteCaveat = props.quoteCaveat?.getValue ? props.quoteCaveat.getValue() : props.quoteCaveat;
        const lat = props.lat?.getValue ? props.lat.getValue() : props.lat;
        const lon = props.lon?.getValue ? props.lon.getValue() : props.lon;

        html = `
          <div class="dossier-type-tag" style="background:#ef444422;color:#ef4444">military operation</div>
          <div class="dossier-field"><div class="dossier-field-label">Operation</div><div class="dossier-field-value">${esc(String(opName || ''))}</div></div>
          ${dates ? `<div class="dossier-field"><div class="dossier-field-label">Dates</div><div class="dossier-field-value">${esc(String(dates))}</div></div>` : ''}
          ${commander ? `<div class="dossier-field"><div class="dossier-field-label">Commander</div><div class="dossier-field-value">${esc(String(commander))}</div></div>` : ''}
          ${personnel ? `<div class="dossier-field"><div class="dossier-field-label">Personnel</div><div class="dossier-field-value">${personnel}</div></div>` : ''}
          ${ships ? `<div class="dossier-field"><div class="dossier-field-label">Ships</div><div class="dossier-field-value">${ships}</div></div>` : ''}
          ${aircraft ? `<div class="dossier-field"><div class="dossier-field-label">Aircraft</div><div class="dossier-field-value">${aircraft}</div></div>` : ''}
          <div class="dossier-field"><div class="dossier-field-label">Coordinates</div><div class="dossier-field-value">${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}</div></div>
          ${notes ? `<div class="dossier-field"><div class="dossier-field-label">Location Notes</div><div class="dossier-field-value">${esc(String(notes))}</div></div>` : ''}
          ${earlyTerm ? `<div class="dossier-field"><div class="dossier-field-label">Early Termination</div><div class="dossier-field-value" style="color:#f87171">${esc(String(earlyTerm))}</div></div>` : ''}
          ${earlyTermReason ? `<div class="dossier-field"><div class="dossier-field-label">Reason</div><div class="dossier-field-value" style="color:#f87171">${esc(String(earlyTermReason))}</div></div>` : ''}
          ${byrdQuote ? `
            <div class="dossier-field">
              <div class="dossier-field-label">Byrd Quote (El Mercurio, 1947)</div>
              <div class="dossier-field-value" style="font-style:italic;color:var(--text-secondary)">"${esc(String(byrdQuote))}"</div>
            </div>
            ${quoteCaveat ? `<div class="dossier-field"><div class="dossier-field-label">Caveat</div><div class="dossier-field-value" style="font-size:0.85em;color:var(--text-tertiary)">${esc(String(quoteCaveat))}</div></div>` : ''}
          ` : ''}
        `;
        break;
      }

      case 'disclosure':
      case 'visit': {
        const desc = props.description?.getValue ? props.description.getValue() : props.description;
        const findings = props.findings?.getValue ? props.findings.getValue() : props.findings;
        const when = props.when?.getValue ? props.when.getValue() : props.when;
        const location = props.location?.getValue ? props.location.getValue() : props.location;
        const officialReason = props.officialReason?.getValue ? props.officialReason.getValue() : props.officialReason;
        const notes = props.notes?.getValue ? props.notes.getValue() : props.notes;
        const lat = props.lat?.getValue ? props.lat.getValue() : props.lat;
        const lon = props.lon?.getValue ? props.lon.getValue() : props.lon;

        const tagColor = subType === 'visit' ? '#a78bfa' : '#c084fc';
        const tagLabel = subType === 'visit' ? 'high-profile visit' : 'anomaly / disclosure';

        html = `
          <div class="dossier-type-tag" style="background:${tagColor}22;color:${tagColor}">${tagLabel}</div>
          ${when ? `<div class="dossier-field"><div class="dossier-field-label">When</div><div class="dossier-field-value">${esc(String(when))}</div></div>` : ''}
          ${location ? `<div class="dossier-field"><div class="dossier-field-label">Location</div><div class="dossier-field-value">${esc(String(location))}</div></div>` : ''}
          ${officialReason ? `<div class="dossier-field"><div class="dossier-field-label">Official Reason</div><div class="dossier-field-value">${esc(String(officialReason))}</div></div>` : ''}
          ${desc ? `<div class="dossier-field"><div class="dossier-field-label">Description</div><div class="dossier-field-value">${esc(String(desc))}</div></div>` : ''}
          ${findings ? `<div class="dossier-field"><div class="dossier-field-label">Findings / Evidence</div><div class="dossier-field-value" style="font-size:0.9em">${esc(String(findings))}</div></div>` : ''}
          ${lat != null ? `<div class="dossier-field"><div class="dossier-field-label">Coordinates</div><div class="dossier-field-value">${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}</div></div>` : ''}
          ${notes ? `<div class="dossier-field"><div class="dossier-field-label">Notes</div><div class="dossier-field-value" style="color:var(--text-secondary)">${esc(String(notes))}</div></div>` : ''}
        `;
        break;
      }

      case 'aspa':
      case 'asma': {
        const number = props.number?.getValue ? props.number.getValue() : props.number;
        const notes = props.notes?.getValue ? props.notes.getValue() : props.notes;
        const paType = subType === 'aspa' ? 'Specially Protected Area' : 'Specially Managed Area';

        html = `
          <div class="dossier-type-tag" style="background:#34d39922;color:#34d399">${paType.toLowerCase()}</div>
          ${number ? `<div class="dossier-field"><div class="dossier-field-label">${subType.toUpperCase()} Number</div><div class="dossier-field-value">${number}</div></div>` : ''}
          ${notes ? `<div class="dossier-field"><div class="dossier-field-label">Description</div><div class="dossier-field-value">${esc(String(notes))}</div></div>` : ''}
        `;
        break;
      }

      case 'geographic': {
        const notes = props.notes?.getValue ? props.notes.getValue() : props.notes;
        const elev = props.elevation?.getValue ? props.elevation.getValue() : props.elevation;
        const lat = props.lat?.getValue ? props.lat.getValue() : props.lat;
        const lon = props.lon?.getValue ? props.lon.getValue() : props.lon;

        html = `
          <div class="dossier-type-tag" style="background:#e2e8f022;color:#e2e8f0">geographic feature</div>
          ${elev != null ? `<div class="dossier-field"><div class="dossier-field-label">Elevation</div><div class="dossier-field-value">${elev}m</div></div>` : ''}
          ${lat != null ? `<div class="dossier-field"><div class="dossier-field-label">Coordinates</div><div class="dossier-field-value">${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}</div></div>` : ''}
          ${notes ? `<div class="dossier-field"><div class="dossier-field-label">Notes</div><div class="dossier-field-value">${esc(String(notes))}</div></div>` : ''}
        `;
        break;
      }

      default: {
        html = `<div class="dossier-type-tag" style="background:${antColor}22;color:${antColor}">antarctica</div>`;
      }
    }

    bodyEl.innerHTML = html;
    openPanel();
    Bases.clearCorrelation(Globe.getViewer());
  }

  function close() {
    panel.classList.remove('open');
    currentId = null;
    Bases.clearCorrelation(Globe.getViewer());
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
      previousFocus = null;
    }
  }

  function isOpen() {
    return panel.classList.contains('open');
  }

  function getTierColor(tier) {
    const colors = {
      documented: '#34d399',
      credible: '#fbbf24',
      inference: '#fb923c',
      speculative: '#f87171',
    };
    return colors[tier] || '#f5b942';
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Returns a .dossier-photo block when photoUrl resolves to an http(s) URL,
  // otherwise an empty string. Used by every show* function so any dataset
  // can opt in by adding `photo_url` to its source JSON.
  function renderPhoto(photoUrl, name) {
    const safe = safeHref(photoUrl);
    if (!safe) return '';
    return `<div class="dossier-photo"><img src="${esc(safe)}" alt="${esc(String(name || ''))}" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`;
  }

  // Returns the URL only if it parses and uses http/https. Blocks javascript:,
  // data:, and malformed URLs from reaching an href attribute.
  function safeHref(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') return url;
    } catch { /* not a valid URL */ }
    return null;
  }

  return { init, showBase, showMilitary, showIntel, showEarthquake, showAircraft, showSatellite, showVessel, showConflict, showAntarctica, close, isOpen };
})();
