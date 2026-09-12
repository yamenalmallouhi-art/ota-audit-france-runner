const CHANNELS = {
  booking: {
    queries: h => [
      `site:booking.com/hotel "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" Booking.com`
    ]
  },

  expedia: {
    queries: h => [
      `site:expedia.fr "${h.hotel_name}" "${h.city}"`,
      `site:expedia.com "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" Expedia`
    ]
  },

  google: {
    queries: h => [
      `site:google.fr/travel/hotels "${h.hotel_name}" "${h.city}"`,
      `site:google.com/travel/hotels "${h.hotel_name}" "${h.city}"`,
      `site:google.fr/maps "${h.hotel_name}" "${h.city}"`,
      `site:google.com/maps "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" "Google Hotels"`
    ]
  },

  tripadvisor: {
    queries: h => [
      `site:tripadvisor.fr/Hotel_Review "${h.hotel_name}" "${h.city}"`,
      `site:tripadvisor.com/Hotel_Review "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" TripAdvisor`
    ]
  }
};

export async function auditHotel(
  browser,
  hotel,
  options = {}
) {
  const timeout = options.timeout ?? 30000;

  const pages = [];
  const limitations = [];

  /*
   * ==================================================
   * SITE OFFICIEL
   * ==================================================
   */

  const official = await visit(
    browser,
    hotel.website,
    'official',
    timeout
  );

  pages.push(official);

  /*
   * ==================================================
   * OTA / GOOGLE
   * ==================================================
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

      if (page.ok) {
        const confidence = hotelMatchConfidence(
          page,
          hotel
        );

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

    } catch (error) {
      limitations.push(
        `${channel} : découverte partiellement indisponible (${cleanError(error)})`
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
   * ==================================================
   * CONTRÔLES ET SCORE
   * ==================================================
   */

  const checks = buildChecks(
    pages,
    hotel
  );

  const available = checks.filter(
    check => check.status !== 'unknown'
  );

  const passed = available.filter(
    check => check.status === 'pass'
  );

  const failures = checks.filter(
    check => check.status === 'fail'
  );

  const unknown = checks.filter(
    check => check.status === 'unknown'
  );

  const score = available.length
    ? Math.round(
        100 * passed.length / available.length
      )
    : 0;

  const coverage = checks.length
    ? Math.round(
        100 * available.length / checks.length
      )
    : 0;

  /*
   * ==================================================
   * CONSTATS
   * ==================================================
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
   * AUDIT GRATUIT
   */

  if (hotel.type === 'free') {
    if (findings.length < 3) {
      const positives = checks
        .filter(
          check => check.status === 'pass'
        )
        .slice(
          0,
          3 - findings.length
        )
        .map(
          check => ({
            severity: 'ok',
            title: check.label,
            evidence: check.evidence,
            impact:
              'Point conforme sur la source publique analysée.',
            recommendation:
              'Maintenir cette information à jour.',
            sources: check.sources
          })
        );

      findings.push(...positives);
    }

    findings = findings.slice(0, 3);
  }

  /*
   * AUDIT PAYANT :
   * on indique aussi les canaux non vérifiés,
   * sans les compter comme anomalies.
   */

  if (hotel.type === 'paid') {
    const channelUnknowns = unknown
      .filter(
        check => check.category === 'channel'
      )
      .slice(0, 4)
      .map(
        check => ({
          severity: 'opportunité',
          title: `${check.label} - non vérifié`,
          evidence: check.evidence,
          impact:
            'Ce canal n’a pas pu être contrôlé automatiquement avec un niveau de fiabilité suffisant.',
          recommendation:
            'Vérifier manuellement ce canal s’il représente une part importante de la distribution de l’établissement.',
          sources: check.sources
        })
      );

    findings.push(...channelUnknowns);
  }

  /*
   * ==================================================
   * SOURCES
   * ==================================================
   */

  const sources = [
    ...new Set(
      pages
        .filter(
          page =>
            page.ok &&
            page.url
        )
        .map(
          page => page.url
        )
    )
  ];

  /*
   * ==================================================
   * PLAN D'ACTION
   * ==================================================
   */

  const commercialFailures = [
    ...failures
  ].sort(
    (a, b) =>
      priorityWeight(b) -
      priorityWeight(a)
  );

  const h48 = commercialFailures
    .slice(0, 3)
    .map(
      check => check.recommendation
    );

  const d7 = commercialFailures
    .slice(3, 6)
    .map(
      check => check.recommendation
    );

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
    .filter(
      page => !page.ok
    )
    .map(
      page =>
        `${page.channel} : ${page.error}`
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
  let candidates = [];

  /*
   * 1. Recherche directe sur la plateforme
   */

  try {
    candidates = await directPlatformSearch(
      browser,
      hotel,
      channel,
      timeout
    );

  } catch {
    candidates = [];
  }

  candidates = candidates.filter(
    url =>
      matchesChannelUrl(
        url,
        channel
      )
  );

  /*
   * 2. DuckDuckGo / Bing en secours
   */

  if (!candidates.length) {
    const config = CHANNELS[channel];

    for (const query of config.queries(hotel)) {
      const urls = await searchWeb(
        browser,
        query,
        channel,
        timeout
      );

      candidates.push(
        ...urls.filter(
          url =>
            matchesChannelUrl(
              url,
              channel
            )
        )
      );

      if (candidates.length) {
        break;
      }
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
    return {
      url: '',
      candidates: []
    };
  }

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

/*
 * ======================================================
 * RECHERCHE DIRECTE SUR LES PLATEFORMES
 * ======================================================
 */

async function directPlatformSearch(
  browser,
  hotel,
  channel,
  timeout
) {
  const query = encodeURIComponent(
    `${hotel.hotel_name} ${hotel.city}`
  );

  const configs = {
    booking: {
      url:
        `https://www.booking.com/searchresults.fr.html?ss=${query}`,

      selector:
        'a[href*="/hotel/"]'
    },

    expedia: {
      url:
        `https://www.expedia.fr/Hotel-Search?destination=${query}`,

      selector:
        'a[href*=".Description-Hotel"], a[href*="/Hotel-Information"]'
    },

    tripadvisor: {
      url:
        `https://www.tripadvisor.fr/Search?q=${query}`,

      selector:
        'a[href*="/Hotel_Review-"]'
    },

    google: {
      url:
        `https://www.google.com/travel/hotels?q=${query}`,

      selector:
        'a[href*="/travel/hotels/entity/"]'
    }
  };

  const config = configs[channel];

  if (!config) {
    return [];
  }

  const page = await browser.newPage();

  try {
    await page.goto(
      config.url,
      {
        waitUntil: 'domcontentloaded',
        timeout
      }
    );

    await page.waitForTimeout(2000);

    /*
     * IMPORTANT :
     * on analyse le contexte complet de la carte
     * et pas seulement le texte du lien.
     */

    const results = await page
      .locator(config.selector)
      .evaluateAll(
        links =>
          links.map(
            a => {
              const card =
                a.closest('[data-testid="property-card"]') ||
                a.closest('article') ||
                a.closest('li') ||
                a.closest('[role="listitem"]') ||
                a.parentElement;

              const context =
                (
                  card?.innerText ||
                  a.innerText ||
                  a.textContent ||
                  ''
                )
                  .replace(/\s+/g, ' ')
                  .trim();

              return {
                href: a.href,
                text: context
              };
            }
          )
      );

    const hotelName = normalize(
      hotel.hotel_name
    );

    const city = normalize(
      hotel.city
    );

    const importantWords = hotelName
      .split(' ')
      .filter(
        word =>
          word.length >= 3 &&
          ![
            'hotel',
            'hotellerie',
            'restaurant',
            'spa',
            'le',
            'la',
            'les',
            'de',
            'du',
            'des',
            'et'
          ].includes(word)
      );

    const scored = results
      .filter(
        result =>
          result.href &&
          matchesChannelUrl(
            result.href,
            channel
          )
      )
      .map(
        result => {
          let score = candidateScore(
            result.href,
            channel
          );

          let haystack = '';

          try {
            haystack = normalize(
              `${result.text} ${decodeURIComponent(result.href)}`
            );

          } catch {
            haystack = normalize(
              `${result.text} ${result.href}`
            );
          }

          /*
           * Nom complet
           */

          if (
            hotelName &&
            haystack.includes(hotelName)
          ) {
            score += 20;
          }

          /*
           * Ville
           */

          if (
            city &&
            haystack.includes(city)
          ) {
            score += 6;
          }

          /*
           * Mots distinctifs
           */

          for (const word of importantWords) {
            if (haystack.includes(word)) {
              score += 3;
            }
          }

          return {
            href: result.href,
            score
          };
        }
      );

    scored.sort(
      (a, b) =>
        b.score - a.score
    );

    /*
     * On privilégie uniquement les candidats
     * ayant un lien suffisamment fort avec
     * l'hôtel recherché.
     */

    const credible = scored.filter(
      item =>
        item.score >= 14
    );

    const finalResults =
      credible.length
        ? credible
        : scored;

    return [
      ...new Set(
        finalResults.map(
          item => item.href
        )
      )
    ];

  } finally {
    await page.close();
  }
}

/*
 * ======================================================
 * RECHERCHE WEB
 * ======================================================
 */

async function searchWeb(
  browser,
  query,
  channel,
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
                waitUntil:
                  'domcontentloaded',

                timeout
              }
            ),
          2
        );

        await page.waitForTimeout(1000);

        const rawLinks = await page
          .locator('a')
          .evaluateAll(
            anchors => {
              const results = [];

              for (const a of anchors) {
                if (a.href) {
                  results.push(a.href);
                }

                const dataHref =
                  a.getAttribute('data-href');

                if (dataHref) {
                  results.push(dataHref);
                }

                const dataUrl =
                  a.getAttribute('data-url');

                if (dataUrl) {
                  results.push(dataUrl);
                }
              }

              return results;
            }
          );

        for (const raw of rawLinks) {
          const url = unwrapSearchUrl(raw);

          if (url) {
            urls.push(url);
          }
        }

        /*
         * On s'arrête uniquement lorsqu'une
         * véritable URL du canal a été trouvée.
         */

        if (
          urls.some(
            url =>
              matchesChannelUrl(
                url,
                channel
              )
          )
        ) {
          break;
        }

      } catch {
        /*
         * moteur suivant
         */
      }
    }

    return [
      ...new Set(urls)
    ];

  } finally {
    await page.close();
  }
}

/*
 * ======================================================
 * DÉCODAGE DES URLS DES MOTEURS
 * ======================================================
 */

function unwrapSearchUrl(url) {
  try {
    const parsed = new URL(url);

    /*
     * DuckDuckGo
     */

    const uddg =
      parsed.searchParams.get('uddg');

    if (uddg) {
      return decodeURIComponent(uddg);
    }

    /*
     * Redirection directe
     */

    const direct =
      parsed.searchParams.get('url');

    if (
      direct &&
      /^https?:\/\//i.test(direct)
    ) {
      return direct;
    }

    /*
     * Bing
     */

    const bing =
      parsed.searchParams.get('u');

    if (bing) {
      const decoded =
        decodeBingUrl(bing);

      if (decoded) {
        return decoded;
      }
    }

    return url;

  } catch {
    return url;
  }
}

function decodeBingUrl(value) {
  try {
    let encoded = String(value);

    if (encoded.startsWith('a1')) {
      encoded = encoded.slice(2);
    }

    encoded = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    while (encoded.length % 4) {
      encoded += '=';
    }

    const decoded = Buffer
      .from(
        encoded,
        'base64'
      )
      .toString('utf8');

    return /^https?:\/\//i.test(decoded)
      ? decoded
      : '';

  } catch {
    return '';
  }
}

/*
 * ======================================================
 * VALIDATION DES DOMAINES
 * ======================================================
 */

function matchesChannelUrl(
  url,
  channel
) {
  try {
    const parsed = new URL(url);

    const host = parsed.hostname
      .toLowerCase()
      .replace(/^www\./, '');

    const path = parsed.pathname
      .toLowerCase();

    if (channel === 'booking') {
      return (
        host === 'booking.com' ||
        host.endsWith('.booking.com')
      );
    }

    if (channel === 'expedia') {
      return (
        host.startsWith('expedia.') ||
        host.includes('.expedia.') ||
        host === 'hotels.com' ||
        host.endsWith('.hotels.com')
      );
    }

    if (channel === 'tripadvisor') {
      return (
        host.startsWith('tripadvisor.') ||
        host.includes('.tripadvisor.')
      );
    }

    if (channel === 'google') {
      const googleHost =
        host.startsWith('google.') ||
        host.includes('.google.');

      return (
        googleHost &&
        (
          path.startsWith('/maps') ||
          path.startsWith('/travel')
        )
      );
    }

    return false;

  } catch {
    return false;
  }
}

function cleanCandidateUrl(url) {
  try {
    const parsed = new URL(url);

    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term'
    ]) {
      parsed.searchParams.delete(key);
    }

    return parsed.toString();

  } catch {
    return '';
  }
}

function candidateScore(
  url,
  channel
) {
  let score = 0;

  if (channel === 'booking') {
    if (/booking\.com/i.test(url)) {
      score += 5;
    }

    if (/\/hotel\//i.test(url)) {
      score += 5;
    }
  }

  if (channel === 'expedia') {
    if (/expedia\./i.test(url)) {
      score += 5;
    }

    if (/hotels\.com/i.test(url)) {
      score += 4;
    }

    if (/hotel/i.test(url)) {
      score += 3;
    }
  }

  if (channel === 'tripadvisor') {
    if (/tripadvisor\./i.test(url)) {
      score += 5;
    }

    if (/Hotel_Review/i.test(url)) {
      score += 5;
    }
  }

  if (channel === 'google') {
    if (/google\./i.test(url)) {
      score += 3;
    }

    if (/\/maps/i.test(url)) {
      score += 5;
    }

    if (/\/travel/i.test(url)) {
      score += 4;
    }
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
            waitUntil:
              'domcontentloaded',

            timeout
          }
        ),
      3
    );

    await page.waitForTimeout(1500);

    const finalUrl = page.url();

    /*
     * Protection :
     * une source OTA doit rester sur son
     * véritable domaine.
     */

    if (
      channel !== 'official' &&
      !matchesChannelUrl(
        finalUrl,
        channel
      )
    ) {
      return unavailable(
        channel,
        `La navigation n’a pas abouti à une véritable page ${capitalize(channel)}.`,
        finalUrl
      );
    }

    const data = await page.evaluate(
      () => {
        const bodyText =
          (
            document.body?.innerText ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();

        const jsonld = [
          ...document.querySelectorAll(
            'script[type="application/ld+json"]'
          )
        ]
          .map(
            element =>
              element.textContent || ''
          )
          .join(' ');

        const links = [
          ...document.links
        ]
          .map(
            link => ({
              text:
                (
                  link.innerText ||
                  ''
                )
                  .replace(/\s+/g, ' ')
                  .trim(),

              href:
                link.href
            })
          )
          .slice(0, 3000);

        const images = [
          ...document.images
        ]
          .slice(0, 1000)
          .map(
            image => ({
              src:
                image.currentSrc ||
                image.src ||
                '',

              alt:
                image.alt ||
                ''
            })
          );

        const metaDescription =
          document
            .querySelector(
              'meta[name="description"]'
            )
            ?.getAttribute('content') ||
          '';

        return {
          title:
            document.title || '',

          text:
            bodyText.slice(
              0,
              250000
            ),

          jsonld:
            jsonld.slice(
              0,
              100000
            ),

          links,

          images,

          metaDescription,

          lang:
            document.documentElement.lang ||
            ''
        };
      }
    );

    const firstText =
      data.text.slice(
        0,
        4000
      );

    if (
      data.text.length < 100 ||
      /captcha|access denied|verify you are human|robot check|unusual traffic/i.test(
        firstText
      )
    ) {
      return unavailable(
        channel,
        'Page bloquée ou contenu public insuffisant',
        finalUrl
      );
    }

    return {
      ok: true,
      channel,
      url: finalUrl,
      ...data
    };

  } catch (error) {
    return unavailable(
      channel,
      cleanError(error),
      url
    );

  } finally {
    await page.close();
  }
}

async function retry(
  fn,
  attempts
) {
  let error;

  for (
    let i = 0;
    i < attempts;
    i++
  ) {
    try {
      return await fn();

    } catch (currentError) {
      error = currentError;

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

function buildChecks(
  pages,
  hotel
) {
  const official = pages.find(
    page =>
      page.channel === 'official'
  );

  const accessible = pages.filter(
    page => page.ok
  );

  const otaPages = pages.filter(
    page =>
      page.channel !== 'official'
  );

  const checks = [];

  /*
   * 1
   */

  checks.push(
    checkOne(
      'identity',
      'Nom de l’hôtel',
      official,
      page =>
        contains(
          page,
          hotel.hotel_name
        ),
      'Le nom déclaré de l’établissement n’a pas été détecté clairement.',
      'Afficher le nom officiel de l’établissement de manière cohérente.',
      hotel.hotel_name
    )
  );

  /*
   * 2
   */

  checks.push(
    checkOne(
      'identity',
      'Ville / localisation',
      official,
      page =>
        contains(
          page,
          hotel.city
        ),
      'La ville déclarée n’a pas été détectée clairement.',
      'Afficher clairement la localisation et l’adresse de l’établissement.',
      hotel.city
    )
  );

  /*
   * 3
   */

  checks.push(
    checkOne(
      'contact',
      'Coordonnées de contact',
      official,
      page =>
        /\+?\d[\d .()-]{7,}|@[\w.-]+\.[a-z]{2,}/i.test(
          page.text
        ),
      'Aucun téléphone ou email public n’a été détecté.',
      'Rendre le téléphone ou l’adresse email facilement accessibles.',
      /(\+?\d[\d .()-]{7,}|[\w.-]+@[\w.-]+\.[a-z]{2,})/i
    )
  );

  /*
   * 4
   */

  checks.push(
    checkOne(
      'rooms',
      'Chambres et catégories',
      official,
      page =>
        /chambre|room|suite|studio|double|twin|familiale/i.test(
          page.text
        ),
      'Aucune catégorie de chambre claire n’a été détectée.',
      'Présenter clairement les principales catégories de chambres.',
      /(chambre|room|suite|studio|double|twin).{0,100}/i
    )
  );

  /*
   * 5
   */

  checks.push(
    checkOne(
      'amenities',
      'Équipements principaux',
      official,
      page =>
        /wifi|wi-fi|climatisation|air conditioning|piscine|spa|fitness|sauna/i.test(
          page.text
        ),
      'Aucun équipement principal n’a été détecté clairement.',
      'Publier une liste claire et à jour des équipements.',
      /(wifi|wi-fi|climatisation|piscine|spa|fitness|sauna).{0,100}/i
    )
  );

  /*
   * 6
   */

  checks.push(
    checkOne(
      'policies',
      'Horaires arrivée/départ',
      official,
      page =>
        /check.?in|check.?out|arrivée|départ/i.test(
          page.text
        ),
      'Horaires d’arrivée et de départ non détectés.',
      'Afficher clairement les horaires d’arrivée et de départ.',
      /(check.?in|check.?out|arrivée|départ).{0,100}/i
    )
  );

  /*
   * 7
   */

  checks.push(
    checkOne(
      'policies',
      'Annulation / prépaiement',
      official,
      page =>
        /annulation|cancel|rembours|pré.?paiement|prepayment/i.test(
          page.text
        ),
      'Conditions d’annulation ou de prépaiement non détectées.',
      'Rendre les principales conditions d’annulation et de paiement accessibles avant réservation.',
      /(annulation|cancel|rembours|pré.?paiement|prepayment).{0,140}/i
    )
  );

  /*
   * 8
   */

  checks.push(
    checkOne(
      'food',
      'Restaurant / petit-déjeuner',
      official,
      page =>
        /restaurant|petit.?déjeuner|breakfast|bar\b/i.test(
          page.text
        ),
      'Information sur le restaurant ou le petit-déjeuner non détectée.',
      'Clarifier l’offre de restauration et de petit-déjeuner.',
      /(restaurant|petit.?déjeuner|breakfast|bar\b).{0,120}/i
    )
  );

  /*
   * 9
   */

  checks.push(
    checkOne(
      'parking',
      'Parking',
      official,
      page =>
        /parking|stationnement|garage/i.test(
          page.text
        ),
      'Information parking non détectée.',
      'Préciser la disponibilité, les conditions et éventuellement le tarif du parking.',
      /(parking|stationnement|garage).{0,120}/i
    )
  );

  /*
   * 10
   */

  checks.push(
    checkOne(
      'reviews',
      'Avis / réputation',
      official,
      page =>
        /avis|reviews?|\b[0-9][,.][0-9]\s*\/\s*(5|10)|étoiles/i.test(
          page.text
        ),
      'Aucune preuve de réputation ou note client détectée.',
      'Mettre en avant des éléments de réassurance ou des avis vérifiables.',
      /(avis|reviews?|[0-9][,.][0-9]\s*\/\s*(5|10)|étoiles).{0,120}/i
    )
  );

  /*
   * 11
   */

  checks.push(
    checkOne(
      'direct',
      'Bouton de réservation directe',
      official,
      page =>
        page.links.some(
          link =>
            /réserver|reserver|book now|reservation|disponibilit/i.test(
              `${link.text} ${link.href}`
            )
        ),
      'Aucun appel à l’action de réservation directe détecté.',
      'Ajouter un bouton de réservation visible et accessible rapidement.',
      null,
      page => {
        const link = page.links.find(
          candidate =>
            /réserver|reserver|book now|reservation|disponibilit/i.test(
              `${candidate.text} ${candidate.href}`
            )
        );

        return link
          ? `${link.text || 'Lien réservation'} — ${link.href}`
          : '';
      }
    )
  );

  /*
   * 12
   */

  checks.push(
    checkOne(
      'direct',
      'Moteur de réservation',
      official,
      page => {
        const officialHost =
          hostname(hotel.website);

        return page.links.some(
          link => {
            const href =
              String(link.href || '');

            const host =
              hostname(href);

            return (
              /booking|reservation|availab|disponibil|book/i.test(
                `${link.text} ${href}`
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
      page => {
        const officialHost =
          hostname(hotel.website);

        const link = page.links.find(
          candidate => {
            const host =
              hostname(candidate.href);

            return (
              /booking|reservation|availab|disponibil|book/i.test(
                `${candidate.text} ${candidate.href}`
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

  /*
   * 13
   */

  checks.push(
    checkOne(
      'price',
      'Prix ou accès aux disponibilités',
      official,
      page =>
        /\b\d{2,4}\s?(€|EUR)|€\s?\d{2,4}/i.test(
          page.text
        ) ||
        page.links.some(
          link =>
            /tarif|prix|disponibil|réserver|reserver|book/i.test(
              `${link.text} ${link.href}`
            )
        ),
      'Aucun prix public ni accès évident aux disponibilités n’a été détecté.',
      'Permettre au visiteur d’accéder immédiatement aux tarifs et disponibilités.',
      /(\b\d{2,4}\s?(€|EUR)|€\s?\d{2,4})/i
    )
  );

  /*
   * 14
   */

  checks.push(
    checkOne(
      'content',
      'Contenu hôtelier substantiel',
      official,
      page =>
        page.text.length > 1200,
      'Le contenu public détecté est très limité.',
      'Enrichir les informations utiles sur les chambres, services, localisation et expérience.'
    )
  );

  /*
   * 15
   */

  checks.push(
    checkOne(
      'content',
      'Photos / galerie',
      official,
      page =>
        (page.images?.length || 0) >= 5 ||
        /photo|gallery|galerie/i.test(
          `${page.text} ${page.jsonld}`
        ),
      'Aucune galerie ou quantité significative de photos n’a été détectée.',
      'Présenter des photos récentes et facilement accessibles de l’établissement.',
      null,
      page =>
        `${page.images?.length || 0} image(s) détectée(s) sur la page analysée.`
    )
  );

  /*
   * 16-19 :
   * présence OTA / Google
   */

  for (const ota of otaPages) {
    checks.push(
      checkChannelPresence(ota)
    );
  }

  /*
   * 20 :
   * nom
   */

  checks.push(
    compareHotelName(
      accessible,
      hotel.hotel_name
    )
  );

  /*
   * 21 :
   * horaires
   */

  checks.push(
    compare(
      accessible,
      'Cohérence des horaires',
      page =>
        first(
          page.text,
          /(check.?in|check.?out|arrivée|départ).{0,100}/i
        ),
      'Harmoniser les horaires d’arrivée et de départ sur l’ensemble des canaux.'
    )
  );

  /*
   * 22 :
   * restaurant
   */

  checks.push(
    comparePresence(
      accessible,
      'Cohérence restaurant / petit-déjeuner',
      /restaurant|petit.?déjeuner|breakfast/i,
      'Harmoniser les informations de restauration entre les canaux.'
    )
  );

  /*
   * 23 :
   * parking
   */

  checks.push(
    comparePresence(
      accessible,
      'Cohérence parking',
      /parking|stationnement|garage/i,
      'Harmoniser les informations de parking entre les canaux.'
    )
  );

  /*
   * 24 :
   * tarifs
   */

  checks.push(
    priceCompare(accessible)
  );

  return checks;
}

/*
 * ======================================================
 * CONTRÔLES SIMPLES
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
      page?.error ||
        'Source inaccessible',
      page?.url
    );
  }

  const ok = Boolean(
    test(page)
  );

  let evidence = failEvidence;

  if (ok) {
    let detail = '';

    if (customEvidence) {
      detail =
        customEvidence(page) ||
        '';

    } else if (
      evidencePattern instanceof RegExp
    ) {
      detail = extractEvidence(
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

/*
 * ======================================================
 * COHÉRENCE DU NOM
 * ======================================================
 */

function compareHotelName(
  pages,
  expectedName
) {
  if (pages.length < 2) {
    return unknown(
      'consistency',
      'Cohérence du nom de l’établissement',
      'Moins de deux sources publiques comparables.',
      ...pages.map(
        page => page.url
      )
    );
  }

  const ignored = new Set([
    'hotel',
    'hotellerie',
    'restaurant',
    'spa',
    'le',
    'la',
    'les',
    'de',
    'du',
    'des',
    'et'
  ]);

  const tokens = normalize(
    expectedName
  )
    .split(' ')
    .filter(
      word =>
        word.length >= 3 &&
        !ignored.has(word)
    );

  const results = pages.map(
    page => {
      const haystack = normalize(
        `${page.title || ''} ${safeDecode(page.url || '')} ${(page.text || '').slice(0, 6000)}`
      );

      const matched = tokens.filter(
        token =>
          haystack.includes(token)
      );

      const ratio = tokens.length
        ? matched.length / tokens.length
        : 0;

      return {
        channel: page.channel,
        url: page.url,
        ratio
      };
    }
  );

  const mismatches = results.filter(
    result =>
      result.ratio < 0.6
  );

  return {
    category: 'consistency',

    label:
      'Cohérence du nom de l’établissement',

    status:
      mismatches.length
        ? 'fail'
        : 'pass',

    evidence:
      mismatches.length
        ? `Le nom semble insuffisamment concordant sur : ${mismatches
            .map(
              item =>
                capitalize(item.channel)
            )
            .join(', ')}.`
        : `Le nom de l’établissement est concordant sur ${results.length} sources publiques.`,

    recommendation:
      'Harmoniser le nom de l’établissement entre les canaux publics.',

    sources:
      results.map(
        item => item.url
      )
  };
}

/*
 * ======================================================
 * COHÉRENCE DE PRÉSENCE
 * ======================================================
 */

function comparePresence(
  pages,
  label,
  regex,
  recommendation
) {
  if (pages.length < 2) {
    return unknown(
      'consistency',
      label,
      'Moins de deux sources publiques comparables.',
      ...pages.map(
        page => page.url
      )
    );
  }

  const results = pages.map(
    page => ({
      channel: page.channel,
      url: page.url,

      present: regex.test(
        `${page.text || ''} ${page.jsonld || ''}`
      )
    })
  );

  const positives = results.filter(
    item => item.present
  );

  const negatives = results.filter(
    item => !item.present
  );

  if (
    positives.length === 0 ||
    negatives.length === 0
  ) {
    return {
      category: 'consistency',
      label,
      status: 'pass',

      evidence:
        positives.length === results.length
          ? `Information détectée sur les ${results.length} sources accessibles.`
          : `Information non détectée sur les ${results.length} sources accessibles ; aucune contradiction publique observée.`,

      recommendation,

      sources:
        results.map(
          item => item.url
        )
    };
  }

  return {
    category: 'consistency',
    label,
    status: 'fail',

    evidence:
      `Information détectée sur ${positives
        .map(
          item =>
            capitalize(item.channel)
        )
        .join(', ')}, mais non détectée sur ${negatives
        .map(
          item =>
            capitalize(item.channel)
        )
        .join(', ')}.`,

    recommendation,

    sources:
      results.map(
        item => item.url
      )
  };
}

/*
 * ======================================================
 * COMPARAISON GÉNÉRIQUE
 * ======================================================
 */

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

        value: normalize(
          extract(page) || ''
        )
      })
    )
    .filter(
      item => item.value
    );

  if (values.length < 2) {
    return unknown(
      'consistency',
      label,
      'Moins de deux sources publiques comparables.',
      ...values.map(
        item => item.url
      )
    );
  }

  const unique = [
    ...new Set(
      values.map(
        item => item.value
      )
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
      values.map(
        item => item.url
      )
  };
}

/*
 * ======================================================
 * TARIFS
 * ======================================================
 */

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
            ) ||
            []
          )[0]
      })
    )
    .filter(
      item => item.value
    );

  if (values.length < 2) {
    return unknown(
      'price',
      'Comparaison des prix publics',
      'Moins de deux tarifs publics accessibles ont été détectés.',
      ...values.map(
        item => item.url
      )
    );
  }

  /*
   * On ne déclare jamais automatiquement
   * une disparité tarifaire :
   * il faut mêmes dates, chambre,
   * occupation et conditions.
   */

  return unknown(
    'price',
    'Comparaison des prix publics',
    `${values.length} prix publics ont été détectés, mais une comparaison fiable nécessite les mêmes dates, la même occupation, la même chambre et les mêmes conditions.`,
    ...values.map(
      item => item.url
    )
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
 * PRIORITÉS / IMPACT
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

  return (
    impacts[check.category] ||
    'Ce point peut affecter la qualité de la présence digitale de l’établissement.'
  );
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

  return (
    weights[check.category] ||
    20
  );
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
  const haystack = normalize(
    `${page.title || ''} ${safeDecode(page.url || '')} ${(page.text || '').slice(0, 6000)}`
  );

  const name = normalize(
    hotel.hotel_name
  );

  const city = normalize(
    hotel.city
  );

  const significantWords = name
    .split(' ')
    .filter(
      word =>
        word.length >= 3 &&
        ![
          'hotel',
          'hotellerie',
          'restaurant',
          'spa',
          'le',
          'la',
          'les',
          'de',
          'du',
          'des',
          'et'
        ].includes(word)
    );

  let score = 0;

  /*
   * Nom complet
   */

  if (
    name &&
    haystack.includes(name)
  ) {
    score += 5;
  }

  /*
   * Ville
   */

  if (
    city &&
    haystack.includes(city)
  ) {
    score += 3;
  }

  /*
   * Mots distinctifs dans tout le contenu
   */

  for (const word of significantWords) {
    if (haystack.includes(word)) {
      score += 1;
    }
  }

  /*
   * BONUS IMPORTANT :
   * Booking / Tripadvisor contiennent souvent
   * le nom directement dans l'URL.
   */

  const urlText = normalize(
    safeDecode(page.url || '')
  );

  const urlMatches =
    significantWords.filter(
      word =>
        urlText.includes(word)
    ).length;

  if (urlMatches >= 2) {
    score += 6;
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
  const match = String(
    text || ''
  ).match(regex);

  if (!match) {
    return '';
  }

  const value = String(
    match[0] ||
    match[1] ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();

  return value.length > 180
    ? value.slice(0, 177) + '...'
    : value;
}

function contains(
  page,
  text
) {
  return normalize(
    page.text
  ).includes(
    normalize(text)
  );
}

function normalize(value) {
  return String(
    value || ''
  )
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

function first(
  text,
  regex
) {
  const match = String(
    text || ''
  ).match(regex);

  return match
    ? match[0]
    : '';
}

function hostname(url) {
  try {
    return new URL(url)
      .hostname
      .replace(
        /^www\./,
        ''
      );

  } catch {
    return '';
  }
}

function capitalize(text) {
  const value = String(
    text || ''
  );

  return value
    ? value.charAt(0).toUpperCase() +
      value.slice(1)
    : '';
}

function safeDecode(value) {
  try {
    return decodeURIComponent(
      String(
        value || ''
      )
    );

  } catch {
    return String(
      value || ''
    );
  }
}

function cleanError(error) {
  return String(
    error?.message ||
    error ||
    'Erreur inconnue'
  )
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}
