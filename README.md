# Scanner de tickets - v2 (authentification, MongoDB, administration)

```
ticket_scanner/
├── backend/          FastAPI - auth JWT, MongoDB (motor), OCR de secours
├── frontend/         React + Vite + TS - login, scan, admin
├── docker-compose.yml MongoDB + backend + Caddy (HTTPS interne)
└── caddy/Caddyfile   sert le frontend + proxy vers le backend, HTTPS manuel
```

## Ce qui a changé par rapport à la v1

- **Authentification** obligatoire (JWT) - fini les sessions anonymes.
- **MongoDB** persiste chaque scan immédiatement (plus de perte de données si
  le serveur redémarre brutalement).
- **Interface admin** : parcourir les scans par jour puis par utilisateur,
  fusionner une journée, exporter en CSV.
- **Permissions caméra** : écran dédié avec instructions si refusées.
- **Ajout manuel** d'un code, avec la même règle de dédoublonnage que le scan
  automatique.
- **HTTPS en interne** (pas de domaine) via Caddy + certificat mkcert.

## Installation - développement local

### 1. MongoDB (le plus simple : juste ce conteneur, en dev)

```bash
docker run -d --name mongo -p 27017:27017 -v mongo_dev_data:/data/db mongo:7
```

### 2. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip uninstall bcrypt
pip install bcrypt==4.0.1
pip install openpyxl
```


Dépendance système pour l'OCR (tesseract) :
```bash
sudo apt-get install -y tesseract-ocr libgl1 libglib2.0-0   # Ubuntu/Debian
brew install tesseract                                       # macOS
```

Variables d'environnement (créez `backend/.env` ou exportez-les) :
```bash
export MONGODB_URI="mongodb://localhost:27017"
export JWT_SECRET="une-longue-phrase-secrete-a-changer"
```

Lancer :
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Créer les premiers comptes (obligatoire avant toute connexion)

Il n'existe volontairement aucun endpoint public pour créer le premier
admin (ce serait une faille de sécurité en production). Utilisez le script
CLI, depuis `backend/` avec le venv actif :

```bash
python -m scripts.create_user --username admin --password "changeme123" \
    --nom Admin --prenom Principal --role admin

python -m scripts.create_user --username nora --password "elkadn" \
    --nom Alaoui --prenom Nora --role scanner

python -m scripts.create_user --username kaoutar --password "elkadn" \
    --nom Benali --prenom Kaoutar --role scanner --ip-poste 192.168.1.42
```

Ensuite, gérez les comptes (création, désactivation) directement depuis
l'interface admin (`/admin` → onglet "Utilisateurs") une fois connecté.

### 4. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm install -D @vitejs/plugin-basic-ssl@1
npm run dev
```

## ⚠️ HTTPS obligatoire pour la caméra

Comme en v1, `getUserMedia` exige un contexte sécurisé. En dev sur
`localhost`, pas de souci. Pour tester depuis un vrai téléphone sur le
réseau de l'entreprise, il faut HTTPS - voir la section suivante.

## Mise en production (serveur interne à l'entreprise, sans domaine)

Puisqu'il n'y a pas de nom de domaine, pas de certificat automatique
(Let's Encrypt) possible. On utilise **mkcert** pour générer un certificat
de confiance localement, porté par **Caddy**, qui sert à la fois le
frontend et fait office de proxy vers le backend - une seule origine HTTPS,
pas de souci CORS.

### Étape 1 - Générer le certificat

Sur le serveur (ou une machine qui peut copier les fichiers dessus) :
```bash
mkcert -install
mkcert -cert-file caddy/certs/server.pem -key-file caddy/certs/server-key.pem \
    localhost 127.0.0.1 <IP_LAN_DU_SERVEUR>
```
Remplacez `<IP_LAN_DU_SERVEUR>` par l'IP réelle (ex: `192.168.1.10`).

**Important** : `mkcert -install` crée une autorité de certification locale
qui n'est fiable que sur la machine où elle a été installée. Pour que les
téléphones des employés fassent confiance au certificat sans avertissement,
il faut exporter le certificat racine (`mkcert -CAROOT` indique où il se
trouve) et l'installer manuellement une fois sur chaque téléphone (profil de
confiance iOS, ou "Installer un certificat" sur Android). C'est un peu
fastidieux pour ~10 appareils, mais à faire une seule fois par appareil.

### Étape 2 - Construire le frontend

```bash
cd frontend
echo "VITE_API_BASE_URL=" > .env.production   # vide = chemins relatifs, via Caddy
npm run build
```

### Étape 3 - Lancer toute la stack

À la racine du projet, créez un fichier `.env` :
```bash
JWT_SECRET=une-longue-phrase-secrete-unique-a-changer
```

Puis :
```bash
docker compose up -d --build
```

Cela démarre MongoDB (avec volume persistant), le backend, et Caddy en
HTTPS sur le port 443 (et redirection automatique depuis le port 80).

### Étape 4 - Créer les comptes en production

```bash
docker compose exec backend python -m scripts.create_user \
    --username admin --password "changeme123" --nom Admin --prenom Principal --role admin
```

### Étape 5 - Accéder à l'application

Depuis un téléphone sur le réseau de l'entreprise :
```
https://<IP_LAN_DU_SERVEUR>
```

## Utilisation

1. Chaque utilisateur ouvre l'URL HTTPS, se connecte avec son compte.
2. Autorise la caméra (ou suit les instructions à l'écran si refusée par erreur).
3. Scanne ses tickets - chaque code déjà vu (dans sa propre liste) n'est
   jamais réenregistré, mais deux utilisateurs différents peuvent scanner le
   même code sans problème (cas de conflit légitime).
4. Peut ajouter un code manuellement depuis la liste si un ticket n'a pas
   été détecté automatiquement.
5. L'administrateur consulte `/admin` : parcourt "Scans" → une journée → un
   utilisateur, ou "Fusionner la journée" pour une vue consolidée (les codes
   scannés par plusieurs utilisateurs différents sont signalés avec ⚠️, mais
   jamais supprimés automatiquement). Export CSV disponible à chaque niveau.

## Sécurité / points d'attention à connaître

- Les mots de passe sont hashés (bcrypt) - jamais stockés en clair.
- Le token JWT est stocké dans `localStorage` côté navigateur (simple, mais
  vulnérable en cas de faille XSS - acceptable ici vu le réseau interne
  fermé ; à revoir si l'app devient un jour accessible depuis l'extérieur).
- Le `JWT_SECRET` par défaut dans le code ne doit **jamais** être utilisé
  tel quel en production - toujours le surcharger via la variable
  d'environnement.
- Le champ `ip_poste` est purement informatif, non vérifié à la connexion
  (comme convenu) - facile à activer plus tard si besoin.
- Le regroupement "par jour" utilise l'heure locale du **serveur**. Si des
  employés dans un fuseau horaire différent scannent au même moment, un
  scan pourrait apparaître sous le jour du serveur plutôt que le leur - sans
  incidence pour un déploiement mono-site comme celui-ci.

## Réglages utiles (inchangés depuis la v1, toujours dans le code frontend)

Voir `frontend/src/hooks/useBarcodeScanner.ts` (cadence de détection, délais
avant "rapprochez-vous"/OCR de secours) et `backend/app/config.py`
(tolérance de rotation OCR).
