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
    ? audit.checks.filter(check => check?.status === 'fail')
    : [];

  failures.sort(
    (a, b) =>
      priorityForCategory(b.category) -
      priorityForCategory(a.category)
  );

  return failures[0] || null;
}

async function main() {
  console.log(
    '[REAUDIT TEST]',
    `prospects = ${PROSPECTS.length}`
  );

  const browser = await chromium.launch({
    headless: true
  });

  try {
    for (const prospect of PROSPECTS) {
      console.log(
        '[REAUDIT START]',
        `id=${prospect.id}`,
        `hotel=${prospect.hotel_name}`,
        `website=${prospect.website}`
      );

      try {
        const audit = await auditHotel(
          browser,
          {
            hotel_name: prospect.hotel_name,
            city: prospect.city,
            website: prospect.website,
            type: 'free'
          },
          {
            timeout: 30000
          }
        );

        const best = bestFailure(audit);

        console.log(
          '[REAUDIT RESULT]',
          `id=${prospect.id}`,
          `hotel=${prospect.hotel_name}`,
          `score=${audit?.score ?? 0}`,
          `coverage=${audit?.score_basis?.coverage ?? 0}`,
          `anomaly=${JSON.stringify(best?.label || '')}`
        );

        const directChecks = Array.isArray(audit?.checks)
          ? audit.checks.filter(
              check => check?.category === 'direct'
            )
          : [];

        for (const check of directChecks) {
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

main().catch(error => {
  console.error(
    '[REAUDIT FATAL]',
    error?.stack ||
    error
  );

  process.exitCode = 1;
});
