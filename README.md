# OTA Audit France — automatisation

Paquet Hostinger/PHP + Playwright/Chromium sur GitHub Actions automatisant
demandes gratuites, paiements Stripe, audits publics déterministes, emails,
PDF, journalisation et reprises — sans LLM ni API/service payant supplémentaire.

Copier `deploy/public_html` dans `public_html`. Copier
`deploy/private/config.env.example` hors de `public_html`, le renommer
`config.env`, puis le remplir. Voir `DEPLOIEMENT.md`.

Tests PHP sans réseau : `php tests/run.php`. Test du runner : `cd runner && npm test`.
