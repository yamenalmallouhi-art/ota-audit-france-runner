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
          'OTA-Audit-France-Message-Generator/1.0'
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
    normalized.includes(
      'annulation'
    ) ||
    normalized.includes(
      'prepaiement'
    )
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
    normalized.includes(
      'prix'
    ) ||
    normalized.includes(
      'tarif'
    )
  ) {
    return (
      'l’accès aux tarifs ou aux disponibilités ne semble pas ' +
      'immédiatement visible depuis votre site'
    );
  }

  if (
    normalized.includes(
      'coordonnees'
    ) ||
    normalized.includes(
      'contact'
    )
  ) {
    return (
      'les coordonnées de contact ne semblent pas immédiatement ' +
      'visibles pour un visiteur'
    );
  }

  if (
    normalized.includes(
      'parking'
    )
  ) {
    return (
      'les informations concernant le parking ne semblent pas ' +
      'clairement indiquées'
    );
  }

  if (
    normalized.includes(
      'restaurant'
    ) ||
    normalized.includes(
      'petit-dejeuner'
    )
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
    return (
      evidence
        .replace(/\.$/, '')
        .charAt(0)
        .toLowerCase() +
      evidence
        .replace(/\.$/, '')
        .slice(1)
    );
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
    'Je me permets de vous écrire parce que j’ai regardé rapidement la présence en ligne de votre hôtel.',
    '',
    `J’ai remarqué un point qui pourrait vous faire perdre quelques réservations directes : ${anomaly}.`,
    '',
    `J’ai aussi calculé votre OTA Score : ${score}/100.`,
    '',
    'Si vous voulez, je peux vous envoyer gratuitement les 3 principaux points que j’ai relevés. Ça tient sur une page et il n’y a rien à installer.',
    '',
    'Bien à vous,',
    'OTA Audit France',
    'ota.imiloc.com',
    '',
    'PS : si ce sujet ne vous concerne pas, dites-le-moi simplement et je ne vous relancerai pas.'
  ].join('\n');
}

async function claimProspects(limit) {
  const result =
    await api({
      action:
        'message_claim',

      limit
    });

  return Array.isArray(
    result.prospects
  )
    ? result.prospects
    : [];
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
        2,
        Number(
          env(
            'PROSPECT_MESSAGE_LIMIT',
            '2'
          )
        )
      )
    );

  const prospects =
    await claimProspects(
      limit
    );

  console.log(
    '[MESSAGE GENERATOR]',
    `prospects réclamés = ${prospects.length}`
  );

  for (
    const prospect
    of prospects
  ) {
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

    console.log(
      ''
    );

    console.log(
      '========================================'
    );

    console.log(
      '[MESSAGE READY]',
      `id=${prospect.id}`,
      `hotel=${prospect.hotel_name}`,
      `email=${prospect.email}`
    );

    console.log(
      'OBJET:'
    );

    console.log(
      subject
    );

    console.log(
      ''
    );

    console.log(
      'MESSAGE:'
    );

    console.log(
      body
    );

    console.log(
      '========================================'
    );

    console.log(
      ''
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
