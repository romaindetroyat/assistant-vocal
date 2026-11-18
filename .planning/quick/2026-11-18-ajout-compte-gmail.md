# Tâche rapide — Ajouter le compte Gmail romain@meridia.tl (issue #3)

## Demande
Lire et utiliser la boîte Google Workspace romain@meridia.tl en plus des trois comptes existants ; bouton
« Ajouter un compte Gmail » dans le menu de l'application ; alias « meridia » ; message explicite si le domaine
Workspace bloque l'application ; pas de doublon, retrait depuis le même menu ; comptes existants inchangés.

## Constat
Le flux OAuth Google multi-comptes existe (phase 8 : `server/google.js`, page Réglages). Rien à créer côté scopes :
on réutilise `PORTEES` (gmail.modify, userinfo.email, openid). Manquent : l'accès depuis le tiroir de l'app (menu
ouvert par « Historique »), le retour vers l'app après consentement, les alias, des messages d'erreur Workspace, et une
reconnexion qui ne déplace pas le compte en fin de liste (l'ordre sert à `resoudreCompte`).

## Plan
1. `google.js`
   - `aliasCompte(email)` : premier libellé du domaine (meridia.tl → « meridia », altapyx.com → « altapyx »…) ;
     `resoudreCompte` : adresse exacte, puis alias exact, puis les règles existantes (début, contient).
   - `demarrerConnexionGoogle(redirectUri, { retour })` : mémorise la page de retour (`app` ou `outils`, défaut outils).
   - `connecterCompteGoogle` → `{ email, deja, retour }` : un compte déjà connecté est mis à jour **à sa place**
     (jetons rafraîchis, `ajouteLe` conservé, `misAJourLe` ajouté) ; `terminerConnexionGoogle` garde sa signature.
   - `messageErreurGoogle(code, description)` : `admin_policy_enforced`, `org_internal`, `access_denied`,
     `unauthorized_client`, `invalid_grant`… → phrases en français avec la marche à suivre (console d'administration
     Google Workspace → Sécurité → Contrôle des accès aux API → Applications tierces → faire confiance à l'ID client).
     Utilisé pour l'échange de code, le rafraîchissement et le retour de Google.
2. `gmail.js` : un 403 de l'API Gmail mentionne la piste Workspace ; `gmail_comptes` affiche l'alias.
3. `app.js` (serveur) : `/api/google` renvoie l'alias ; `POST /api/google/connect` accepte `{ retour: 'app' }` ;
   le callback renvoie vers `/app?google=…&deja=1` ou `/app?google_erreur=…` quand la connexion vient de l'app
   (comportement inchangé pour la page Réglages).
4. Front : section « Comptes Gmail » dans le tiroir (liste, ✕ pour retirer avec confirmation, bouton « Ajouter un compte
   Gmail », état/erreur) ; à l'ouverture de `/app?google…` le tiroir s'ouvre avec le message. Cache SW v47.
5. `chat.js` : la liste des comptes du prompt indique les alias.
6. Tests : alias, reconnexion sans doublon ni changement d'ordre, messages Workspace, callback vers l'app.

## Résumé (SUMMARY)
- **Bouton « Ajouter un compte Gmail »** dans le tiroir de l'app (bouton « Historique ») : liste des comptes avec leur
  mot-clé, ✕ pour retirer (confirmation, jeton révoqué chez Google), état du dernier ajout ou erreur. Si les
  identifiants OAuth ne sont pas encore saisis, le bouton renvoie vers Réglages. Le consentement Google revient sur
  `/app` et rouvre le tiroir avec « … connecté ✓ » ou « … était déjà connecté : autorisation renouvelée ✓ ».
- **Mêmes scopes** que les comptes existants (`gmail.modify`, `userinfo.email`, `openid`) ; jeton stocké dans
  `google-comptes` à côté des autres.
- **Alias** : `aliasCompte` = premier libellé du domaine (« meridia », « altapyx », « takeoff », « gmail ») ; testé
  juste après l'adresse exacte dans `resoudreCompte`, puis règles existantes inchangées. `gmail_comptes` et le prompt
  affichent le mot-clé.
- **Reconnexion** : compte mis à jour à sa place (pas de doublon, ordre inchangé, `ajouteLe` conservé, `misAJourLe`,
  refresh_token gardé si Google n'en renvoie pas).
- **Workspace** : `messageErreurGoogle` traduit `admin_policy_enforced`, `access_denied`, `org_internal`,
  `invalid_grant`, `invalid_client`, `redirect_uri_mismatch` avec la marche à suivre (admin.google.com → Sécurité →
  Contrôle des API → applications tierces → ID client « Approuvée »/« Fiable » ; utilisateurs test si l'app est en mode
  Test). Un 403 de l'API Gmail mentionne la même piste.
- Page Réglages : comportement inchangé (retour `/outils?google=…`, erreurs en texte).
- Tests : 119 (2 nouveaux dans `test/gmail.test.js`). Cache SW v47.
- Remarque : le test météo « sans lieu → position courante » échoue par intermittence, y compris sans ce changement
  (cache de position) ; non traité ici.
