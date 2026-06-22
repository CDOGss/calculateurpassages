# Calculateur de temps de passage — Trail & Ultra

Application **100% navigateur** (aucun serveur, hébergement gratuit à vie sur GitHub Pages)
qui calcule les **temps de passage par checkpoint** d'un parcours trail/ultra à partir
d'un objectif de temps et d'une trace GPX.

> Le coureur entre son objectif, charge son GPX, et obtient ses temps de passage estimés
> par point, avec ajustement selon la **pente**, le **D+/D-** et la **fatigue accumulée**.

## Ce qui rend le calcul précis

- **Analyse par segments d'environ 100 m** — la trace est découpée finement pour capter
  chaque changement de pente.
- **Montée : modèle énergétique de Minetti et al. (2002)** — en côte on est limité par
  l'énergie ; Minetti est validé en labo (+20% ≈ 2,5× le plat, +40% ≈ 4,7× → on marche).
- **Descente : modèle terrain empirique** — ⚠ en descente raide on n'est PAS limité par
  l'énergie (métaboliquement « gratuite ») mais par la **biomécanique** : freinage, pose de
  pied, équilibre. Minetti chiffrerait une descente à −50% à ~1,1× le plat, ce qui est faux :
  une descente technique à −50% se parcourt **3 à 5× plus lentement que le plat** (≈ marche
  prudente). Le curseur de **technicité** (roulant → pierrier alpin) règle cette sévérité.
  Optimum (le plus rapide) vers −8/−10%, retour au niveau du plat vers −20/−25%.
- **Détection automatique du terrain (OpenStreetMap)** — le GPX ne contient pas le type de
  sol. Le bouton « Analyser le terrain (OSM) » interroge l'API Overpass par tronçons de 2 km,
  accroche (snap) chaque point au chemin OSM le plus proche et en lit les tags
  (`surface`, `highway`, `sac_scale`) pour déduire la technicité **section par section**
  (route → roulant → montagne → technique → alpin). Les tronçons non couverts par OSM
  utilisent la technicité globale en repli. Réseau requis ; l'analyse d'un long ultra peut
  prendre quelques minutes (et dépend de la charge des serveurs Overpass).
- **Fatigue au fil des heures** — l'allure se dégrade avec le temps passé en course
  (positive split), selon un profil d'endurance réglable.
- **Calage exact sur l'objectif** — résolution par point fixe : la somme des temps de
  segment égale toujours votre objectif.
- **Lissage altimétrique médian + hystérésis** sur le D+/D- (anti-bruit GPS, façon Garmin/Strava).

## Repris du projet « dev roadbook »

- Le **moteur GPX** (parsing, lissage médian, D+/D- avec bande morte) porté de Python vers JS.
- L'**éditeur interactif** : profil altimétrique D3 + carte Leaflet où l'on **clique pour
  ajouter un point de passage**, table des checkpoints (distance cumulée/inter, altitude, D+).

## Stack

React + Vite + Tailwind · D3 (profil) · Leaflet + OpenStreetMap (carte). Tout le calcul
tourne dans le navigateur — **vos fichiers GPX ne quittent jamais votre appareil**.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # génère dist/
npm run preview  # prévisualise le build
```

## Déploiement gratuit sur GitHub Pages

1. Pousser ce dossier dans un dépôt GitHub.
2. Dans **Settings → Pages**, choisir la source **GitHub Actions**.
3. Chaque push sur `main` déclenche le workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
   qui build et publie automatiquement. Le site est dispo sur
   `https://<utilisateur>.github.io/<dépôt>/`.

La configuration Vite utilise `base: './'` (chemins relatifs) : aucune adaptation nécessaire
selon le nom du dépôt.

## Limites & pistes

- Le calcul s'appuie sur l'altitude du GPX (lissée). Une trace très bruitée peut fausser le D+/D-.
- La descente dépend beaucoup de la *technicité* (curseur) : un très bon descendeur sur
  terrain qu'il connaît ira plus vite ; un terrain piégeux/humide/de nuit, plus lentement.
- Pistes : recalage altimétrique via API d'élévation, profils ITRA, météo/chaleur, export PDF.
