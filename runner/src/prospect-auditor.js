import { chromium } from 'playwright';
import { auditHotel } from './audit.js';

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

async function api(payload) {
  const url =
    `${baseUrl()}/automation/prospects-api.php`;

  const response =
    await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'authorization':
            `Bearer ${token()}`,

          'content-type':
            'application/json',

          'user-agent':
            'OTA-Audit-France-Prospect-Auditor/1.0'
        },

        body:
          JSON.stringify(payload)
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Prospects API HTTP ${response.status}: ${text.slice(0, 700)}`
    );
  }

  try {
    return JSON.parse(text);

  } catch {
    throw new Error(
      `Réponse prospects-api invalide: ${text.slice(0, 700)}`
    );
  }
}

function severityForCategory(category) {
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

function pickBestVerifiedAnomaly(audit) {
  const failures =
    Array.isArray(audit?.checks)
      ? audit.checks.filter(
          check =>
            check &&
            check.status === 'fail'
        )
      : [];

  failures.sort(
    (a, b) =>
      priorityForCategory(b.category) -
      priorityForCategory(a.category)
  );

  const best =
    failures[0];

  if (!best) {
    return null;
  }

  return {
    title:
      String(
        best.label ||
        ''
      ).trim(),

    category:
      String(
        best.category ||
        ''
      ).trim(),

    severity:
      severityForCategory(
        best.category
      ),

    evidence:
      String(
        best.evidence ||
        ''
      ).trim(),

    recommendation:
      String(
        best.recommendation ||
        ''
      ).trim(),

    sources:
      Array.isArray(
        best.sources
      )
        ? best.sources
            .filter(Boolean)
            .slice(0, 5)
        : []
  };
}

async function claimProspects(limit) {
  const result =
    await api({
      action:
        'claim',

      limit
    });

  return Array.isArray(
    result.prospects
  )
    ? result.prospects
    : [];
}

async function saveAudit(
  prospect,
  audit
) {
  const anomaly =
    pickBestVerifiedAnomaly(
      audit
    );

  const coverage =
    Number(
      audit?.score_basis?.coverage ||
      0
    );

  let auditStatus;

  if (anomaly) {
    auditStatus =
      'audited';

  } else if (
    coverage >= 50
  ) {
    auditStatus =
      'clean';

  } else {
    auditStatus =
      'insufficient';
  }

  await api({
    action:
      'result',

    id:
      prospect.id,

    audit_status:
      auditStatus,

    score:
      Number(
        audit?.score ||
        0
      ),

    coverage,

    anomaly:
      anomaly?.title ||
      '',

    severity:
      anomaly?.severity ||
      '',

    evidence:
      anomaly?.evidence ||
      '',

    recommendation:
      anomaly?.recommendation ||
      '',

    sources:
      anomaly?.sources ||
      []
  });

  console.log(
    '[PROSPECT AUDIT RESULT]',
    `id=${prospect.id}`,
    `hotel=${prospect.hotel_name}`,
    `score=${audit?.score ?? 0}`,
    `coverage=${coverage}`,
    `status=${auditStatus}`,
    `anomaly=${JSON.stringify(anomaly?.title || '')}`
  );
}

async function saveError(
  prospect,
  error
) {
  const message =
    String(
      error?.message ||
      error ||
      'Erreur inconnue'
    )
      .replace(/\s+/g, ' ')
      .slice(0, 500);

  try {
    await api({
      action:
        'error',

      id:
        prospect.id,

      error:
        message
    });

  } catch (apiError) {
    console.error(
      '[PROSPECT AUDIT ERROR REPORT FAILED]',
      `id=${prospect.id}`,
      apiError?.message ||
      apiError
    );
  }

  console.error(
    '[PROSPECT AUDIT ERROR]',
    `id=${prospect.id}`,
    `hotel=${prospect.hotel_name}`,
    message
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

  const limit =
    Math.max(
      1,
      Math.min(
        20,
        Number(
          env(
            'PROSPECT_AUDIT_LIMIT',
            '10'
          )
        )
      )
    );

  const prospects =
    await claimProspects(
      limit
    );

  console.log(
    '[PROSPECT AUDITOR]',
    `prospects réclamés = ${prospects.length}`
  );

  if (!prospects.length) {
    console.log(
      '[PROSPECT AUDITOR] aucun hôtel à auditer'
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
        '[PROSPECT AUDIT]',
        `start id=${prospect.id}`,
        `hotel=${prospect.hotel_name}`,
        `city=${prospect.city}`,
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

        await saveAudit(
          prospect,
          audit
        );

      } catch (error) {
        await saveError(
          prospect,
          error
        );
      }
    }

  } finally {
    await browser.close();
  }

  console.log(
    '[PROSPECT AUDITOR] terminé'
  );
}

main().catch(
  error => {
    console.error(
      '[PROSPECT AUDITOR FATAL]',
      error?.stack ||
      error
    );

    process.exitCode = 1;
  }
);
