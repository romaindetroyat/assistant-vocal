# Tâche rapide — Supprimer la gestion des signatures, corriger l'orthographe du nom

## Demande
« Enlève la gestion des signatures de mail. Je m'appelle Romain Detroyat (ou Détroyat), pas De Troyat : corrige toutes les
occurrences. » Vérification préalable : le compte Workspace meridia.tl est connecté et répond (recherche en lecture seule).

## Fait
- Signatures retirées : outil `gmail_signature`, ajout automatique aux envois, réponses et brouillons (`corpsSigne`),
  fonctions de `google.js`, routes `/api/google/signatures`, éditeur de signature dans Mes outils, mention dans le prompt
  (remplacée par « N'ajoute pas de bloc de signature »). Aucune signature n'était enregistrée en production.
- Nom : seule occurrence restante dans le code, la fiche de test du coffre (« Romain Détroyat »). Le prénom affiché vient de
  `USER_NAME=Romain`. Les anciens commits signés « Romain de Troyat » restent dans l'historique Git (non réécrit).
- Tests adaptés (envoi sans signature, plus d'outil gmail_signature). 120 verts. Cache SW v48.
