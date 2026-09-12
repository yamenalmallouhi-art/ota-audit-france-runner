const CHANNELS = {
  booking: {
    domains: [/booking\.com/i],
    queries: h => [
      `site:booking.com/hotel "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" Booking.com`
    ]
  },

  expedia: {
    domains: [
      /expedia\./i,
      /hotels\.com/i
    ],
    queries: h => [
      `site:expedia.fr "${h.hotel_name}" "${h.city}"`,
      `site:expedia.com "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" Expedia`
    ]
  },

  google: {
    domains: [
      /google\.[^/]+\/maps/i,
      /maps\.google\./i,
      /google\.[^/]+\/travel/i
    ],
    queries: h => [
      `site:google.com/maps "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" "Google Maps"`
    ]
  },

  tripadvisor: {
    domains: [/tripadvisor\./i],
    queries: h => [
      `site:tripadvisor.fr/Hotel_Review "${h.hotel_name}" "${h.city}"`,
      `site:tripadvisor.com/Hotel_Review "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" TripAdvisor`
    ]
  }
};

export async function auditHotel(browser, hotel, options = {}) {
  const timeout = options.timeout ?? 30000;

  const pages = [];
  const limitations = [];

  /*
   * 1. SITE OFFICIEL
   */
  const official = await visit(
    browser,
    hotel.website,
    'official',
    timeout
  );

  pages.push(official);

  /*
   * 2. DÉCOUVERTE OTA, CANAL PAR CANAL
   */
  for (const channel of [
    'booking',
    'expedia',
    'google',
    'tripadvisor'
  ]) {
    try {
      const result = await discoverChannel(
        browser,
        hotel,
        channel,
        timeout
      );

      if (!result.url) {
        pages.push(
          unavailable(
            channel,
            'Aucune page publique fiable trouvée'
          )
        );

        continue;
      }

      const page = await visit(
        browser,
        result.url,
        channel,
        timeout
      );

      /*
       * Si la page est lisible, on vérifie qu'elle semble
       * réellement correspondre à l'établissement.
       */
      if (page.ok) {
        const confidence = hotelMatchConfidence(page, hotel);

        if (confidence === 'low') {
          pages.push(
            unavailable(
              channel,
              'Page trouvée, mais correspondance avec l’établissement insuffisamment fiable.',
              result.url
            )
          );

          continue;
        }

        page.match_confidence = confidence;
      }

      pages.push(page);

    } catch (e) {
      limitations.push(
        `${channel} : découverte partiellement indisponible (${cleanError(e)})`
      );

      pages.push(
        unavailable(
          channel,
          'Recherche publique indisponible'
        )
      );
    }
  }

  /*
   * 3. CONTRÔLES
   */
  const checks = buildChecks(pages, hotel);

  const available = checks.filter(
    c => c.status !== 'unknown'
  );

  const passed = available.filter(
    c => c.status === 'pass'
  );

  const failures = checks.filter(
    c => c.status === 'fail'
  );

  const unknown = checks.filter(
    c => c.status === 'unknown'
  );

  /*
   * Score uniquement sur ce qui est réellement observable.
   */
  const score = available.length
    ? Math.round(100 * passed.length / available.length)
    : 0;

  const coverage = checks.length
    ? Math.round(100 * available.length / checks.length)
    : 0;

  /*
   * 4. CONSTATS CLIENT
   */
  let findings = failures.map(
    check => ({
      severity: severityFor(check),
      title: check.label,
      evidence: check.evidence,
      impact: impactFor(check),
      recommendation: check.recommendation,
      sources: check.sources
    })
  );

  /*
   * Audit gratuit : maximum 3 constats.
   *
   * S'il y a moins de 3 problèmes, on utilise de vrais
   * contrôles positifs, sans inventer d'anomalie.
   */
  if (hotel.type === 'free') {
    if (findings.length < 3) {
      const positives = checks
        .filter(c => c.status === 'pass')
        .slice(0, 3 - findings.length)
        .map(c => ({
          severity: 'ok',
          title: c.label,
          evidence: c.evidence,
          impact: 'Point conforme sur la source publique analysée.',
          recommendation: 'Maintenir cette information à jour.',
          sources: c.sources
        }));

      findings.push(...positives);
    }

    findings = findings.slice(0, 3);
  }

  /*
   * Audit payant :
   * on ajoute quelques points non vérifiables réellement
   * importants pour être transparent sur la couverture.
   */
  if (hotel.type === 'paid') {
    const channelUnknowns = unknown
      .filter(c => c.category === 'channel')
      .slice(0, 4)
      .map(c => ({
        severity: 'opportunity',
        title: `${c.label} — non vérifié`,
        evidence: c.evidence,
        impact:
          'Ce canal n’a pas pu être contrôlé automatiquement avec un niveau de fiabilité suffisant.',
        recommendation:
          'Vérifier manuellement ce canal si sa contribution aux réservations de l’établissement est significative.',
        sources: c.sources
      }));

    findings.push(...channelUnknowns);
  }

  const sources = [
    ...new Set(
      pages
        .filter(p => p.ok && p.url)
        .map(p => p.url)
    )
  ];

  /*
   * 5. PLAN D'ACTION
   */
  const commercialFailures = failures
    .sort(
      (a, b) =>
        priorityWeight(b) -
        priorityWeight(a)
    );

  const h48 = commercialFailures
    .slice(0, 3)
    .map(x => x.recommendation);

  const d7 = commercialFailures
    .slice(3, 6)
    .map(x => x.recommendation);

  if (!d7.length) {
    d7.push(
      'Harmoniser les informations essentielles entre le site officiel et les canaux OTA accessibles.'
    );
  }

  const d30 = [
    'Répéter l’audit après corrections et mesurer l’évolution des réservations directes.',
    'Comparer régulièrement les informations publiques entre les principaux canaux de distribution.'
  ];

  const pageLimitations = pages
    .filter(p => !p.ok)
    .map(
      p =>
        `${p.channel} : ${p.error}`
    );

  const summary =
    `${available.length} contrôles observables sur ${checks.length} ` +
    `(${coverage}% de couverture). ` +
    `${failures.length} anomalie(s) vérifiée(s). ` +
    `${passed.length} point(s) conforme(s). ` +
    `Les contrôles inaccessibles sont exclus du score.`;

  return {
    hotel_name: hotel.hotel_name,
    city: hotel.city,
    audited_at: new Date().toISOString(),

    score,

    score_basis: {
      available: available.length,
      total: checks.length,
      passed: passed.length,
      failed: failures.length,
      unknown: unknown.length,
      coverage,
      formula:
        'passed / available; unknown excluded'
    },

    summary,

    findings,

    checks,

    action_plan: {
      h48,
      d7,
      d30
    },

    limitations: [
      ...limitations,
      ...pageLimitations
    ],

    sources
  };
}

/*
 * ======================================================
 * DÉCOUVERTE DES CANAUX
 * ======================================================
 */

async function discoverChannel(
  browser,
  hotel,
  channel,
  timeout
) {
  const config = CHANNELS[channel];

  if (!config) {
    return { url: '' };
  }

  const candidates = [];

  for (const query of config.queries(hotel)) {
    const urls = await searchWeb(
      browser,
      query,
      timeout
    );

    for (const url of urls) {
      if (
        config.domains.some(
          regex => regex.test(url)
        )
      ) {
        candidates.push(url);
      }
    }

    if (candidates.length) {
      break;
    }
  }

  const unique = [
    ...new Set(
      candidates
        .map(cleanCandidateUrl)
        .filter(Boolean)
    )
  ];

  if (!unique.length) {
    return { url: '' };
  }

  /*
   * On préfère une URL qui ressemble clairement
   * à une fiche d'hôtel.
   */
  unique.sort(
    (a, b) =>
      candidateScore(b, channel) -
      candidateScore(a, channel)
  );

  return {
    url: unique[0],
    candidates: unique.slice(0, 5)
  };
}

async function searchWeb(
  browser,
  query,
  timeout
) {
  const page = await browser.newPage();

  const encoded = encodeURIComponent(query);

  const engines = [
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    `https://www.bing.com/search?q=${encoded}`
  ];

  const urls = [];

  try {
    for (const engine of engines) {
      try {
        await retry(
          () =>
            page.goto(
              engine,
              {
                waitUntil: 'domcontentloaded',
                timeout
              }
            ),
          2
        );

        await page.waitForTimeout(700);

        const links = await page
          .locator('a')
          .evaluateAll(
            anchors =>
              anchors
                .map(a => a.href)
                .filter(Boolean)
          );

        urls.push(
          ...links.map(unwrapSearchUrl)
        );

        if (urls.length > 10) {
          break;
        }

      } catch {
        /*
         * On passe au moteur suivant.
         */
      }
    }

    return [
      ...new Set(urls.filter(Boolean))
    ];

  } finally {
    await page.close();
  }
}

function unwrapSearchUrl(url) {
  try {
    const u = new URL(url);

    /*
     * DuckDuckGo
     */
    const uddg = u.searchParams.get('uddg');

    if (uddg) {
      return decodeURIComponent(uddg);
    }

    /*
     * Bing utilise parfois un paramètre url/u.
     */
    const direct =
      u.searchParams.get('url');

    if (direct?.startsWith('http')) {
      return direct;
    }

    return url;

  } catch {
    return url;
  }
}

function cleanCandidateUrl(url) {
  try {
    const u = new URL(url);

    /*
     * Suppression des paramètres de tracking.
     */
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term'
    ]) {
      u.searchParams.delete(key);
    }

    return u.toString();

  } catch {
    return '';
  }
}

function candidateScore(url, channel) {
  let score = 0;

  if (channel === 'booking') {
    if (/booking\.com/i.test(url)) score += 5;
    if (/\/hotel\//i.test(url)) score += 5;
  }

  if (channel === 'expedia') {
    if (/expedia\./i.test(url)) score += 5;
    if (/hotel/i.test(url)) score += 3;
  }

  if (channel === 'tripadvisor') {
    if (/tripadvisor\./i.test(url)) score += 5;
    if (/Hotel_Review/i.test(url)) score += 5;
  }

  if (channel === 'google') {
    if (/google\./i.test(url)) score += 3;
    if (/\/maps/i.test(url)) score += 5;
    if (/\/travel/i.test(url)) score += 4;
  }

  return score;
}

/*
 * ======================================================
 * VISITE DES PAGES
 * ======================================================
 */

async function visit(
  browser,
  url,
  channel,
  timeout
) {
  const page = await browser.newPage();

  try {
    await retry(
      () =>
        page.goto(
          url,
          {
            waitUntil: 'domcontentloaded',
            timeout
          }
        ),
      3
    );

    await page.waitForTimeout(1500);

    const data = await page.evaluate(() => {
      const bodyText =
        (document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim();

      const jsonld = [
        ...document.querySelectorAll(
          'script[type="application/ld+json"]'
        )
      ]
        .map(x => x.textContent || '')
        .join(' ');

      const links = [
        ...document.links
      ]
        .map(a => ({
          text:
            (a.innerText || '')
              .replace(/\s+/g, ' ')
              .trim(),
          href: a.href
        }))
        .slice(0, 3000);

      const images = [
        ...document.images
      ]
        .slice(0, 1000)
        .map(img => ({
          src: img.currentSrc || img.src || '',
          alt: img.alt || ''
        }));

      const metaDescription =
        document
          .querySelector(
            'meta[name="description"]'
          )
          ?.getAttribute('content') || '';

      return {
        title: document.title || '',
        text: bodyText.slice(0, 250000),
        jsonld: jsonld.slice(0, 100000),
        links,
        images,
        metaDescription,
        lang:
          document.documentElement.lang || ''
      };
    });

    const firstText =
      data.text.slice(0, 4000);

    if (
      data.text.length < 100 ||
      /captcha|access denied|verify you are human|robot check|unusual traffic/i.test(
        firstText
      )
    ) {
      return unavailable(
        channel,
        'Page bloquée ou contenu public insuffisant',
        url
      );
    }

    return {
      ok: true,
      channel,
      url: page.url(),
      ...data
    };

  } catch (e) {
    return unavailable(
      channel,
      cleanError(e),
      url
    );

  } finally {
    await page.close();
  }
}

async function retry(fn, attempts) {
  let error;

  for (
    let i = 0;
    i < attempts;
    i++
  ) {
    try {
      return await fn();

    } catch (e) {
      error = e;

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            500 * 2 ** i
          )
      );
    }
  }

  throw error;
}

function unavailable(
  channel,
  error,
  url = ''
) {
  return {
    ok: false,
    channel,
    url,
    error,
    text: '',
    jsonld: '',
    links: [],
    images: []
  };
}

/*
 * ======================================================
 * 24 CONTRÔLES
 * ======================================================
 */

function buildChecks(pages, hotel) {
  const official = pages.find(
    p => p.channel === 'official'
  );

  const accessible = pages.filter(
    p => p.ok
  );

  const otaPages = pages.filter(
    p => p.channel !== 'official'
  );

  const checks = [];

  /*
   * 15 contrôles du site officiel
   */
  checks.push(
    checkOne(
      'identity',
      'Nom de l’hôtel',
      official,
      p => contains(p, hotel.hotel_name),
      'Le nom déclaré de l’établissement n’a pas été détecté clairement.',
      'Afficher le nom officiel de l’établissement de manière cohérente.',
      hotel.hotel_name
    )
  );

  checks.push(
    checkOne(
      'identity',
      'Ville / localisation',
      official,
      p => contains(p, hotel.city),
      'La ville déclarée n’a pas été détectée clairement.',
      'Afficher clairement la localisation et l’adresse de l’établissement.',
      hotel.city
    )
  );

  checks.push(
    checkOne(
      'contact',
      'Coordonnées de contact',
      official,
      p =>
        /\+?\d[\d .()-]{7,}|@[\w.-]+\.[a-z]{2,}/i.test(
          p.text
        ),
      'Aucun téléphone ou email public n’a été détecté.',
      'Rendre le téléphone ou l’adresse email facilement accessibles.',
      /(\+?\d[\d .()-]{7,}|[\w.-]+@[\w.-]+\.[a-z]{2,})/i
    )
  );

  checks.push(
    checkOne(
      'rooms',
      'Chambres et catégories',
      official,
      p =>
        /chambre|room|suite|studio|double|twin|familiale/i.test(
          p.text
        ),
      'Aucune catégorie de chambre claire n’a été détectée.',
      'Présenter clairement les principales catégories de chambres.',
      /(chambre|room|suite|studio|double|twin).{0,100}/i
    )
  );

  checks.push(
    checkOne(
      'amenities',
      'Équipements principaux',
      official,
      p =>
        /wifi|wi-fi|climatisation|air conditioning|piscine|spa|fitness|sauna/i.test(
          p.text
        ),
      'Aucun équipement principal n’a été détecté clairement.',
      'Publier une liste claire et à jour des équipements.',
      /(wifi|wi-fi|climatisation|piscine|spa|fitness|sauna).{0,100}/i
    )
  );

  checks.push(
    checkOne(
      'policies',
      'Horaires arrivée/départ',
      official,
      p =>
        /check.?in|check.?out|arrivée|départ/i.test(
          p.text
        ),
      'Horaires d’arrivée et de départ non détectés.',
      'Afficher clairement les horaires d’arrivée et de départ.',
      /(check.?in|check.?out|arrivée|départ).{0,100}/i
    )
  );

  checks.push(
    checkOne(
      'policies',
      'Annulation / prépaiement',
      official,
      p =>
        /annulation|cancel|rembours|pré.?paiement|prepayment/i.test(
          p.text
        ),
      'Conditions d’annulation ou de prépaiement non détectées.',
      'Rendre les principales conditions d’annulation et de paiement accessibles avant réservation.',
      /(annulation|cancel|rembours|pré.?paiement|prepayment).{0,140}/i
    )
  );

  checks.push(
    checkOne(
      'food',
      'Restaurant / petit-déjeuner',
      official,
      p =>
        /restaurant|petit.?déjeuner|breakfast|bar\b/i.test(
          p.text
        ),
      'Information sur le restaurant ou le petit-déjeuner non détectée.',
      'Clarifier l’offre de restauration et de petit-déjeuner.',
      /(restaurant|petit.?déjeuner|breakfast|bar\b).{0,120}/i
    )
  );

  checks.push(
    checkOne(
      'parking',
      'Parking',
      official,
      p =>
        /parking|stationnement|garage/i.test(
          p.text
        ),
      'Information parking non détectée.',
      'Préciser la disponibilité, les conditions et éventuellement le tarif du parking.',
      /(parking|stationnement|garage).{0,120}/i
    )
  );

  checks.push(
    checkOne(
      'reviews',
      'Avis / réputation',
      official,
      p =>
        /avis|reviews?|\b[0-9][,.][0-9]\s*\/\s*(5|10)|étoiles/i.test(
          p.text
        ),
      'Aucune preuve de réputation ou note client détectée.',
      'Mettre en avant des éléments de réassurance ou des avis vérifiables.',
      /(avis|reviews?|[0-9][,.][0-9]\s*\/\s*(5|10)|étoiles).{0,120}/i
    )
  );

  checks.push(
    checkOne(
      'direct',
      'Bouton de réservation directe',
      official,
      p =>
        p.links.some(
          l =>
            /réserver|reserver|book now|reservation|disponibilit/i.test(
              `${l.text} ${l.href}`
            )
        ),
      'Aucun appel à l’action de réservation directe détecté.',
      'Ajouter un bouton de réservation visible et accessible rapidement.',
      null,
      p => {
        const link = p.links.find(
          l =>
            /réserver|reserver|book now|reservation|disponibilit/i.test(
              `${l.text} ${l.href}`
            )
        );

        return link
          ? `${link.text || 'Lien réservation'} — ${link.href}`
          : '';
      }
    )
  );

  checks.push(
    checkOne(
      'direct',
      'Moteur de réservation',
      official,
      p => {
        const officialHost =
          hostname(hotel.website);

        return p.links.some(
          l => {
            const href =
              String(l.href || '');

            const host =
              hostname(href);

            return (
              /booking|reservation|availab|disponibil|book/i.test(
                `${l.text} ${href}`
              ) &&
              host &&
              host !== officialHost
            );
          }
        );
      },
      'Aucun moteur de réservation distinct n’a été détecté.',
      'Vérifier que le moteur de réservation directe est accessible, rapide et correctement relié au site.',
      null,
      p => {
        const officialHost =
          hostname(hotel.website);

        const link = p.links.find(
          l => {
            const host =
              hostname(l.href);

            return (
              /booking|reservation|availab|disponibil|book/i.test(
                `${l.text} ${l.href}`
              ) &&
              host &&
              host !== officialHost
            );
          }
        );

        return link
          ? link.href
          : '';
      }
    )
  );

  checks.push(
    checkOne(
      'price',
      'Prix ou accès aux disponibilités',
      official,
      p =>
        /\b\d{2,4}\s?(€|EUR)|€\s?\d{2,4}/i.test(
          p.text
        ) ||
        p.links.some(
          l =>
            /tarif|prix|disponibil|réserver|reserver|book/i.test(
              `${l.text} ${l.href}`
            )
        ),
      'Aucun prix public ni accès évident aux disponibilités n’a été détecté.',
      'Permettre au visiteur d’accéder immédiatement aux tarifs et disponibilités.',
      /(\b\d{2,4}\s?(€|EUR)|€\s?\d{2,4})/i
    )
  );

  checks.push(
    checkOne(
      'content',
      'Contenu hôtelier substantiel',
      official,
      p =>
        p.text.length > 1200,
      'Le contenu public détecté est très limité.',
      'Enrichir les informations utiles sur les chambres, services, localisation et expérience.',
      null
    )
  );

  checks.push(
    checkOne(
      'content',
      'Photos / galerie',
      official,
      p =>
        (p.images?.length || 0) >= 5 ||
        /photo|gallery|galerie/i.test(
          `${p.text} ${p.jsonld}`
        ),
      'Aucune galerie ou quantité significative de photos n’a été détectée.',
      'Présenter des photos récentes et facilement accessibles de l’établissement.',
      null,
      p =>
        `${p.images?.length || 0} image(s) détectée(s) sur la page analysée.`
    )
  );

  /*
   * 4 contrôles de présence OTA
   *
   * Total = 19
   */
  for (const ota of otaPages) {
    checks.push(
      checkChannelPresence(ota)
    );
  }

  /*
   * 5 contrôles de cohérence
   *
   * Total final = 24
   */
  checks.push(
    compare(
      accessible,
      'Cohérence du nom de l’établissement',
      p => normalize(hotelName(p)),
      'Harmoniser le nom de l’établissement entre les canaux publics.'
    )
  );

  checks.push(
    compare(
      accessible,
      'Cohérence des horaires',
      p =>
        first(
          p.text,
          /(check.?in|check.?out|arrivée|départ).{0,100}/i
        ),
      'Harmoniser les horaires d’arrivée et de départ sur l’ensemble des canaux.'
    )
  );

  checks.push(
    compare(
      accessible,
      'Cohérence restaurant / petit-déjeuner',
      p =>
        first(
          p.text,
          /(restaurant|petit.?déjeuner|breakfast).{0,120}/i
        ),
      'Harmoniser les informations de restauration entre les canaux.'
    )
  );

  checks.push(
    compare(
      accessible,
      'Cohérence parking',
      p =>
        first(
          p.text,
          /(parking|stationnement|garage).{0,120}/i
        ),
      'Harmoniser les informations de parking entre les canaux.'
    )
  );

  checks.push(
    priceCompare(accessible)
  );

  return checks;
}

/*
 * ======================================================
 * CONTRÔLES
 * ======================================================
 */

function checkOne(
  category,
  label,
  page,
  test,
  failEvidence,
  recommendation,
  evidencePattern = null,
  customEvidence = null
) {
  if (!page?.ok) {
    return unknown(
      category,
      label,
      page?.error || 'Source inaccessible',
      page?.url
    );
  }

  const ok =
    Boolean(test(page));

  let evidence = failEvidence;

  if (ok) {
    let detail = '';

    if (customEvidence) {
      detail =
        customEvidence(page) || '';

    } else if (
      evidencePattern instanceof RegExp
    ) {
      detail =
        extractEvidence(
          page.text,
          evidencePattern
        );
    }

    evidence = detail
      ? `Élément détecté : ${detail}`
      : 'Élément détecté sur la source publique analysée.';
  }

  return {
    category,
    label,
    status:
      ok
        ? 'pass'
        : 'fail',
    evidence,
    recommendation,
    sources: [
      page.url
    ].filter(Boolean)
  };
}

function checkChannelPresence(page) {
  const label =
    `Présence publique ${capitalize(page.channel)}`;

  if (!page?.ok) {
    return unknown(
      'channel',
      label,
      page?.error ||
        `${page.channel} inaccessible ou introuvable.`,
      page?.url
    );
  }

  return {
    category: 'channel',
    label,
    status: 'pass',
    evidence:
      `Une page publique ${capitalize(page.channel)} correspondant à l’établissement a été trouvée.`,
    recommendation:
      'Maintenir cette fiche à jour et cohérente avec le site officiel.',
    sources: [
      page.url
    ].filter(Boolean)
  };
}

function compare(
  pages,
  label,
  extract,
  recommendation
) {
  const values = pages
    .map(
      page => ({
        url: page.url,
        channel: page.channel,
        value:
          normalize(
            extract(page) || ''
          )
      })
    )
    .filter(x => x.value);

  if (values.length < 2) {
    return unknown(
      'consistency',
      label,
      'Moins de deux sources publiques comparables.',
      ...values.map(x => x.url)
    );
  }

  const unique = [
    ...new Set(
      values.map(x => x.value)
    )
  ];

  return {
    category: 'consistency',
    label,
    status:
      unique.length === 1
        ? 'pass'
        : 'fail',

    evidence:
      unique.length === 1
        ? `Information cohérente sur ${values.length} sources accessibles.`
        : `Des formulations ou valeurs différentes ont été détectées sur ${values.length} sources publiques.`,

    recommendation,
    sources:
      values.map(x => x.url)
  };
}

function priceCompare(pages) {
  const values = pages
    .map(
      page => ({
        url: page.url,
        channel: page.channel,
        value:
          (
            page.text.match(
              /\b\d{2,4}\s?(?:€|EUR)|€\s?\d{2,4}/i
            ) || []
          )[0]
      })
    )
    .filter(x => x.value);

  if (values.length < 2) {
    return unknown(
      'price',
      'Comparaison des prix publics',
      'Moins de deux tarifs publics accessibles ont été détectés.',
      ...values.map(x => x.url)
    );
  }

  /*
   * On NE prétend PAS conclure à une disparité tarifaire :
   * les dates, chambres et conditions doivent être identiques.
   */
  return unknown(
    'price',
    'Comparaison des prix publics',
    `${values.length} prix publics ont été détectés, mais une comparaison fiable nécessite les mêmes dates, la même occupation, la même chambre et les mêmes conditions.`,
    ...values.map(x => x.url)
  );
}

function unknown(
  category,
  label,
  evidence,
  ...sources
) {
  return {
    category,
    label,
    status: 'unknown',
    evidence,
    recommendation:
      'Aucune pénalité appliquée au score.',
    sources:
      sources.filter(Boolean)
  };
}

/*
 * ======================================================
 * PRIORITÉ / IMPACT
 * ======================================================
 */

function severityFor(check) {
  if (
    [
      'direct',
      'price',
      'policies'
    ].includes(check.category)
  ) {
    return 'critique';
  }

  if (
    [
      'identity',
      'consistency',
      'channel',
      'contact'
    ].includes(check.category)
  ) {
    return 'important';
  }

  return 'opportunité';
}

function impactFor(check) {
  const impacts = {
    identity:
      'Une information d’identité incohérente peut créer de la confusion et réduire la confiance du client.',

    contact:
      'Des coordonnées difficiles à trouver augmentent la friction avant réservation.',

    rooms:
      'Une présentation insuffisante des chambres peut empêcher le client de comprendre l’offre et réduire la conversion.',

    amenities:
      'Les équipements sont des critères fréquents de comparaison entre hôtels.',

    policies:
      'Des conditions peu visibles peuvent créer de l’incertitude au moment de réserver et augmenter les abandons.',

    food:
      'La restauration et le petit-déjeuner influencent fréquemment le choix d’un établissement.',

    parking:
      'L’absence d’information parking peut constituer un frein important pour une clientèle motorisée.',

    reviews:
      'La preuve sociale et la réputation jouent un rôle majeur dans la décision de réservation.',

    direct:
      'Toute friction dans la réservation directe peut transférer des réservations vers les OTA et augmenter les commissions.',

    price:
      'L’accès rapide aux tarifs et disponibilités est essentiel pour convertir un visiteur en réservation directe.',

    content:
      'Un contenu insuffisant réduit la capacité du client à se projeter et à comparer favorablement l’établissement.',

    channel:
      'Une présence OTA difficile à identifier peut réduire la visibilité et compliquer le contrôle de la distribution.',

    consistency:
      'Des informations différentes entre canaux peuvent créer de la confusion, des réclamations ou une perte de confiance.'
  };

  return impacts[check.category] ||
    'Ce point peut affecter la qualité de la présence digitale de l’établissement.';
}

function priorityWeight(check) {
  const weights = {
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

  return weights[check.category] || 20;
}

/*
 * ======================================================
 * CORRESPONDANCE HÔTEL
 * ======================================================
 */

function hotelMatchConfidence(
  page,
  hotel
) {
  const haystack =
    normalize(
      `${page.title} ${page.text.slice(0, 6000)}`
    );

  const name =
    normalize(
      hotel.hotel_name
    );

  const city =
    normalize(
      hotel.city
    );

  const significantWords =
    name
      .split(' ')
      .filter(
        word =>
          word.length >= 4 &&
          ![
            'hotel',
            'hôtel',
            'hotellerie',
            'hôtellerie',
            'restaurant'
          ].includes(word)
      );

  let score = 0;

  if (
    name &&
    haystack.includes(name)
  ) {
    score += 5;
  }

  if (
    city &&
    haystack.includes(city)
  ) {
    score += 3;
  }

  for (const word of significantWords) {
    if (haystack.includes(word)) {
      score += 1;
    }
  }

  if (score >= 6) {
    return 'high';
  }

  if (score >= 3) {
    return 'medium';
  }

  return 'low';
}

/*
 * ======================================================
 * UTILITAIRES
 * ======================================================
 */

function extractEvidence(
  text,
  regex
) {
  const match =
    String(text || '')
      .match(regex);

  if (!match) {
    return '';
  }

  const value =
    String(
      match[0] || match[1] || ''
    )
      .replace(/\s+/g, ' ')
      .trim();

  return value.length > 180
    ? value.slice(0, 177) + '...'
    : value;
}

function contains(page, text) {
  return normalize(page.text)
    .includes(
      normalize(text)
    );
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .replace(
      /[^a-z0-9]+/g,
      ' '
    )
    .trim();
}

function first(text, regex) {
  const match =
    String(text || '')
      .match(regex);

  return match
    ? match[0]
    : '';
}

function hotelName(page) {
  return (
    page.title
      ?.split(/[|–—-]/)[0]
      ?.trim() ||
    ''
  );
}

function hostname(url) {
  try {
    return new URL(url)
      .hostname
      .replace(/^www\./, '');

  } catch {
    return '';
  }
}

function capitalize(text) {
  const value =
    String(text || '');

  return value
    ? value.charAt(0).toUpperCase() +
      value.slice(1)
    : '';
}

function cleanError(error) {
  return String(
    error?.message || error || 'Erreur inconnue'
  )
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}
