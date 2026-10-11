# Tâche rapide — Micro coupé pendant la recherche, toucher = couper le micro

## Demande
« Quand je touche le bouton à nouveau, je veux que ça coupe le micro. Pour le moment, je serais content que le micro se
coupe après ma question, quand la recherche est lancée. »

## Fait
- `public/conversation.js` : la piste micro est désactivée dès qu'une demande part chez Claude (`demander_assistant`),
  état « Je réfléchis… micro coupé » ; rouverte à la fin de la lecture de la réponse (`output_audio_buffer.stopped`
  ou `cleared`), sur réponse annulée, quand on coupe la parole, au plus tard 45 s après la livraison du résultat, et
  toujours au raccrochage (micro partagé rendu actif à l'app).
- `public/app.js` : mode voiture, toucher le gros bouton pendant l'appel coupe la parole si l'assistant parle, sinon
  raccroche et éteint réellement le micro ; même extinction au toucher du micro sur ordinateur. Cache SW v36.
- Test `test/conversation.test.js` (navigateur simulé).
