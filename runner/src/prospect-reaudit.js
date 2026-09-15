import { chromium } from 'playwright';
import { auditHotel } from './audit.js';

const PROSPECTS = [
  {
    id: 29,
    hotel_name: 'Les Quatre Dauphins',
    city: 'Aix-en-Provence',
    website: 'https://www.lesquatredauphins.fr/'
  },
  {
    id: 36,
    hotel_name: 'Le Mas de Fauchon',
    city: 'Saint-Cannat',
    website: 'https://www.masdefauchon.fr/'
  }
];

function env(name, fallback = '') {
  const value = process.env[name];

  return value == null || value === ''
    ? fallback
    : value;
}

function baseUrl() {
  return env('OTA_BASE_URL')
    .replace(/\/+$/, '');
}

function token() {
  return env('OTA_RUNNER_TOKEN');
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

function severityFor(category) {
  if (
    [
      'direct',
      'price',
      'policies'
    ].includes(category)
  ) {
    return 'critique';
  }

  if (
    [
      'identity',
      'consistency',
      'channel',
      'contact'
    ].includes(category)
  ) {
    return 'important';
  }

  return 'opportunité';
}

function bestFailure(audit) {
  const failures =
    Array.isArray(audit?.checks)
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

async function saveAuditResult(
  prospect,
  audit,
  best
) {
  const response =
    await fetch(
      `${baseUrl()}/automation/prospects-api.php`,
      {
        method: 'POST',

        headers: {
          authorization:
            `Bearer ${token()}`,

          'content-type':
            'application/json',

          'user-agent':
            'OTA-Audit-France-Reaudit/1.0'
        },

        body:
          JSON.stringify({
            action: 'result',

            id:
              prospect.id,

            audit_status:
              best
                ? 'audited'
                : 'clean',

            score:
              audit?.score ?? 0,

            coverage:
              audit?.score_basis?.coverage ?? 0,

            anomaly:
              best?.label || '',

            severity:
              best
                ? severityFor(best.category)
                : '',

            evidence:
              best?.evidence || '',

            recommendation:
              best?.recommendation || '',

            sources:
              Array.isArray(best?.sources)
                ? best.sources
                : []
          })
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Sauvegarde API HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  let result;

  try {
    result =
      JSON.parse(text);

  } catch {
    throw new Error(
      `Réponse API invalide: ${text.slice(0, 1000)}`
    );
  }

  if (!result.ok) {
    throw new Error(
      `Sauvegarde refusée: ${text.slice(0, 1000)}`
    );
  }

  console.log(
    '[REAUDIT SAVED]',
    `id=${prospect.id}`,
    `score=${audit?.score ?? 0}`,
    `anomaly=${JSON.stringify(best?.label || '')}`
  );
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

  console.log(
    '[REAUDIT TEST]',
    `prospects = ${PROSPECTS.length}`
  );

  const browser =
    await chromium.launch({
      headless: true
    });

  try {
    for (
      const prospect
      of PROSPECTS
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
          bestFailure(audit);

        console.log(
          '[REAUDIT RESULT]',
          `id=${prospect.id}`,
          `hotel=${prospect.hotel_name}`,
          `score=${audit?.score ?? 0}`,
          `coverage=${audit?.score_basis?.coverage ?? 0}`,
          `anomaly=${JSON.stringify(best?.label || '')}`
        );

        const directChecks =
          Array.isArray(audit?.checks)
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

        /*
         * IMPORTANT :
         * on enregistre maintenant le nouvel audit
         * dans prospects.sqlite.
         */
        await saveAuditResult(
          prospect,
          audit,
          best
        );

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
            .slice(0, 1000)
        );

        throw error;
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
