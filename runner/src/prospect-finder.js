const DEFAULT_TARGETS = [
  { city: 'Fontainebleau', lat: 48.4047, lon: 2.7016, radius_m: 18000 },
  { city: 'Deauville', lat: 49.3570, lon: 0.0740, radius_m: 18000 },
  { city: 'Honfleur', lat: 49.4199, lon: 0.2329, radius_m: 16000 },
  { city: 'Saint-Malo', lat: 48.6493, lon: -2.0257, radius_m: 18000 },
  { city: 'La Rochelle', lat: 46.1603, lon: -1.1511, radius_m: 18000 },
  { city: 'Biarritz', lat: 43.4832, lon: -1.5586, radius_m: 18000 },
  { city: 'Bordeaux', lat: 44.8378, lon: -0.5792, radius_m: 18000 },
  { city: 'Annecy', lat: 45.8992, lon: 6.1294, radius_m: 18000 },
  { city: 'Colmar', lat: 48.0794, lon: 7.3585, radius_m: 16000 },
  { city: 'Strasbourg', lat: 48.5734, lon: 7.7521, radius_m: 18000 },
  { city: 'Avignon', lat: 43.9493, lon: 4.8055, radius_m: 18000 },
  { city: 'Aix-en-Provence', lat: 43.5297, lon: 5.4474, radius_m: 18000 },
  { city: 'Cannes', lat: 43.5528, lon: 7.0174, radius_m: 18000 },
  { city: 'Nice', lat: 43.7102, lon: 7.2620, radius_m: 18000 },
  { city: 'Lyon', lat: 45.7640, lon: 4.8357, radius_m: 18000 }
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

function env(name, fallback = '') {
  const value = process.env[name];
  return value == null || value === '' ? fallback : value;
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanUrl(value) {
  const raw = normalizeSpace(value);

  if (!raw) {
    return '';
  }

  try {
    const candidate =
      /^https?:\/\//i.test(raw)
        ? raw
        : `https://${raw}`;

    const url = new URL(candidate);
    url.hash = '';

    return url.toString();

  } catch {
    return '';
  }
}

function cleanEmail(value) {
  const email =
    normalizeSpace(value)
      .toLowerCase();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : '';
}

function domainOf(value) {
  try {
    return new URL(value)
      .hostname
      .toLowerCase()
      .replace(/^www\./, '');

  } catch {
    return '';
  }
}

function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableKey(hotel) {
  const domain =
    domainOf(hotel.website);

  if (domain) {
    return `domain:${domain}`;
  }

  return (
    `namecity:${slug(hotel.name)}:${slug(hotel.city)}`
  );
}

function parseTargets() {
  const json =
    env('PROSPECT_TARGETS_JSON');

  if (!json) {
    return DEFAULT_TARGETS;
  }

  try {
    const parsed =
      JSON.parse(json);

    if (
      !Array.isArray(parsed) ||
      !parsed.length
    ) {
      throw new Error(
        'empty targets'
      );
    }

    return parsed
      .map(
        item => ({
          city:
            normalizeSpace(
              item.city
            ),

          lat:
            Number(
              item.lat
            ),

          lon:
            Number(
              item.lon
            ),

          radius_m:
            Math.max(
              1000,
              Math.min(
                30000,
                Number(
                  item.radius_m ||
                  15000
                )
              )
            )
        })
      )
      .filter(
        item =>
          item.city &&
          Number.isFinite(
            item.lat
          ) &&
          Number.isFinite(
            item.lon
          )
      );

  } catch (error) {
    throw new Error(
      `PROSPECT_TARGETS_JSON invalide: ${error.message}`
    );
  }
}

function chooseTargets(targets) {
  const count =
    Math.max(
      1,
      Math.min(
        5,
        Number(
          env(
            'PROSPECT_TARGETS_PER_RUN',
            '1'
          )
        )
      )
    );

  const forced =
    env('PROSPECT_CITY');

  if (forced) {
    const match =
      targets.find(
        target =>
          target.city.toLowerCase() ===
          forced.toLowerCase()
      );

    if (!match) {
      throw new Error(
        `Ville inconnue dans PROSPECT_CITY: ${forced}`
      );
    }

    return [
      match
    ];
  }

  const day =
    Math.floor(
      Date.now() /
      86400000
    );

  const result = [];

  for (
    let i = 0;
    i < count;
    i++
  ) {
    result.push(
      targets[
        (day + i) %
        targets.length
      ]
    );
  }

  return result;
}

function buildOverpassQuery(target) {
  return `
[out:json][timeout:30];
(
  nwr["tourism"="hotel"](around:${target.radius_m},${target.lat},${target.lon});
  nwr["tourism"="guest_house"](around:${target.radius_m},${target.lat},${target.lon});
);
out center tags 350;
`.trim();
}

async function fetchOverpass(target) {
  const query =
    buildOverpassQuery(
      target
    );

  let lastError =
    null;

  for (
    const endpoint
    of OVERPASS_ENDPOINTS
  ) {
    try {
      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () =>
            controller.abort(),
          45000
        );

      const response =
        await fetch(
          endpoint,
          {
            method:
              'POST',

            headers: {
              'content-type':
                'application/x-www-form-urlencoded;charset=UTF-8',

              'user-agent':
                'OTA-Audit-France-Prospect-Finder/1.0 (+https://ota.imiloc.com)'
            },

            body:
              new URLSearchParams({
                data:
                  query
              }),

            signal:
              controller.signal
          }
        );

      clearTimeout(
        timer
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      return Array.isArray(
        data.elements
      )
        ? data.elements
        : [];

    } catch (error) {
      lastError =
        error;

      console.warn(
        '[PROSPECT OVERPASS ERROR]',
        endpoint,
        error.message
      );
    }
  }

  throw (
    lastError ||
    new Error(
      'Overpass indisponible'
    )
  );
}

function elementToProspect(
  element,
  target
) {
  const tags =
    element.tags ||
    {};

  const name =
    normalizeSpace(
      tags.name ||
      tags['name:fr']
    );

  if (!name) {
    return null;
  }

  const website =
    cleanUrl(
      tags.website ||
      tags['contact:website'] ||
      tags.url ||
      ''
    );

  const email =
    cleanEmail(
      tags.email ||
      tags['contact:email'] ||
      ''
    );

  const phone =
    normalizeSpace(
      tags.phone ||
      tags['contact:phone'] ||
      ''
    );

  const lat =
    Number(
      element.lat ??
      element.center?.lat
    );

  const lon =
    Number(
      element.lon ??
      element.center?.lon
    );

  const city =
    normalizeSpace(
      tags['addr:city'] ||
      tags['addr:town'] ||
      tags['addr:village'] ||
      target.city
    );

  const address =
    normalizeSpace(
      [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:postcode'],
        city
      ]
        .filter(Boolean)
        .join(' ')
    );

  const prospect = {
    name,
    city,
    address,
    website,
    email,
    phone,

    lat:
      Number.isFinite(lat)
        ? lat
        : null,

    lon:
      Number.isFinite(lon)
        ? lon
        : null,

    source:
      'openstreetmap',

    source_ref:
      `${element.type}/${element.id}`,

    discovered_area:
      target.city,

    discovered_at:
      new Date().toISOString()
  };

  prospect.dedupe_key =
    stableKey(
      prospect
    );

  return prospect;
}

function dedupeLocal(items) {
  const map =
    new Map();

  for (
    const item
    of items
  ) {
    if (!item) {
      continue;
    }

    const old =
      map.get(
        item.dedupe_key
      );

    if (!old) {
      map.set(
        item.dedupe_key,
        item
      );

      continue;
    }

    const oldScore =
      Number(
        Boolean(old.website)
      ) +
      Number(
        Boolean(old.email)
      ) +
      Number(
        Boolean(old.phone)
      );

    const newScore =
      Number(
        Boolean(item.website)
      ) +
      Number(
        Boolean(item.email)
      ) +
      Number(
        Boolean(item.phone)
      );

    if (
      newScore >
      oldScore
    ) {
      map.set(
        item.dedupe_key,
        item
      );
    }
  }

  return [
    ...map.values()
  ];
}

async function ingestProspects(
  prospects
) {
  const baseUrl =
    env('OTA_BASE_URL')
      .replace(
        /\/+$/,
        ''
      );

  const token =
    env(
      'OTA_RUNNER_TOKEN'
    );

  if (!baseUrl) {
    throw new Error(
      'OTA_BASE_URL manquant'
    );
  }

  if (!token) {
    throw new Error(
      'OTA_RUNNER_TOKEN manquant'
    );
  }

  const response =
    await fetch(
      `${baseUrl}/automation/prospects-ingest.php`,
      {
        method:
          'POST',

        headers: {
          'authorization':
            `Bearer ${token}`,

          'content-type':
            'application/json',

          'user-agent':
            'OTA-Audit-France-Prospect-Finder/1.0'
        },

        body:
          JSON.stringify({
            prospects
          })
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Ingest HTTP ${response.status}: ${text.slice(0,500)}`
    );
  }

  let data;

  try {
    data =
      JSON.parse(text);

  } catch {
    throw new Error(
      `Réponse ingest invalide: ${text.slice(0,500)}`
    );
  }

  return data;
}

async function main() {
  const targets =
    parseTargets();

  const selected =
    chooseTargets(
      targets
    );

  const all = [];

  console.log(
    '[PROSPECT] zones du jour =',
    selected
      .map(
        target =>
          target.city
      )
      .join(', ')
  );

  for (
    const target
    of selected
  ) {
    const elements =
      await fetchOverpass(
        target
      );

    const prospects =
      elements
        .map(
          element =>
            elementToProspect(
              element,
              target
            )
        )
        .filter(
          Boolean
        );

    console.log(
      '[PROSPECT]',
      target.city,
      'OSM =',
      elements.length,
      'prospects =',
      prospects.length
    );

    all.push(
      ...prospects
    );
  }

  const deduped =
    dedupeLocal(
      all
    );

  const maxPerRun =
    Math.max(
      1,
      Math.min(
        500,
        Number(
          env(
            'PROSPECT_MAX_PER_RUN',
            '100'
          )
        )
      )
    );

  const limited =
    deduped.slice(
      0,
      maxPerRun
    );

  console.log(
    '[PROSPECT] total brut =',
    all.length,
    'dédupliqués =',
    deduped.length,
    'envoyés =',
    limited.length
  );

  if (!limited.length) {
    console.log(
      '[PROSPECT] aucun prospect à envoyer'
    );

    return;
  }

  const result =
    await ingestProspects(
      limited
    );

  console.log(
    '[PROSPECT INGEST]',
    JSON.stringify(
      result
    )
  );
}

main().catch(
  error => {
    console.error(
      '[PROSPECT FATAL]',
      error?.stack ||
      error
    );

    process.exitCode =
      1;
  }
);
