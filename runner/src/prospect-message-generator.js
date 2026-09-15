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
  const response = await fetch(
    `${baseUrl()}/automation/prospects-api.php`,
    {
      method: 'POST',

      headers: {
        authorization:
          `Bearer ${token()}`,

        'content-type':
          'application/json',

        'user-agent':
          'OTA-Audit-France-Message-Generator/1.1'
      },

      body:
        JSON.stringify(payload)
    }
  );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Prospects API HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  try {
    return JSON.parse(text);

  } catch {
    throw new Error(
      `Réponse API invalide: ${text.slice(0, 1000)}`
    );
  }
}


/*
|--------------------------------------------------------------------------
| FILTRE GRANDES CHAÎNES
|--------------------------------------------------------------------------
*/

const CHAIN_NAME_PATTERNS = [
  /\baccor\b/i,
  /\bibis\b/i,
  /\bibis budget\b/i,
  /\bhotel\s*f1\b/i,
  /\bmercure\b/i,
  /\bnovotel\b/i,
  /\badagio\b/i,
  /\bmama shelter\b/i,

  /\bradisson\b/i,

  /\bmarriott\b/i,
  /\bcourtyard\b/i,
  /\bsheraton\b/i,
  /\bwestin\b/i,
  /\brenaissance\b/i,
  /\bmoxy\b/i,

  /\bhilton\b/i,
  /\bhampton\b/i,
  /\bdoubletree\b/i,
  /\bwaldorf astoria\b/i,

  /\bbest western\b/i,

  /\bcampanile\b/i,
  /\bkyriad\b/i,
  /\bpremi[eè]re classe\b/i,
  /\bgolden tulip\b/i,

  /\bb&b hotels?\b/i,
  /\bb\s*&\s*b hotels?\b/i,

  /\bholiday inn\b/i,
  /\bcrowne plaza\b/i,
  /\bintercontinental\b/i,
  /\bhotel indigo\b/i,

  /\bhyatt\b/i,

  /\bmeli[aá]\b/i,

  /\bnh hotels?\b/i,
  /\bnh collection\b/i
];

const CHAIN_DOMAINS = [
  'accor.com',
  'all.accor.com',
  'ibis.accor.com',
  'novotel.accor.com',
  'mercure.accor.com',

  'radissonhotels.com',
  'radissonblu.com',

  'marriott.com',

  'hilton.com',

  'bestwestern.com',
  'bestwestern.fr',

  'campanile.com',
  'kyriad.com',
  'premiereclasse.com',
  'goldentulip.com',

  'hotel-bb.com',
  'hotelbb.com',

  'ihg.com',

  'hyatt.com',

  'melia.com',

  'nh-hotels.com',

  'aparthotels-adagio.com',

  'mamashelter.com'
];

function normalizeDomain(value) {
  try {
    const url =
      /^https?:\/\//i.test(value)
        ? new URL(value)
        : new URL(`https://${value}`);

    return url.hostname
      .toLowerCase()
      .replace(/^www\./, '');

  } catch {
    return '';
  }
}

function domainMatchesChain(domain) {
  if (!domain) {
    return false;
  }

  return CHAIN_DOMAINS.some(
    chainDomain =>
      domain === chainDomain ||
      domain.endsWith(
        `.${chainDomain}`
      )
  );
}

function detectChain(prospect) {
  const hotelName =
    String(
      prospect.hotel_name ||
      ''
    ).trim();

  const website =
    String(
      prospect.website ||
      ''
    ).trim();

  const websiteDomain =
    normalizeDomain(
      prospect.website_domain ||
      website
    );

  for (
    const pattern
    of CHAIN_NAME_PATTERNS
  ) {
    if (
      pattern.test(
        hotelName
      )
    ) {
      return {
        isChain: true,
        reason:
          `Nom correspondant à une chaîne connue : ${hotelName}`
      };
    }
  }

  if (
    domainMatchesChain(
      websiteDomain
    )
  ) {
    return {
      isChain: true,
      reason:
        `Domaine corporate détecté : ${websiteDomain}`
    };
  }

  return {
    isChain: false,
    reason: ''
  };
}


/*
|--------------------------------------------------------------------------
| ANOMALIE EN FRANÇAIS NATUREL
|--------------------------------------------------------------------------
*/

function humanizeAnomaly(prospect) {
  const title =
    String(
      prospect.audit_anomaly ||
      ''
    ).trim();

  const evidence =
    String(
      prospect.audit_evidence ||
      ''
    ).trim();

  const normalized =
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  if (
    normalized.includes(
      'bouton de reservation directe'
    )
  ) {
    return (
      'je n’ai pas trouvé de bouton de réservation directe ' +
      'clairement accessible sur votre site'
    );
  }

  if (
    normalized.includes(
      'horaires arrivee'
    ) ||
    normalized.includes(
      'horaires arrivee/depart'
    )
  ) {
    return (
      'les horaires d’arrivée et de départ ne semblent pas ' +
      'clairement indiqués sur votre site'
    );
  }

  if (
    normalized.includes('annulation') ||
    normalized.includes('prepaiement')
  ) {
    return (
      'les conditions d’annulation ou de prépaiement ne semblent ' +
      'pas clairement visibles avant la réservation'
    );
  }

  if (
    normalized.includes(
      'moteur de reservation'
    )
  ) {
    return (
      'je n’ai pas identifié clairement le moteur de réservation ' +
      'directe depuis votre site'
    );
  }

  if (
    normalized.includes('prix') ||
    normalized.includes('tarif')
  ) {
    return (
      'l’accès aux tarifs ou aux disponibilités ne semble pas ' +
      'immédiatement visible depuis votre site'
    );
  }

  if (
    normalized.includes('coordonnees') ||
    normalized.includes('contact')
  ) {
    return (
      'les coordonnées de contact ne semblent pas immédiatement ' +
      'visibles pour un visiteur'
    );
  }

  if (
    normalized.includes('parking')
  ) {
    return (
      'les informations concernant le parking ne semblent pas ' +
      'clairement indiquées'
    );
  }

  if (
    normalized.includes('restaurant') ||
    normalized.includes('petit-dejeuner')
  ) {
    return (
      'les informations sur la restauration ou le petit-déjeuner ' +
      'ne semblent pas clairement présentées'
    );
  }

  if (
    evidence &&
    evidence.length < 180
  ) {
    const clean =
      evidence
        .replace(/\.$/, '')
        .trim();

    if (clean) {
      return (
        clean.charAt(0).toLowerCase() +
        clean.slice(1)
      );
    }
  }

  if (title) {
    return (
      `j’ai relevé un point concernant « ${title} »`
    );
  }

  return (
    'j’ai relevé un point qui mérite d’être vérifié ' +
    'sur le parcours de réservation'
  );
}


/*
|--------------------------------------------------------------------------
| MESSAGE
|--------------------------------------------------------------------------
*/

function buildSubject(prospect) {
  const hotel =
    String(
      prospect.hotel_name ||
      ''
    ).trim();

  return hotel
    ? `Un point relevé sur ${hotel}`
    : 'Un point relevé sur votre hôtel';
}

function buildMessage(prospect) {
  const score =
    Number(
      prospect.audit_score ||
      0
    );

  const anomaly =
    humanizeAnomaly(
      prospect
    );

  return [
    'Bonjour,',
    '',
    'En regardant la présence en ligne de votre hôtel, un point a attiré notre attention : ' +
      `${anomaly}.`,
    '',
    `Votre OTA Score ressort actuellement à ${score}/100.`,
    '',
    'Si vous le souhaitez, je peux vous envoyer gratuitement les 3 principaux points relevés sur votre établissement. Ça tient sur une page et il n’y a rien à installer.',
    '',
    'Bien à vous,',
    'OTA Audit France',
    'ota.imiloc.com',
    '',
    'PS : si ce sujet ne vous concerne pas, dites-le-moi simplement et je ne vous relancerai pas.'
  ].join('\n');
}


/*
|--------------------------------------------------------------------------
| API
|--------------------------------------------------------------------------
*/

async function getCandidates(limit) {
  const result =
    await api({
      action:
        'message_candidates',

      limit
    });

  return Array.isArray(
    result.prospects
  )
    ? result.prospects
    : [];
}

async function excludeChain(
  prospect,
  reason
) {
  await api({
    action:
      'message_exclude',

    id:
      prospect.id,

    reason
  });

  console.log(
    '[MESSAGE EXCLUDED]',
    `id=${prospect.id}`,
    `hotel=${prospect.hotel_name}`,
    `reason=${reason}`
  );
}

async function saveMessage(
  prospect,
  subject,
  body
) {
  await api({
    action:
      'message_result',

    id:
      prospect.id,

    subject,

    body
  });
}


/*
|--------------------------------------------------------------------------
| MAIN
|--------------------------------------------------------------------------
*/

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
   * Nous voulons seulement 2 messages,
   * mais nous examinons jusqu’à 20 candidats
   * pour pouvoir sauter les chaînes.
   */
  const messageLimit =
    Math.max(
      1,
      Math.min(
        2,
        Number(
          env(
            'PROSPECT_MESSAGE_LIMIT',
            '2'
          )
        )
      )
    );

  const candidates =
    await getCandidates(
      20
    );

  console.log(
    '[MESSAGE GENERATOR]',
    `candidats examinés = ${candidates.length}`,
    `objectif = ${messageLimit}`
  );

  let generated = 0;

  for (
    const prospect
    of candidates
  ) {
    if (
      generated >=
      messageLimit
    ) {
      break;
    }

    const chain =
      detectChain(
        prospect
      );

    if (
      chain.isChain
    ) {
      await excludeChain(
        prospect,
        chain.reason
      );

      continue;
    }

    const subject =
      buildSubject(
        prospect
      );

    const body =
      buildMessage(
        prospect
      );

    await saveMessage(
      prospect,
      subject,
      body
    );

    generated++;

    console.log('');
    console.log(
      '========================================'
    );

    console.log(
      '[MESSAGE READY]',
      `id=${prospect.id}`,
      `hotel=${prospect.hotel_name}`,
      `email=${prospect.email}`
    );

    console.log('OBJET:');
    console.log(subject);

    console.log('');
    console.log('MESSAGE:');
    console.log(body);

    console.log(
      '========================================'
    );

    console.log('');
  }

  console.log(
    '[MESSAGE GENERATOR]',
    `messages générés = ${generated}`
  );

  if (
    generated <
    messageLimit
  ) {
    console.log(
      '[MESSAGE GENERATOR]',
      'Pas assez de prospects indépendants éligibles pour atteindre la limite.'
    );
  }

  console.log(
    '[MESSAGE GENERATOR] terminé'
  );
}

main().catch(
  error => {
    console.error(
      '[MESSAGE GENERATOR FATAL]',
      error?.stack ||
      error
    );

    process.exitCode = 1;
  }
);
