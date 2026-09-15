import { chromium } from 'playwright';
import { auditHotel } from './audit.js';

function env(name, fallback = '') {
  const value = process.env[name];
  return value == null || value === '' ? fallback : value;
}

function baseUrl() {
  return env('OTA_BASE_URL').replace(/\/+$/, '');
}

function token() {
  return env('OTA_RUNNER_TOKEN');
}

async function getTestProspects() {
  const response = await fetch(
    `${baseUrl()}/automation/prospects-reaudit-test.php`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token()}`,
        'content-type': 'application/json',
        'user-agent': 'OTA-Audit-France-Reaudit-Test/1.0'
      }
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Réponse JSON invalide: ${text.slice(0, 1000)}`
    );
  }
}

function priorityForCategory(category) {
  const priorities = {
    direct: 100,
    price: 95,
    policies: 90,
    consistency: 80,
    channel: 75,
    reviews: 70,
    identity: 65,
    contact: 60,
    rooms: 55,
    amenities: 50,
    food: 45,
    parking: 40,
    content: 35
  };

  return priorities[category] || 20;
}

function bestFailure(audit) {
  const failures = Array.isArray(audit?.checks)
    ? audit.checks.filter(
        check =>
          check?.status === 'fail'
      )
    : [];

  failures.sort(
    (a, b) =>
      priorityForCategory(b.category) -
      priorityForCategory(a.category)
  );

  return failures[0] || null;
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

  const result =
    await getTestProspects();

  const prospects =
    Array.isArray(result?.prospects)
      ? result.prospects
      : [];

  console.log(
    '[REAUDIT TEST]',
    `prospects = ${prospects.length}`
  );

  if (!prospects.length) {
    console.log(
      '[REAUDIT TEST] aucun prospect de test'
    );

    return;
  }

  const browser =
    await chromium.launch({
      headless: true
    });

  try {
    for (
      const prospect
      of prospects
    ) {
      console.log(
        '[REAUDIT START]',
        `id=${prospect.id}`,
        `hotel=${prospect.hotel_name}`,
        `website=${prospect.website}`
      );

      try {
        const audit =
          await auditHotel(
            browser,
            {
              hotel_name:
                prospect.hotel_name,

              city:
                prospect.city,

              website:
                prospect.website,

              type:
                'free'
            },
            {
              timeout:
                30000
            }
          );

        const best =
          bestFailure(
            audit
          );

        console.log(
          '[REAUDIT RESULT]',
          `id=${prospect.id}`,
          `hotel=${prospect.hotel_name}`,
          `score=${audit?.score ?? 0}`,
          `coverage=${audit?.score_basis?.coverage ?? 0}`,
          `anomaly=${JSON.stringify(best?.label || '')}`
        );

        const directChecks =
          Array.isArray(
            audit?.checks
          )
            ? audit.checks.filter(
                check =>
                  check?.category === 'direct'
              )
            : [];

        for (
          const check
          of directChecks
        ) {
          console.log(
            '[REAUDIT DIRECT]',
            `id=${prospect.id}`,
            `hotel=${prospect.hotel_name}`,
            `check=${JSON.stringify(check.label)}`,
            `status=${check.status}`,
            `evidence=${JSON.stringify(check.evidence)}`
          );
        }

      } catch (error) {
        console.error(
          '[REAUDIT ERROR]',
          `id=${prospect.id}`,
          `hotel=${prospect.hotel_name}`,
          String(
            error?.message ||
            error
          )
            .replace(/\s+/g, ' ')
            .slice(0, 500)
        );
      }
    }

  } finally {
    await browser.close();
  }

  console.log(
    '[REAUDIT TEST] terminé'
  );
}

main().catch(
  error => {
    console.error(
      '[REAUDIT FATAL]',
      error?.stack ||
      error
    );

    process.exitCode = 1;
  }
);
