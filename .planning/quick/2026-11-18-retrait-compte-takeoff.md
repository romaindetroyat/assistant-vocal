# Tâche rapide — Retirer le compte Gmail romain@takeoff.do (issue #4)

## Plan
1. `google.js` : liste `COMPTES_RETIRES` (romain@takeoff.do) et `ALIAS_RETIRES` (takeoff, takeoff.do, take off).
   `listerComptes` ne renvoie jamais un compte retiré et déclenche `purgerComptesRetires` s'il en trouve un dans le
   stockage : révocation du jeton chez Google (au mieux), suppression de `google-comptes`, signature effacée de
   `gmail-signatures`. La production étant en KV, la purge se fait d'elle-même à la première lecture après déploiement
   (aucune écriture manuelle sur la production).
2. `resoudreCompte` : un indice retiré (« takeoff », l'adresse…) lève `CompteNonConnecte` ; `executerOutilGmail` le
   convertit en message clair « Compte non connecté … Comptes disponibles : … » au lieu d'une erreur.
3. `terminerConnexionGoogle` refuse de reconnecter un compte retiré. `jetonAcces` / `definirSignature` passent par
   `listerComptes` : compte inconnu.
4. Ne pas toucher aux autres comptes (gmail.com, altapyx.com) ni à l'issue #3 (meridia.tl) : « romain » et « meridia »
   ne sont pas considérés comme retirés.
5. Vérifier l'absence de romain@takeoff.do dans les valeurs par défaut, tâches de fond et routines.
6. Test dans `test/gmail.test.js`.

## Fait
- Plan ci-dessus implémenté ; test « compte romain@takeoff.do retiré » (purge, révocation, autres comptes intacts,
  six outils gmail_* → « Compte non connecté », aucun appel Gmail). 118 tests verts.
- Vérification : aucune occurrence de `takeoff.do` dans le code ; brief, assistant proactif et prompt lisent les comptes
  via `listerComptes`, donc sans le compte retiré. Aucune valeur par défaut à basculer sur rdetroyat@altapyx.com.
  Les mentions « TakeOff » restantes (Agenda Hub, contexte de tâches, exemples de tests) concernent l'entreprise, pas
  le compte Gmail. Les tâches et la mémoire stockées en production n'ont pas été lues (règle : pas d'accès à la
  production depuis la CI) ; elles ne contiennent pas de compte Gmail exploitable par le code.
- Pas de changement de fichier statique (cache SW inchangé, v46).
