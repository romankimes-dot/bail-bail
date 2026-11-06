# Baux commerciaux – quittancement (application hors ligne)

Application HTML autonome, sans serveur ni connexion réseau, pour :

- importer les baux commerciaux au format PDF (texte ou scan, OCR intégré) ;
- extraire automatiquement les informations clés, les vérifier et les corriger bail par bail, PDF en regard ;
- gérer les tables d'indices (ILC, ILAT, ICC) ;
- calculer le quittancement (loyer indexé, prorata, charges, dépôt, TVA) par période ;
- rapprocher le calcul des données Yardi et exporter la liste des corrections ;
- exporter la base complète en Excel.

## Installation

1. Copier le fichier `dist/Bail-Bail.html` dans un dossier du réseau interne (ex. `\\serveur\baux\`).
2. L'ouvrir avec **Chrome ou Edge** (l'API d'écriture de fichiers locaux n'existe pas dans Firefox).
3. Au premier lancement, choisir ce même dossier puis définir un mot de passe maître.

Un sous-dossier `donnees/` est créé à côté de `Bail-Bail.html`. Il contient tout : baux, PDF, indices, export Yardi, réglages.
Chaque fichier est chiffré (AES-256-GCM, clé dérivée du mot de passe par PBKDF2). Rien n'est stocké dans le navigateur.

## Sécurité

- Aucune ressource externe, aucune connexion sortante (Content Security Policy `connect-src 'none'`, `wasm-unsafe-eval` uniquement pour le moteur OCR).
- Données chiffrées au repos dans le dossier de l'application ; mot de passe perdu = données irrécupérables.
- Verrouillage automatique après inactivité (réglable, 15 min par défaut) et <kbd>Ctrl</kbd>+<kbd>L</kbd>.
- Sauvegarde chiffrée (`.bbx`) depuis Paramètres ; l'export en clair (JSON, Excel) est une action explicite.
- Le dépôt Git ne contient que le code et les librairies : ne jamais y placer de bail, d'export Yardi ni le dossier `donnees/`.

## Parcours

1. **Tableau de bord** : glisser-déposer les PDF (ou un dossier entier). Extraction en file d'attente, OCR automatique si nécessaire.
2. **Baux** : liste filtrable (actif, locataire, statut, recherche), PDF au centre, formulaire à droite.
   Statuts : « À vérifier » ou « Validé » ; les anomalies détectées sont un indicateur séparé. Champ « Tacite reconduction » : un bail en reconduction annuelle ou à durée indéterminée est quittancé au-delà de sa date de fin.
   Chaque champ est coloré : vert confiant, orange douteux, rouge non trouvé, bleu saisi. L'œil affiche le passage source dans le PDF.
   Raccourcis : <kbd>Ctrl</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd> bail suivant/précédent, <kbd>Ctrl</kbd>+<kbd>Entrée</kbd> valider, <kbd>Ctrl</kbd>+<kbd>S</kbd> enregistrer.
   **Avenants** : le bouton « + Avenant » crée une fiche liée au bail avec sa propre date d'effet ; seuls les champs renseignés dans l'avenant remplacent ceux du bail, et le quittancement du bail applique chaque avenant à partir de sa date d'effet (découpe de la période). Les avenants apparaissent sous leur bail dans la liste.
   Chaque correction apprend une « ancre » (contexte précédant la valeur) réutilisée pour les baux de même trame
   (« Ré-extraire » dans la fiche ou pour tous les non validés dans Paramètres).
3. **Termes** : baux arrivant à terme dans l'horizon choisi (fin effective après tacite reconduction, facultés triennales, baux échus), filtre par asset manager, export Excel, actions en masse (reconduire d'un an, marquer en reconduction annuelle, fixer une date de fin) et préparation d'un mail récapitulatif par asset manager ouvert dans votre messagerie.
4. **Indices** : tables pré-remplies de mémoire, **à vérifier sur insee.fr** (case orange = non vérifié). Saisie directe ou import CSV `type;periode;valeur`.
5. **Quittancement** : période, bouton « CSV de contrôle » (détail jours, indices, coefficients, limité au locataire filtré), calcul par bail avec découpe aux dates anniversaires d'indexation, prorata (jours réels ou 30/360 par bail), franchise, paliers, export Excel.
6. **Yardi** : import de l'export (xlsx/csv ou collage), association des codes locataire `t…` (automatique par nom, puis vérification dans la fiche), rapprochement global par code charge ou détail par mois, export des corrections.
7. **Paramètres** : sauvegarde/restauration, export Excel complet, mot de passe, délai de verrouillage, codes de charge Yardi.

## Développement

```bash
node build.js        # assemble dist/Bail-Bail.html à partir de src/ et vendor/
node test/unit.js    # tests unitaires du moteur de calcul (indexation, périodes, prorata, dépôt, avenants, parsing)
node test/e2e.js     # test de bout en bout dans Chromium (Playwright), captures dans test/shots/
```

- `src/js/` : `crypto.js` (chiffrement), `db.js` (stockage fichiers + session), `pdf.js`, `ocr.js`, `extract.js` (règles + apprentissage),
  `calc.js` (indexation, périodes, quittances), `yardi.js`, `excel.js`, `ui.js`, `app.js`.
- `vendor/` : pdf.js 3.11, Tesseract.js 6 (+ moteur WASM et données `fra`), SheetJS 0.18. Tout est inliné dans `dist/Bail-Bail.html` (≈ 11 Mo).
- `test/fixtures/bail_test_A.pdf` : bail synthétique (données fictives) utilisé par le test.

Limites connues : l'extraction est basée sur des règles calibrées sur une trame de bail ; les baux atypiques demandent plus de corrections manuelles.
Les valeurs d'indices livrées sont indicatives et doivent être contrôlées avant tout calcul.
