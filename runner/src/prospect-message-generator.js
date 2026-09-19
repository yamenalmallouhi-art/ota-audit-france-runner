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
          'OTA-Audit-France-Message-Generator/2.0'
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
| GRANDES CHAÎNES À EXCLURE
|--------------------------------------------------------------------------
*/

const CHAIN_NAME_PATTERNS = [
  /\baccor\b/i,
  /\bibis\b/i,
  /\bibis budget\b/i,
  /\bibis styles\b/i,
  /\bhotel\s*f1\b/i,
  /\bhôtel\s*f1\b/i,
  /\bmercure\b/i,
  /\bnovotel\b/i,
  /\bpullman\b/i,
  /\bsofitel\b/i,
  /\bmgallery\b/i,
  /\badagio\b/i,
  /\bmama shelter\b/i,

  /\bradisson\b/i,
  /\bpark inn\b/i,

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
      domain.endsWith(`.${chainDomain}`)
  );
}

function detectChain(prospect) {
  const hotelName =
    String(
      prospect.hotel_name ||
      ''
    ).trim();

  const websiteDomain =
    normalizeDomain(
      prospect.website_domain ||
      prospect.website ||
      ''
    );

  for (
    const pattern
    of CHAIN_NAME_PATTERNS
  ) {
    if (pattern.test(hotelName)) {
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
| ANOMALIES → PHRASES NATURELLES
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
      'arrivee/depart'
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
    normalized.includes('tarif') ||
    normalized.includes('disponibilite')
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
    normalized.includes('chambre')
  ) {
    return (
      'la présentation des catégories de chambres pourrait être ' +
      'plus claire pour un visiteur'
    );
  }

  if (
    normalized.includes('equipement')
  ) {
    return (
      'les principaux équipements de l’hôtel ne semblent pas ' +
      'tous clairement présentés'
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
    'sur votre présence en ligne'
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
    'Si vous le souhaitez, vous pouvez faire gratuitement votre OTA Score ici'
    ': https://ota.imiloc.com',
    '',
    'Le test prend quelques minutes et vous donne votre score ainsi que les 3 principaux points relevés sur votre établissement. Il n’y a rien à installer.',
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

  const messageLimit =
    Math.max(
      1,
      Math.min(
        99,
        Number(
          env(
            'PROSPECT_MESSAGE_LIMIT',
            '10'
          )
        )
      )
    );

  /*
   * On prend plus de candidats que nécessaire,
   * car certains seront exclus comme chaînes.
   */
  const candidates =
    await getCandidates(
      150
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

    console.log(
      '[MESSAGE READY]',
      `id=${prospect.id}`,
      `hotel=${prospect.hotel_name}`,
      `email=${prospect.email}`,
      `score=${prospect.audit_score}`,
      `anomaly=${JSON.stringify(prospect.audit_anomaly)}`
    );
  }

  console.log(
    '[MESSAGE GENERATOR]',
    `messages générés = ${generated}`
  );

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
