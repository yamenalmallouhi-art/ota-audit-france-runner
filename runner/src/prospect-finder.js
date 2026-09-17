const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const MARKETS = {
  FR: {
    language: 'fr',

    areas: [
      'Paris',
      'Lyon',
      'Bordeaux',
      'Nice',
      'Marseille',
      'Toulouse',
      'Strasbourg',
      'Annecy',
      'Colmar',
      'La Rochelle',
      'Biarritz',
      'Saint-Malo',
      'Deauville',
      'Honfleur',
      'Aix-en-Provence',
      'Avignon',
      'Cannes',
      'Montpellier',
      'Nantes',
      'Lille'
    ]
  },

  GB: {
    language: 'en',

    areas: [
      'London',
      'Manchester',
      'Liverpool',
      'Birmingham',
      'Bristol',
      'Bath',
      'Brighton',
      'Oxford',
      'Cambridge',
      'York',
      'Edinburgh',
      'Glasgow',
      'Cardiff',
      'Bournemouth',
      'Blackpool',
      'Leeds',
      'Newcastle upon Tyne',
      'Nottingham',
      'Southampton',
      'Chester'
    ]
  },

  US: {
    language: 'en',

    areas: [
      'New York',
      'Boston',
      'Miami',
      'Orlando',
      'Chicago',
      'Los Angeles',
      'San Diego',
      'San Francisco',
      'Seattle',
      'Portland',
      'Denver',
      'Austin',
      'Dallas',
      'Nashville',
      'New Orleans',
      'Charleston',
      'Savannah',
      'Las Vegas',
      'Phoenix',
      'Washington'
    ]
  }
};

function env(name, fallback = '') {
  const value =
    process.env[name];

  return value == null || value === ''
    ? fallback
    : value;
}

function baseUrl() {
  return env(
    'OTA_BASE_URL'
  ).replace(
    /\/+$/,
    ''
  );
}

function token() {
  return env(
    'OTA_RUNNER_TOKEN'
  );
}

function normalizeWebsite(value) {
  const website =
    String(
      value ||
      ''
    ).trim();

  if (!website) {
    return '';
  }

  if (
    /^https?:\/\//i.test(
      website
    )
  ) {
    return website;
  }

  return (
    'https://' +
    website
  );
}

function normalizeEmail(value) {
  const email =
    String(
      value ||
      ''
    )
      .trim()
      .toLowerCase();

  if (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  ) {
    return email;
  }

  return '';
}

function websiteDomain(value) {
  try {
    return new URL(
      normalizeWebsite(value)
    )
      .hostname
      .toLowerCase()
      .replace(
        /^www\./,
        ''
      );

  } catch {
    return '';
  }
}

function dedupeProspects(items) {
  const map =
    new Map();

  for (
    const item
    of items
  ) {
    const domain =
      websiteDomain(
        item.website
      );

    const key =
      domain
        ? `domain:${domain}`
        : [
            item.country,
            item.hotel_name,
            item.city
          ]
            .map(
              value =>
                String(value || '')
                  .toLowerCase()
                  .trim()
            )
            .join('|');

    if (!key) {
      continue;
    }

    const old =
      map.get(key);

    if (!old) {
      map.set(
        key,
        item
      );

      continue;
    }

    /*
     * Garde la fiche la plus complète.
     */
    const oldScore =
      Number(Boolean(old.website)) +
      Number(Boolean(old.email)) +
      Number(Boolean(old.phone));

    const newScore =
      Number(Boolean(item.website)) +
      Number(Boolean(item.email)) +
      Number(Boolean(item.phone));

    if (
      newScore >
      oldScore
    ) {
      map.set(
        key,
        item
      );
    }
  }

  return [
    ...map.values()
  ];
}

async function overpassQuery(
  area,
  country
) {
  const query = `
[out:json][timeout:40];

area
  ["name"="${area}"]
  ->.searchArea;

(
  nwr
    ["tourism"="hotel"]
    (area.searchArea);

  nwr
    ["tourism"="guest_house"]
    (area.searchArea);
);

out center tags;
`;

  let lastError;

  for (
    const endpoint
    of OVERPASS_ENDPOINTS
  ) {
    try {
      const response =
        await fetch(
          endpoint,
          {
            method: 'POST',

            headers: {
              'content-type':
                'application/x-www-form-urlencoded',

              'user-agent':
                'OTA-Audit-France-Prospect-Finder/2.0'
            },

            body:
              new URLSearchParams({
                data: query
              })
          }
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const json =
        await response.json();

      const elements =
        Array.isArray(
          json.elements
        )
          ? json.elements
          : [];

      return elements.map(
        element =>
          elementToProspect(
            element,
            area,
            country
          )
      )
      .filter(Boolean);

    } catch (error) {
      lastError = error;

      console.log(
        '[PROSPECT OVERPASS ERROR]',
        endpoint,
        String(
          error?.message ||
          error
        )
      );
    }
  }

  throw lastError;
}

function elementToProspect(
  element,
  area,
  country
) {
  const tags =
    element.tags ||
    {};

  const hotelName =
    String(
      tags.name ||
      tags['name:en'] ||
      ''
    ).trim();

  if (!hotelName) {
    return null;
  }

  const website =
    normalizeWebsite(
      tags.website ||
      tags['contact:website'] ||
      ''
    );

  const email =
    normalizeEmail(
      tags.email ||
      tags['contact:email'] ||
      ''
    );

  const phone =
    String(
      tags.phone ||
      tags['contact:phone'] ||
      ''
    ).trim();

  const street =
    String(
      tags['addr:street'] ||
      ''
    ).trim();

  const houseNumber =
    String(
      tags['addr:housenumber'] ||
      ''
    ).trim();

  const postcode =
    String(
      tags['addr:postcode'] ||
      ''
    ).trim();

  const city =
    String(
      tags['addr:city'] ||
      area ||
      ''
    ).trim();

  const address =
    [
      houseNumber,
      street,
      postcode,
      city
    ]
      .filter(Boolean)
      .join(' ');

  const lat =
    element.lat ??
    element.center?.lat ??
    null;

  const lon =
    element.lon ??
    element.center?.lon ??
    null;

  return {
    hotel_name:
      hotelName,

    city,

    address,

    website,

    email,

    phone,

    lat,

    lon,

    source:
      'osm',

    source_ref:
      `${element.type}/${element.id}`,

    discovered_area:
      area,

    country,

    language:
      MARKETS[country].language
  };
}

async function sendProspects(
  prospects
) {
  if (!prospects.length) {
    return {
      ok: true,
      inserted: 0
    };
  }

  const response =
    await fetch(
      `${baseUrl()}/automation/prospects-ingest.php`,
      {
        method:
          'POST',

        headers: {
          authorization:
            `Bearer ${token()}`,

          'content-type':
            'application/json',

          'user-agent':
            'OTA-Audit-France-Prospect-Finder/2.0'
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
      `Ingest HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  try {
    return JSON.parse(text);

  } catch {
    throw new Error(
      `Réponse ingest invalide: ${text.slice(0, 1000)}`
    );
  }
}

function areaForToday(
  country,
  offset = 0
) {
  const areas =
    MARKETS[country].areas;

  const day =
    Math.floor(
      Date.now() /
      86400000
    );

  return areas[
    (
      day +
      offset
    ) %
    areas.length
  ];
}

async function discoverCountry(
  country,
  areasPerRun
) {
  const raw = [];

  for (
    let i = 0;
    i < areasPerRun;
    i++
  ) {
    const area =
      areaForToday(
        country,
        i
      );

    console.log(
      '[PROSPECT]',
      `country=${country}`,
      `area=${area}`
    );

    try {
      const prospects =
        await overpassQuery(
          area,
          country
        );

      console.log(
        '[PROSPECT]',
        `country=${country}`,
        `area=${area}`,
        `OSM=${prospects.length}`
      );

      raw.push(
        ...prospects
      );

    } catch (error) {
      console.log(
        '[PROSPECT AREA ERROR]',
        `country=${country}`,
        `area=${area}`,
        String(
          error?.message ||
          error
        )
      );
    }
  }

  const deduped =
    dedupeProspects(
      raw
    );

  const withWebsite =
    deduped.filter(
      item =>
        item.website
    ).length;

  const withEmail =
    deduped.filter(
      item =>
        item.email
    ).length;

  console.log(
    '[PROSPECT COUNTRY]',
    `country=${country}`,
    `raw=${raw.length}`,
    `deduped=${deduped.length}`,
    `website=${withWebsite}`,
    `email=${withEmail}`
  );

  return deduped;
}

async function main() {
  if (!baseUrl()) {
    throw new Error(
      'OTA_BASE_URL manquant'
    );
  }

  if (!token()) {
    throw new Error(
      'OTA_RUNNER_TOKEN manquant'
    );
  }

  /*
   * Pour commencer : 2 villes par pays.
   *
   * On pourra ensuite augmenter ce nombre
   * pour alimenter 50 emails/pays/jour.
   */
  const areasPerCountry =
    Math.max(
      1,
      Math.min(
        10,
        Number(
          env(
            'PROSPECT_AREAS_PER_COUNTRY',
            '2'
          )
        )
      )
    );

  const countries = [
    'FR',
    'GB',
    'US'
  ];

  for (
    const country
    of countries
  ) {
    const prospects =
      await discoverCountry(
        country,
        areasPerCountry
      );

    const result =
      await sendProspects(
        prospects
      );

    console.log(
      '[PROSPECT INGEST]',
      `country=${country}`,
      JSON.stringify(
        result
      )
    );
  }

  console.log(
    '[PROSPECT] terminé'
  );
}

main().catch(
  error => {
    console.error(
      '[PROSPECT FATAL]',
      error?.stack ||
      error
    );

    process.exitCode = 1;
  }
);
