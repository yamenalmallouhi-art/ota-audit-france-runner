# Déploiement Hostinger

## 1. Sauvegarder l'existant

Depuis le gestionnaire de fichiers Hostinger, télécharger une archive de
`public_html` avant tout remplacement. Le paquet livré ne contient pas les pages
SEO existantes : elles doivent rester en place.

## 2. Vérifier PHP

Sélectionner PHP 8.1 ou supérieur et vérifier les extensions `pdo_sqlite`,
`curl`, `openssl`, `mbstring` et `json`.

## 3. Installer les fichiers

Copier le contenu de `deploy/public_html/` dans `public_html/`. Cela ajoute
`automation/` et `stripe-webhook.php`, et remplace `submit.php` et `.htaccess`.
Si le `.htaccess` en production contient d'autres règles, fusionner les règles
au lieu de l'écraser.

Le formulaire existant doit conserver `action="/submit.php"`, `method="post"`
et envoyer les champs suivants :

- `hotel` (ou `hotel_name`), `ville`, `site`, `prenom`, `email`, `role` ;
- `consent=1` (ou `rgpd=1`) lorsque la case RGPD est cochée ;
- un champ piège invisible nommé `company` peut être laissé vide.

## 4. Configuration privée — jamais dans le site public

Créer avec le gestionnaire Hostinger le dossier `ota-audit-private` au même
niveau que `public_html`. Copier `deploy/private/config.env.example` vers
`ota-audit-private/config.env`, adapter `USERNAME`, puis remplir les valeurs.

Créer aussi `ota-audit-data` au même niveau. Permissions recommandées : dossier
`700`, fichier de configuration `600`. Aucun secret n'est inclus dans le paquet.

Générer `APP_SECRET` et `CRON_TOKEN` avec le générateur de mots de passe
Hostinger (64 caractères différents). Ils ne doivent pas être envoyés par email.

## 5. Navigateur gratuit GitHub Actions

Aucune clé OpenAI, Anthropic, SERP ou scraping n'est utilisée. Créer un dépôt
GitHub contenant ce paquet, puis activer Actions. Le workflow installe
Playwright/Chromium, récupère un dossier sur Hostinger, visite les pages
publiques, calcule le score et renvoie le résultat à Hostinger.

Dans **Settings > Secrets and variables > Actions**, créer deux secrets :

- `OTA_BASE_URL` = `https://ota.imiloc.com` ;
- `OTA_RUNNER_TOKEN` = la même valeur aléatoire que `RUNNER_TOKEN` dans le
  fichier Hostinger privé.

Le workflow s'exécute toutes les 5 minutes et peut aussi être lancé manuellement.
GitHub Actions est gratuit pour un dépôt public ; un dépôt privé utilise le quota
gratuit inclus au compte. Pour garantir l'absence de facturation, utiliser un
dépôt public avec le runner standard `ubuntu-latest`, ou régler le budget Actions
à 0 € / blocage à la limite avant d'utiliser un dépôt privé.

Le navigateur essaie plusieurs fois chaque page. Toute page bloquée ou trop vide
devient `unknown`/« non vérifiée ». Elle est exclue du dénominateur :
`score = contrôles réussis / contrôles disponibles`. L'audit continue toujours.

## 6. Stripe

Dans Stripe : **Développeurs > Webhooks > Ajouter une destination**.

- URL : `https://ota.imiloc.com/stripe-webhook.php`
- événement : `checkout.session.completed` uniquement ;
- copier le *signing secret* `whsec_...` dans `STRIPE_WEBHOOK_SECRET`.

Le webhook refuse tout paiement qui n'est pas `paid`, exactement `14900`
centimes et `eur`. L'adresse email Stripe rattache la vente à la dernière
demande gratuite du même email.

Pour permettre aussi un achat direct sans demande gratuite, ajouter au Payment
Link trois champs personnalisés obligatoires avec les clés suivantes :
`hotel_name`, `city`, `website`. Si Stripe ne permet pas de définir ces clés
stables dans l'interface, garder le parcours recommandé : OTA Score gratuit,
puis achat depuis l'email reçu avec la même adresse.

La redirection `paiement-confirme.html` reste utile à Analytics, mais elle ne
déclenche jamais l'audit : seul le webhook signé fait foi.

## 7. SMTP

Réutiliser le compte Hostinger déjà fonctionnel : hôte, port, chiffrement,
identifiant et mot de passe dans le fichier privé. Aucun mot de passe ne doit
être copié dans `smtp-config.php` sous `public_html` après migration. Tester
d'abord avec une adresse contrôlée.

## 8. Cron Hostinger

Ajouter une tâche chaque minute (ou toutes les 5 minutes si le forfait l'impose):

```text
/usr/bin/php /home/USERNAME/domains/ota.imiloc.com/public_html/automation/bin/worker.php
```

Le chemin PHP exact est affiché par Hostinger lors de la création de la tâche.
Le worker prend au maximum trois dossiers par exécution. Un travail bloqué plus
de 15 minutes est repris. Les échecs sont retentés 6 fois après 30 s, 1 min,
2 min, 4 min, 8 min puis classés `dead`.

## 9. Contrôle avant activation

1. Lancer `php tests/run.php` sur Hostinger en ligne de commande.
2. Lancer le workflow GitHub manuellement avec une adresse email contrôlée.
3. Lancer le worker PHP manuellement et vérifier réception + journal.
4. Envoyer un événement test Stripe depuis le Dashboard, puis un vrai paiement
   de test en mode test Stripe.
5. Consulter `https://ota.imiloc.com/automation/health.php?token=CRON_TOKEN` :
   aucune tâche ne doit rester `dead`.

## 10. Exploitation et reprise

- Journaux JSON : `ota-audit-data/logs/` ;
- base : `ota-audit-data/ota-audit.sqlite` ;
- PDF : `ota-audit-data/reports/` ;
- sauvegarder le dossier de données chaque jour ;
- une relance du webhook Stripe est sans effet secondaire grâce à l'identifiant
  d'événement unique ;
- un email n'est envoyé qu'après sauvegarde de l'audit ;
- si l'envoi échoue, le prochain essai réutilise l'audit/PDF déjà produits.

Une tâche `dead` doit être examinée dans le journal. Après correction, la remettre
à `queued` avec `available_at=datetime('now')` depuis phpLiteAdmin ou un petit
outil d'administration hors `public_html`.

## Données et sécurité

Le système n'accepte ni mot de passe Booking/Expedia, ni accès PMS, ni données
clients de l'hôtel. Il utilise le nom, la ville, le site et les pages publiques.
Les rapports ne doivent pas promettre un résultat financier. Prévoir une purge
des prospects selon la durée annoncée dans la politique de confidentialité.

## Limite réelle sans service payant

Booking, Expedia, Google ou un moteur de réservation peuvent présenter un CAPTCHA
ou bloquer GitHub. Le système ne s'arrête pas : il retente, conserve les autres
contrôles, marque seulement la source concernée « non vérifiée » et normalise le
score. Aucune incohérence n'est affirmée sans deux valeurs publiques comparables.
