import { chromium } from 'playwright';
import { auditHotel } from './audit.js';

function env(name, fallback = '') {
  const value =
    process.env[name];

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

async function requestTestProspects() {
  const response =
    await fetch(
      `${baseUrl()}/automation/prospects-reaudit-test.php`,
      {
        method: 'POST',

        headers: {
          authorization:
            `Bearer ${token()}`,

          'content-type':
            'application/json'
        }
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${text}`
    );
  }

  return JSON.parse(text);
}

async function saveResult(
  prospect,
  audit
) {
  const failures =
    Array.isArray(audit.checks)
      ? audit.checks.filter(
          check =>
            check.status === 'fail'
        )
      : [];

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

  failures.sort(
    (a, b) =>
      (priorities[b.category] || 0) -
      (priorities[a.category] || 0)
  );

  const best =
    failures[0] ||
    null;

  const response =
    await fetch(
      `${baseUrl()}/automation/prospects-api.php`,
      {
        method: 'POST',

        headers: {
          authorization:
            `Bearer ${token()}`,

          'content-type':
            'application/json'
        },

        body:
          JSON.stringify({
            action:
              'result',

            id:
              prospect.id,

            audit_status:
              best
                ? 'audited'
                : 'clean',

            score:
              audit.score || 0,

            coverage:
              audit.score_basis?.coverage || 0,

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
              best?.sources || []
          })
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Save HTTP ${response.status}: ${text}`
    );
  }

  console.log(
    '[REAUDIT RESULT]',
    `id=${prospect.id}`,
    `hotel=${prospect.hotel_name}`,
    `score=${audit.score}`,
    `coverage=${audit.score_basis?.coverage || 0}`,
    `anomaly=${JSON.stringify(best?.label || '')}`
  );

  const directChecks =
    audit.checks.filter(
      check =>
        check.category === 'direct'
    );

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
    await requestTestProspects();

  const prospects =
    result.prospects || [];

  console.log(
    '[REAUDIT TEST]',
    `prospects
