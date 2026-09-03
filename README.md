# Scanner de tickets - v2 (authentification, Oracle, administration)

```
ticket_scanner/
├── backend/          FastAPI - auth JWT, Oracle, OCR de secours
├── frontend/         React + Vite + TS - login, scan, admin
```

## Ce qui a changé par rapport à la v1

- **Authentification** obligatoire (JWT) - fini les sessions anonymes.
- **Oracle** persiste chaque scan immédiatement (plus de perte de données si
  le serveur redémarre brutalement).
- **Interface admin** : parcourir les scans par jour puis par utilisateur,
  fusionner une journée, exporter en CSV.
- **Permissions caméra** : écran dédié avec instructions si refusées.
- **Ajout manuel** d'un code, avec la même règle de dédoublonnage que le scan
  automatique.
- **HTTPS en interne** (pas de domaine) via Caddy + certificat mkcert.

## Installation - développement local

### 1. Oracle dans Docker

En déploiement Docker, Oracle XE est lancé dans le service `oracle`. Les deux
scripts `backend/sql/oracle_schema.sql` puis
`backend/sql/create_initial_users.sql` sont exécutés automatiquement lors de
la première création du volume `oracle-data`.

### 2. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip uninstall bcrypt
pip install bcrypt==4.0.1
pip install openpyxl
pip install zxing-cpp==2.2.0
```


Dépendance système pour l'OCR (tesseract) :
```bash
sudo apt-get install -y tesseract-ocr libgl1 libglib2.0-0   # Ubuntu/Debian
brew install tesseract                                       # macOS
```

Variables d'environnement (créez `backend/.env` ou exportez-les) :
```bash
export ORACLE_USER="ticket_scanner"
export ORACLE_PASSWORD="ticket_scanner"
export ORACLE_DSN="serveur-oracle:1521/NOM_SERVICE"
export JWT_SECRET="une-longue-phrase-secrete-a-changer"
```

Lancer :
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Déploiement Docker Hub sur le poste Windows 10

La méthode recommandée pour le test en entreprise est Docker Desktop avec
trois services : Oracle XE, le backend FastAPI et le frontend Nginx.

### Première installation sur votre machine de développement

À la racine du projet :

```bash
cp .env.example .env
# Modifiez .env : les mots de passe Oracle et JWT_SECRET
mkdir -p frontend/certs
mkcert -install
mkcert -cert-file frontend/certs/server.pem -key-file frontend/certs/server-key.pem localhost 127.0.0.1
docker compose config
docker compose build
docker compose up -d
```

Le premier démarrage Oracle peut prendre plusieurs minutes. Le premier build
du backend peut aussi être long car il installe OpenCV, EasyOCR et Tesseract.
Testez ensuite l'application sur `https://localhost:8080`.
La caméra du navigateur fonctionne sur `localhost`. Pour les tests depuis un
téléphone avec une autre adresse, utilisez HTTPS (voir la section HTTPS).

### Publier les images sur Docker Hub

Créez un dépôt Docker Hub pour `ticket-scanner-backend` et un autre pour
`ticket-scanner-frontend`, puis connectez-vous :

```bash
docker login
docker compose build
docker compose push
```

Le nom d'utilisateur doit être renseigné dans `.env` via
`DOCKERHUB_USERNAME`. Pour publier une version identifiée, utilisez par
exemple `IMAGE_TAG=1.0.0 docker compose build && IMAGE_TAG=1.0.0 docker compose push`.

### Installer sur le poste Windows 10

1. Installez Docker Desktop pour Windows et activez WSL 2 si Docker le demande.
2. Copiez `docker-compose.yml`, `.env.example`, le dossier `frontend/certs/`
  et les scripts SQL dans le dossier du poste, puis créez `.env` à partir du
  modèle. Les deux fichiers de certificat sont nécessaires au démarrage.
3. Dans `.env`, renseignez `DOCKERHUB_USERNAME`, `IMAGE_TAG`, les mots de
  passe Oracle, `JWT_SECRET` et `APP_PORT=8080`.
4. Ouvrez PowerShell dans le dossier et exécutez :

```powershell
docker login
docker compose pull
docker compose up -d
docker compose ps
```

Ouvrez ensuite `https://localhost:8080`. Pour arrêter l'application :
`docker compose down`. Les données restent dans le volume Docker Oracle.
Ne faites `docker compose down -v` que si vous voulez supprimer les données
et rejouer les deux scripts SQL.

### Publier une modification

Après chaque modification validée :

```bash
docker compose build
docker compose push
```

Sur le poste Windows :

```powershell
docker compose pull
docker compose up -d
```

Pour éviter qu'un poste conserve une ancienne image, utilisez un nouveau tag
à chaque livraison (`IMAGE_TAG=1.0.1`), puis mettez le même tag dans son `.env`.
Ne publiez jamais `.env` sur Git ou Docker Hub.

### 3. Créer les premiers comptes (obligatoire avant toute connexion)

Il n'existe volontairement aucun endpoint public pour créer le premier
admin (ce serait une faille de sécurité en production). Exécutez le script
SQL avec SQL Developer ou SQL*Plus :

```bash
sqlplus inventory_user/mot_de_passe@SERVEUR:1521/NOM_SERVICE \
  @sql/create_initial_users.sql
```

Le script `backend/sql/create_initial_users.sql` crée `admin`, `scanner1`
et `scanner2`. Il n'écrase pas les utilisateurs existants et affiche les
comptes à la fin. Les mots de passe initiaux sont indiqués dans le script
et doivent être changés après la première connexion.

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
de confiance localement, porté directement par **Nginx** dans le conteneur
frontend. Nginx sert le frontend et fait proxy vers le backend - une seule
origine HTTPS, pas de souci CORS.

### Étape 1 - Générer le certificat

Sur le serveur (ou une machine qui peut copier les fichiers dessus) :
```bash
mkcert -install
mkdir -p frontend/certs
mkcert -cert-file frontend/certs/server.pem -key-file frontend/certs/server-key.pem \
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
echo "VITE_API_BASE_URL=" > .env.production   # vide = chemins relatifs, via Nginx
npm run build
```

### Étape 3 - Lancer toute la stack

À la racine du projet, créez un fichier `.env` :
```bash
JWT_SECRET=une-longue-phrase-secrete-unique-a-changer
```

Puis, à la racine du projet :
```bash
export APP_PORT=443
export HTTP_PORT=80
docker compose up -d --build
```

Cela démarre le backend et le frontend Nginx en HTTPS sur le port 443
(avec redirection automatique depuis le port 80). Oracle reste hébergé
séparément sur le serveur de base de données de l'entreprise.

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
