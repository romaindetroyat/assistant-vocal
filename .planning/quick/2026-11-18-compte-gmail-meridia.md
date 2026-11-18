# Tâche rapide — Ajouter le compte Gmail Workspace meridia.tl (issue #3)

## Demande
Lire et utiliser la boîte Google Workspace de Meridia en plus des comptes existants ; bouton « Ajouter un compte Gmail »
dans le menu de l'app ; alias « meridia » ; message clair si le domaine bloque l'application ; pas de doublon ; retrait
depuis le même menu ; comportement des comptes existants inchangé. (L'action GitHub ne l'avait pas terminée.)

## Fait
- `google.js` : `demarrerConnexionGoogle(…, { retour })` (retour vers /app ou /outils) ; reconnexion d'un compte déjà
  connecté : jeton rafraîchi à la même place (ni doublon ni changement d'ordre, date d'ajout conservée) ;
  `messageErreurGoogle` : `admin_policy_enforced` / `org_internal` → marche à suivre dans la console d'administration
  Workspace (ID client affiché), `access_denied` → écran de consentement en mode Test ou application non autorisée.
- `app.js` : `/api/google/connect` accepte `{ retour: 'app' }` ; le rappel OAuth renvoie vers la page d'origine avec
  `?google=` ou `?google_erreur=` (plus de page d'erreur brute).
- Front : section « Comptes Gmail » dans le menu Historique (liste, Retirer, « + Ajouter un compte Gmail ») ; messages
  de retour dans l'app et dans Mes outils (bouton renommé « Ajouter un compte Gmail »). Cache SW v47.
- Alias : « meridia » se résout déjà par la recherche dans l'adresse (testé).
- Tests : `test/google-comptes.test.js` (ajout, alias, reconnexion sans doublon, retrait, retour app, refus du domaine).

## À faire par Romain
1. Menu Historique → « + Ajouter un compte Gmail » → choisir le compte meridia.tl → accepter.
2. Si Google répond que le domaine bloque l'application : admin.google.com → Sécurité → Accès et contrôle des données →
   Commandes des API → Gérer l'accès des applications tierces → ajouter l'application par son ID client → « Fiable ».
3. Si l'écran de consentement du projet Google Cloud est en mode « Test » : ajouter l'adresse meridia.tl dans
   « Utilisateurs test » (console.cloud.google.com → API et services → Écran de consentement OAuth).

## Aussi dans cette livraison
- PR #5 (retrait de romain@takeoff.do) relue et fusionnée.
- Test météo corrigé : il appelait le vrai réseau dès que le cache était périmé (échec de la CI de la PR #5).
