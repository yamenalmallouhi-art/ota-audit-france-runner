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
      `site:hotels.com "${h.hotel_name}" "${h.city}"`,
      `"${h.hotel_name}" "${h.city}" Expedia`
    ]
  },
  google: {
    queries: h => [
      `site:google.com/travel/hotels "${h.hotel_name}" "${h.city}"`,
      `site:google.fr/travel/hotels "${h.hotel_name}" "${h.city}"`,
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

const IGNORED_NAME_WORDS = new Set([
  'hotel',
  'hotellerie',
  'hostellerie',
  'restaurant',
  'spa',
  'le',
  'la',
  'les',
  'de',
  'du',
  'des',
  'et',
  'the',
  'and'
]);

export async function auditHotel(browser, hotel, options = {}) {
  const timeout = options.timeout ?? 30000;
  const pages = [];
  const limitations = [];

  pages.push(
    await visit(
      browser,
      hotel.website,
      'official',
      timeout
    )
  );

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

      console.log(
        '[OTA DEBUG]',
        channel,
        'selected =',
        result.url || 'NONE',
        'candidates =',
        result.candidates || []
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

  const unknownChecks = checks.filter(
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

  if (hotel.type === 'free') {
    if (findings.length < 3) {
      findings.push(
        ...checks
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
          )
      );
    }

    findings = findings.slice(0, 3);
  }

  if (hotel.type === 'paid') {
    findings.push(
      ...unknownChecks
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
        )
    );
  }

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
      item => item.recommendation
    );

  const d7 = commercialFailures
    .slice(3, 6)
    .map(
      item => item.recommendation
    );

  if (!d7.length) {
    d7.push(
      'Harmoniser les informations essentielles entre le site officiel et les canaux OTA accessibles.'
    );
  }

  const summary =
    `${available.length} contrôles observables sur ${checks.length} (${coverage}% de couverture). ` +
    `${failures.length} anomalie(s) vérifiée(s). ${passed.length} point(s) conforme(s). ` +
    'Les contrôles inaccessibles sont exclus du score.';

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
      unknown: unknownChecks.length,
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

      d30: [
        'Répéter l’audit après corrections et mesurer l’évolution des réservations directes.',
        'Comparer régulièrement les informations publiques entre les principaux canaux de distribution.'
      ]
    },

    limitations: [
      ...limitations,

      ...pages
        .filter(
          page => !page.ok
        )
        .map(
          page =>
            `${page.channel} : ${page.error}`
        )
    ],

    sources
  };
}

async function discoverChannel(
  browser,
  hotel,
  channel,
  timeout
) {
  let directCandidates = [];

  try {
    directCandidates =
      await directPlatformSearch(
        browser,
        hotel,
        channel,
        timeout
      );

    console.log(
      '[OTA DIRECT]',
      channel,
      'count =',
      directCandidates.length,
      'results =',
      directCandidates
    );

  } catch (error) {
    console.log(
      '[OTA DIRECT ERROR]',
      channel,
      cleanError(error)
    );

    directCandidates = [];
  }

  let candidates = [
    ...directCandidates
  ];

  if (!candidates.length) {
    for (
      const query
      of CHANNELS[channel].queries(hotel)
    ) {
      try {
        const found =
          await searchWeb(
            browser,
            query,
            channel,
            hotel,
            timeout
          );

        console.log(
          '[OTA SEARCH]',
          channel,
          'query =',
          query,
          'count =',
          found.length,
          'results =',
          found
        );

        candidates.push(
          ...found
        );

        if (candidates.length) {
          break;
        }

      } catch (error) {
        console.log(
          '[OTA SEARCH ERROR]',
          channel,
          'query =',
          query,
          cleanError(error)
        );
      }
    }
  }

  const unique =
    dedupeCandidates(
      candidates
    )
      .filter(
        candidate =>
          matchesChannelUrl(
            candidate.url,
            channel
          )
      )
      .map(
        candidate => ({
          ...candidate,

          ...scoreHotelCandidate(
            candidate.url,
            candidate.text,
            hotel,
            channel
          )
        })
      )
      .filter(
        candidate =>
          isCredibleHotelCandidate(
            candidate,
            hotel
          )
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  console.log(
    '[OTA FINAL]',
    channel,
    'count =',
    unique.length,
    'results =',
    unique
  );

  return {
    url:
      unique[0]?.url ||
      '',

    candidates:
      unique
        .slice(0, 5)
        .map(
          item => item.url
        )
  };
}

async function directPlatformSearch(
  browser,
  hotel,
  channel,
  timeout
) {
  const query =
    encodeURIComponent(
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
        'a[href*=".Description-Hotel"], a[href*="/Hotel-Information"], a[href*=".Hotel-Information"]'
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

  const config =
    configs[channel];

  if (!config) {
    return [];
  }

  const page =
    await browser.newPage();

  try {
    await page.goto(
      config.url,
      {
        waitUntil:
          'domcontentloaded',

        timeout
      }
    );

    await page.waitForTimeout(
      2200
    );

    console.log(
  '[OTA PAGE]',
  channel,
  'url =',
  page.url(),
  'title =',
  await page.title(),
  'links =',
  await page.locator('a').count(),
  'text =',
  (
    await page.locator('body').innerText().catch(() => '')
  )
    .replace(/\s+/g, ' ')
    .slice(0, 500)
);

    const raw =
      await page
        .locator(
          config.selector
        )
        .evaluateAll(
          links =>
            links.map(
              link => {
                const card =
                  link.closest(
                    '[data-testid="property-card"]'
                  ) ||
                  link.closest(
                    'article'
                  ) ||
                  link.closest(
                    'li'
                  ) ||
                  link.closest(
                    '[role="listitem"]'
                  ) ||
                  link.parentElement;

                return {
                  url:
                    link.href,

                  text:
                    (
                      card?.innerText ||
                      link.innerText ||
                      link.textContent ||
                      ''
                    )
                      .replace(
                        /\s+/g,
                        ' '
                      )
                      .trim()
                };
              }
            )
        );

    return dedupeCandidates(
      raw
    )
      .filter(
        candidate =>
          matchesChannelUrl(
            candidate.url,
            channel
          )
      )
      .map(
        candidate => ({
          ...candidate,

          ...scoreHotelCandidate(
            candidate.url,
            candidate.text,
            hotel,
            channel
          )
        })
      )
      .filter(
        candidate =>
          isCredibleHotelCandidate(
            candidate,
            hotel
          )
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      )
      .map(
        candidate => ({
          url:
            candidate.url,

          text:
            candidate.text
        })
      );

  } finally {
    await page.close();
  }
}

async function searchWeb(
  browser,
  query,
  channel,
  hotel,
  timeout
) {
  const page =
    await browser.newPage();

  const encoded =
    encodeURIComponent(
      query
    );

  const engines = [
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    `https://www.bing.com/search?q=${encoded}`
  ];

  const candidates = [];

  try {
    for (
      const engine
      of engines
    ) {
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

        await page.waitForTimeout(
          1000
        );

        const links =
          await page
            .locator(
              'a'
            )
            .evaluateAll(
              anchors =>
                anchors.map(
                  anchor => ({
                    href:
                      anchor.href ||
                      '',

                    dataHref:
                      anchor.getAttribute(
                        'data-href'
                      ) ||
                      '',

                    dataUrl:
                      anchor.getAttribute(
                        'data-url'
                      ) ||
                      '',

                    text:
                      (
                        anchor.innerText ||
                        anchor.textContent ||
                        anchor.closest(
                          'li'
                        )?.innerText ||
                        ''
                      )
                        .replace(
                          /\s+/g,
                          ' '
                        )
                        .trim()
                  })
                )
            );

        for (
          const item
          of links
        ) {
          for (
            const rawUrl
            of [
              item.href,
              item.dataHref,
              item.dataUrl
            ]
          ) {
            if (!rawUrl) {
              continue;
            }

            const url =
              unwrapSearchUrl(
                rawUrl
              );

            if (
              !url ||
              !matchesChannelUrl(
                url,
                channel
              )
            ) {
              continue;
            }

            const scored =
              scoreHotelCandidate(
                url,
                item.text,
                hotel,
                channel
              );

            if (
              isCredibleHotelCandidate(
                scored,
                hotel
              )
            ) {
              candidates.push({
                url,
                text:
                  item.text
              });
            }
          }
        }

        if (
          candidates.length
        ) {
          break;
        }

      } catch {
        // moteur suivant
      }
    }

    return dedupeCandidates(
      candidates
    );

  } finally {
    await page.close();
  }
}

function scoreHotelCandidate(
  url,
  text,
  hotel,
  channel
) {
  const sig =
    hotelSignature(
      hotel
    );

  const haystack =
    normalize(
      `${safeDecode(url)} ${text || ''}`
    );

  const fullNameMatch =
    Boolean(
      sig.name &&
      haystack.includes(
        sig.name
      )
    );

  const cityMatch =
    Boolean(
      sig.city &&
      haystack.includes(
        sig.city
      )
    );

  const matchedWords =
    sig.words.filter(
      word =>
        haystack.includes(
          word
        )
    );

  let score =
    candidateScore(
      url,
      channel
    );

  if (
    fullNameMatch
  ) {
    score += 30;
  }

  if (
    cityMatch
  ) {
    score += 6;
  }

  score +=
    matchedWords.length *
    8;

  return {
    score,

    fullNameMatch,

    cityMatch,

    matchedWords:
      matchedWords.length,

    totalNameWords:
      sig.words.length
  };
}

function isCredibleHotelCandidate(
  candidate,
  hotel
) {
  const sig =
    hotelSignature(
      hotel
    );

  if (
    candidate.fullNameMatch
  ) {
    return true;
  }

  if (
    sig.words.length >= 2
  ) {
    return (
      candidate.matchedWords >= 2
    );
  }

  if (
    sig.words.length === 1
  ) {
    return (
      candidate.matchedWords >= 1 &&
      candidate.cityMatch
    );
  }

  return false;
}

function hotelSignature(
  hotel
) {
  const name =
    normalize(
      hotel.hotel_name
    );

  const city =
    normalize(
      hotel.city
    );

  const words =
    name
      .split(' ')
      .filter(
        word =>
          word.length >= 3 &&
          !IGNORED_NAME_WORDS.has(
            word
          )
      );

  return {
    name,
    city,
    words
  };
}

function dedupeCandidates(
  items
) {
  const map =
    new Map();

  for (
    const item
    of items || []
  ) {
    const raw =
      typeof item === 'string'
        ? {
            url:
              item,
            text:
              ''
          }
        : item;

    const cleaned =
      cleanCandidateUrl(
        raw.url ||
        ''
      );

    if (!cleaned) {
      continue;
    }

    const old =
      map.get(
        cleaned
      );

    if (
      !old ||
      (
        raw.text ||
        ''
      ).length >
      (
        old.text ||
        ''
      ).length
    ) {
      map.set(
        cleaned,
        {
          url:
            cleaned,

          text:
            raw.text ||
            ''
        }
      );
    }
  }

  return [
    ...map.values()
  ];
}

function unwrapSearchUrl(
  url
) {
  try {
    const parsed =
      new URL(
        url
      );

    const uddg =
      parsed.searchParams.get(
        'uddg'
      );

    if (uddg) {
      return decodeURIComponent(
        uddg
      );
    }

    const direct =
      parsed.searchParams.get(
        'url'
      );

    if (
      direct &&
      /^https?:\/\//i.test(
        direct
      )
    ) {
      return direct;
    }

    const bing =
      parsed.searchParams.get(
        'u'
      );

    if (bing) {
      const decoded =
        decodeBingUrl(
          bing
        );

      if (decoded) {
        return decoded;
      }
    }

    return url;

  } catch {
    return url;
  }
}

function decodeBingUrl(
  value
) {
  try {
    let encoded =
      String(
        value
      );

    if (
      encoded.startsWith(
        'a1'
      )
    ) {
      encoded =
        encoded.slice(
          2
        );
    }

    encoded =
      encoded
        .replace(
          /-/g,
          '+'
        )
        .replace(
          /_/g,
          '/'
        );

    while (
      encoded.length %
      4
    ) {
      encoded += '=';
    }

    const decoded =
      Buffer
        .from(
          encoded,
          'base64'
        )
        .toString(
          'utf8'
        );

    return /^https?:\/\//i.test(
      decoded
    )
      ? decoded
      : '';

  } catch {
    return '';
  }
}

function matchesChannelUrl(
  url,
  channel
) {
  try {
    const parsed =
      new URL(
        url
      );

    const host =
      parsed.hostname
        .toLowerCase()
        .replace(
          /^www\./,
          ''
        );

    const path =
      parsed.pathname
        .toLowerCase();

    if (
      channel === 'booking'
    ) {
      return (
        host ===
        'booking.com' ||
        host.endsWith(
          '.booking.com'
        )
      );
    }

    if (
      channel === 'expedia'
    ) {
      return (
        host.startsWith(
          'expedia.'
        ) ||
        host.includes(
          '.expedia.'
        ) ||
        host ===
        'hotels.com' ||
        host.endsWith(
          '.hotels.com'
        )
      );
    }

    if (
      channel === 'tripadvisor'
    ) {
      return (
        host.startsWith(
          'tripadvisor.'
        ) ||
        host.includes(
          '.tripadvisor.'
        )
      );
    }

    if (
      channel === 'google'
    ) {
      const googleHost =
        host.startsWith(
          'google.'
        ) ||
        host.includes(
          '.google.'
        );

      return (
        googleHost &&
        (
          path.startsWith(
            '/maps'
          ) ||
          path.startsWith(
            '/travel'
          )
        )
      );
    }

    return false;

  } catch {
    return false;
  }
}

function cleanCandidateUrl(
  url
) {
  try {
    const parsed =
      new URL(
        url
      );

    for (
      const key
      of [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'aid',
        'label',
        'sid',
        'source',
        'sourceid',
        'gclid',
        'fbclid'
      ]
    ) {
      parsed.searchParams.delete(
        key
      );
    }

    parsed.hash = '';

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

  if (
    channel === 'booking'
  ) {
    if (
      /booking\.com/i.test(
        url
      )
    ) {
      score += 5;
    }

    if (
      /\/hotel\//i.test(
        url
      )
    ) {
      score += 8;
    }
  }

  if (
    channel === 'expedia'
  ) {
    if (
      /expedia\./i.test(
        url
      )
    ) {
      score += 5;
    }

    if (
      /hotels\.com/i.test(
        url
      )
    ) {
      score += 4;
    }

    if (
      /Description-Hotel|Hotel-Information/i.test(
        url
      )
    ) {
      score += 8;
    }
  }

  if (
    channel ===
    'tripadvisor'
  ) {
    if (
      /tripadvisor\./i.test(
        url
      )
    ) {
      score += 5;
    }

    if (
      /Hotel_Review/i.test(
        url
      )
    ) {
      score += 8;
    }
  }

  if (
    channel === 'google'
  ) {
    if (
      /google\./i.test(
        url
      )
    ) {
      score += 3;
    }

    if (
      /\/maps/i.test(
        url
      )
    ) {
      score += 5;
    }

    if (
      /\/travel\/hotels\/entity\//i.test(
        url
      )
    ) {
      score += 8;
    }
  }

  return score;
}

async function visit(
  browser,
  url,
  channel,
  timeout
) {
  const page =
    await browser.newPage();

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

    await page.waitForTimeout(
      1500
    );

    const finalUrl =
      page.url();

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

    const data =
      await page.evaluate(
        () => {
          const text =
            (
              document.body
                ?.innerText ||
              ''
            )
              .replace(
                /\s+/g,
                ' '
              )
              .trim();

          const jsonld = [
            ...document.querySelectorAll(
              'script[type="application/ld+json"]'
            )
          ]
            .map(
              item =>
                item.textContent ||
                ''
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
                    .replace(
                      /\s+/g,
                      ' '
                    )
                    .trim(),

                href:
                  link.href
              })
            )
            .slice(
              0,
              3000
            );

          const images = [
            ...document.images
          ]
            .slice(
              0,
              1000
            )
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

          return {
            title:
              document.title ||
              '',

            text:
              text.slice(
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

            metaDescription:
              document
                .querySelector(
                  'meta[name="description"]'
                )
                ?.getAttribute(
                  'content'
                ) ||
              '',

            lang:
              document
                .documentElement
                .lang ||
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
      ok:
        true,

      channel,

      url:
        finalUrl,

      ...data
    };

  } catch (error) {
    return unavailable(
      channel,
      cleanError(
        error
      ),
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
      error =
        currentError;

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            500 *
            2 ** i
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
    ok:
      false,

    channel,

    url,

    error,

    text:
      '',

    jsonld:
      '',

    links:
      [],

    images:
      []
  };
}

function buildChecks(
  pages,
  hotel
) {
  const official =
    pages.find(
      page =>
        page.channel ===
        'official'
    );

  const accessible =
    pages.filter(
      page =>
        page.ok
    );

  const otaPages =
    pages.filter(
      page =>
        page.channel !==
        'official'
    );

  const checks = [];

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
        const link =
          page.links.find(
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

  checks.push(
    checkOne(
      'direct',
      'Moteur de réservation',
      official,
      page => {
        const officialHost =
          hostname(
            hotel.website
          );

        return page.links.some(
          link => {
            const host =
              hostname(
                link.href
              );

            return (
              /booking|reservation|availab|disponibil|book/i.test(
                `${link.text} ${link.href}`
              ) &&
              host &&
              host !==
              officialHost
            );
          }
        );
      },
      'Aucun moteur de réservation distinct n’a été détecté.',
      'Vérifier que le moteur de réservation directe est accessible, rapide et correctement relié au site.',
      null,
      page => {
        const officialHost =
          hostname(
            hotel.website
          );

        const link =
          page.links.find(
            candidate => {
              const host =
                hostname(
                  candidate.href
                );

              return (
                /booking|reservation|availab|disponibil|book/i.test(
                  `${candidate.text} ${candidate.href}`
                ) &&
                host &&
                host !==
                officialHost
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

  checks.push(
    checkOne(
      'content',
      'Contenu hôtelier substantiel',
      official,
      page =>
        page.text.length >
        1200,
      'Le contenu public détecté est très limité.',
      'Enrichir les informations utiles sur les chambres, services, localisation et expérience.'
    )
  );

  checks.push(
    checkOne(
      'content',
      'Photos / galerie',
      official,
      page =>
        (
          page.images?.length ||
          0
        ) >= 5 ||
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

  for (
    const ota
    of otaPages
  ) {
    checks.push(
      checkChannelPresence(
        ota
      )
    );
  }

  checks.push(
    compareHotelName(
      accessible,
      hotel.hotel_name
    )
  );

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

  checks.push(
    comparePresence(
      accessible,
      'Cohérence restaurant / petit-déjeuner',
      /restaurant|petit.?déjeuner|breakfast/i,
      'Harmoniser les informations de restauration entre les canaux.'
    )
  );

  checks.push(
    comparePresence(
      accessible,
      'Cohérence parking',
      /parking|stationnement|garage/i,
      'Harmoniser les informations de parking entre les canaux.'
    )
  );

  checks.push(
    priceCompare(
      accessible
    )
  );

  return checks;
}

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

  const ok =
    Boolean(
      test(
        page
      )
    );

  let evidence =
    failEvidence;

  if (ok) {
    let detail = '';

    if (
      customEvidence
    ) {
      detail =
        customEvidence(
          page
        ) ||
        '';

    } else if (
      evidencePattern instanceof RegExp
    ) {
      detail =
        extractEvidence(
          page.text,
          evidencePattern
        );
    }

    evidence =
      detail
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
    ].filter(
      Boolean
    )
  };
}

function checkChannelPresence(
  page
) {
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
    category:
      'channel',

    label,

    status:
      'pass',

    evidence:
      `Une page publique ${capitalize(page.channel)} correspondant à l’établissement a été trouvée.`,

    recommendation:
      'Maintenir cette fiche à jour et cohérente avec le site officiel.',

    sources: [
      page.url
    ].filter(
      Boolean
    )
  };
}

function compareHotelName(
  pages,
  expectedName
) {
  if (
    pages.length < 2
  ) {
    return unknown(
      'consistency',
      'Cohérence du nom de l’établissement',
      'Moins de deux sources publiques comparables.',
      ...pages.map(
        page =>
          page.url
      )
    );
  }

  const sig =
    hotelSignature({
      hotel_name:
        expectedName,

      city:
        ''
    });

  const results =
    pages.map(
      page => {
        const haystack =
          normalize(
            `${page.title || ''} ${safeDecode(page.url || '')} ${(page.text || '').slice(0, 6000)}`
          );

        const matched =
          sig.words.filter(
            word =>
              haystack.includes(
                word
              )
          );

        const ratio =
          sig.words.length
            ? matched.length /
              sig.words.length
            : 0;

        return {
          channel:
            page.channel,

          url:
            page.url,

          ratio
        };
      }
    );

  const mismatches =
    results.filter(
      result =>
        result.ratio <
        0.6
    );

  return {
    category:
      'consistency',

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
                capitalize(
                  item.channel
                )
            )
            .join(', ')}.`
        : `Le nom de l’établissement est concordant sur ${results.length} sources publiques.`,

    recommendation:
      'Harmoniser le nom de l’établissement entre les canaux publics.',

    sources:
      results.map(
        item =>
          item.url
      )
  };
}

function comparePresence(
  pages,
  label,
  regex,
  recommendation
) {
  if (
    pages.length < 2
  ) {
    return unknown(
      'consistency',
      label,
      'Moins de deux sources publiques comparables.',
      ...pages.map(
        page =>
          page.url
      )
    );
  }

  const results =
    pages.map(
      page => ({
        channel:
          page.channel,

        url:
          page.url,

        present:
          regex.test(
            `${page.text || ''} ${page.jsonld || ''}`
          )
      })
    );

  const positives =
    results.filter(
      item =>
        item.present
    );

  const negatives =
    results.filter(
      item =>
        !item.present
    );

  if (
    !positives.length ||
    !negatives.length
  ) {
    return {
      category:
        'consistency',

      label,

      status:
        'pass',

      evidence:
        positives.length ===
        results.length
          ? `Information détectée sur les ${results.length} sources accessibles.`
          : `Information non détectée sur les ${results.length} sources accessibles ; aucune contradiction publique observée.`,

      recommendation,

      sources:
        results.map(
          item =>
            item.url
        )
    };
  }

  return {
    category:
      'consistency',

    label,

    status:
      'fail',

    evidence:
      `Information détectée sur ${positives
        .map(
          item =>
            capitalize(
              item.channel
            )
        )
        .join(', ')}, mais non détectée sur ${negatives
        .map(
          item =>
            capitalize(
              item.channel
            )
        )
        .join(', ')}.`,

    recommendation,

    sources:
      results.map(
        item =>
          item.url
      )
  };
}

function compare(
  pages,
  label,
  extract,
  recommendation
) {
  const values =
    pages
      .map(
        page => ({
          url:
            page.url,

          channel:
            page.channel,

          value:
            normalize(
              extract(
                page
              ) ||
              ''
            )
        })
      )
      .filter(
        item =>
          item.value
      );

  if (
    values.length < 2
  ) {
    return unknown(
      'consistency',
      label,
      'Moins de deux sources publiques comparables.',
      ...values.map(
        item =>
          item.url
      )
    );
  }

  const unique = [
    ...new Set(
      values.map(
        item =>
          item.value
      )
    )
  ];

  return {
    category:
      'consistency',

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
        item =>
          item.url
      )
  };
}

function priceCompare(
  pages
) {
  const values =
    pages
      .map(
        page => ({
          url:
            page.url,

          channel:
            page.channel,

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
        item =>
          item.value
      );

  if (
    values.length < 2
  ) {
    return unknown(
      'price',
      'Comparaison des prix publics',
      'Moins de deux tarifs publics accessibles ont été détectés.',
      ...values.map(
        item =>
          item.url
      )
    );
  }

  return unknown(
    'price',
    'Comparaison des prix publics',
    `${values.length} prix publics ont été détectés, mais une comparaison fiable nécessite les mêmes dates, la même occupation, la même chambre et les mêmes conditions.`,
    ...values.map(
      item =>
        item.url
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

    status:
      'unknown',

    evidence,

    recommendation:
      'Aucune pénalité appliquée au score.',

    sources:
      sources.filter(
        Boolean
      )
  };
}

function severityFor(
  check
) {
  if (
    [
      'direct',
      'price',
      'policies'
    ].includes(
      check.category
    )
  ) {
    return 'critique';
  }

  if (
    [
      'identity',
      'consistency',
      'channel',
      'contact'
    ].includes(
      check.category
    )
  ) {
    return 'important';
  }

  return 'opportunité';
}

function impactFor(
  check
) {
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
    impacts[
      check.category
    ] ||
    'Ce point peut affecter la qualité de la présence digitale de l’établissement.'
  );
}

function priorityWeight(
  check
) {
  const weights = {
    direct:
      100,

    price:
      95,

    policies:
      90,

    consistency:
      80,

    channel:
      75,

    reviews:
      70,

    identity:
      65,

    contact:
      60,

    rooms:
      55,

    amenities:
      50,

    food:
      45,

    parking:
      40,

    content:
      35
  };

  return (
    weights[
      check.category
    ] ||
    20
  );
}

function hotelMatchConfidence(
  page,
  hotel
) {
  const sig =
    hotelSignature(
      hotel
    );

  const haystack =
    normalize(
      `${page.title || ''} ${safeDecode(page.url || '')} ${(page.text || '').slice(0, 6000)}`
    );

  const matched =
    sig.words.filter(
      word =>
        haystack.includes(
          word
        )
    ).length;

  const full =
    Boolean(
      sig.name &&
      haystack.includes(
        sig.name
      )
    );

  const city =
    Boolean(
      sig.city &&
      haystack.includes(
        sig.city
      )
    );

  if (full) {
    return 'high';
  }

  if (
    sig.words.length >= 2 &&
    matched >= 2
  ) {
    return 'high';
  }

  if (
    sig.words.length === 1 &&
    matched === 1 &&
    city
  ) {
    return 'high';
  }

  if (
    (
      matched >= 1 &&
      city
    ) ||
    matched >= 2
  ) {
    return 'medium';
  }

  return 'low';
}

function extractEvidence(
  text,
  regex
) {
  const match =
    String(
      text ||
      ''
    ).match(
      regex
    );

  if (!match) {
    return '';
  }

  const value =
    String(
      match[0] ||
      match[1] ||
      ''
    )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  return value.length >
    180
    ? value.slice(
        0,
        177
      ) +
      '...'
    : value;
}

function contains(
  page,
  text
) {
  return normalize(
    page.text
  ).includes(
    normalize(
      text
    )
  );
}

function normalize(
  value
) {
  return String(
    value ||
    ''
  )
    .toLowerCase()
    .normalize(
      'NFD'
    )
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
  const match =
    String(
      text ||
      ''
    ).match(
      regex
    );

  return match
    ? match[0]
    : '';
}

function hostname(
  url
) {
  try {
    return new URL(
      url
    )
      .hostname
      .replace(
        /^www\./,
        ''
      );

  } catch {
    return '';
  }
}

function capitalize(
  text
) {
  const value =
    String(
      text ||
      ''
    );

  return value
    ? value.charAt(0).toUpperCase() +
      value.slice(1)
    : '';
}

function safeDecode(
  value
) {
  try {
    return decodeURIComponent(
      String(
        value ||
        ''
      )
    );

  } catch {
    return String(
      value ||
      ''
    );
  }
}

function cleanError(
  error
) {
  return String(
    error?.message ||
    error ||
    'Erreur inconnue'
  )
    .replace(
      /\s+/g,
      ' '
    )
    .slice(
      0,
      180
    );
}
