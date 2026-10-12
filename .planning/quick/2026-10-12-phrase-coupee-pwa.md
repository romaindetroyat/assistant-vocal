# Tâche rapide — Phrase coupée, sons parasites, vérification de la PWA

## Demande
« Le plugin : le micro s'ouvre, se ferme, je n'ai pas le temps de finir ma phrase. Vérifie la version PWA, et isole les sons
captés en dehors de ma voix, de ma requête. »

## Diagnostic
- Journal : la conversation vocale (Ctrl+Maj+Espace) répondait dès la première pause ; avec « micro coupé pendant la
  recherche », la fin de phrase était perdue. La dictée Chrome, en mode « phrase » relancé, fermait et rouvrait le micro.
- PWA (contrôle Chrome en production) : installable, manifeste sans erreur, service worker actif, ouverture hors ligne ;
  icônes encore à l'ancien style bleu, icône « maskable » non pleine page, écran de mot de passe affiché hors connexion,
  heure de la barre d'état iPhone illisible sur fond clair.

## Fait
- `conversation.js` : la réponse attend 1,2 s de silence (2,2 s si la phrase semble inachevée) ; si l'utilisateur reprend
  la parole, on attend la suite et la demande part entière (une seule réponse). Contrainte micro `voiceIsolation`.
- `voice.js` : réduction de bruit « champ proche » hors voiture (ordinateur, extension), « champ lointain » en voiture ;
  consigne : ignorer voix et sons d'arrière-plan, attendre la suite d'une demande coupée.
- `app.js` : dictée continue sur Chrome / Edge (plus de coupure entre les phrases), mode phrase gardé sur Safari ; message
  « Pas de connexion Internet » au lieu de l'écran de mot de passe ; `voiceIsolation` sur le micro partagé.
- PWA : icônes Ardoise (SVG, 192, 512), icône maskable pleine page, `apple-touch-icon` 180 px, bandeau ardoise derrière la
  barre d'état iPhone, icônes dans le cache. Cache SW v42.
- Tests : fin de phrase et reprise de parole, champ proche / lointain. 115 verts.
