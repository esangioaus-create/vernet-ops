# Vernet Ops v2.0

Plateforme de communication opérationnelle — B Signature Hôtels & Resorts

## Installation

### Prérequis
- Node.js 18+ (https://nodejs.org)

### 1. Installer les dépendances
```bash
npm install
```

### 2. Démarrer le serveur
```bash
npm start
```

### 3. Ouvrir l'application
Navigateur : **http://localhost:3000**

---

## Comptes de démo

| Utilisateur | Mot de passe | Rôle |
|---|---|---|
| etienne | vernet2026 | Admin Hôtel |
| alizee | vernet2026 | Chef de service (HK) |
| julien | vernet2026 | Chef de service (F&B) |
| reception1 | vernet2026 | Équipe (Réception) |
| nuit1 | vernet2026 | Équipe Nuit |
| superadmin | BSignature2026! | Super Admin |

---

## Fonctionnalités

### Modules Sprint 1
- **Dashboard** — Vue synthétique : alertes actives, briefing du jour, déductions en attente, annonces
- **Briefing quotidien** — Saisie et consultation du briefing par date
- **Alertes urgentes** — Création, priorités (faible/moyenne/haute/critique), résolution, push temps réel
- **Annonces** — Panneau d'affichage avec épinglage et expiration
- **Chat** — Messagerie temps réel par canal de service (Général, Réception, HK, F&B, Maintenance, Direction)
- **Déductions** — Workflow complet : soumission → review manager (approuver/refuser) → historique par jour
- **Passations** — Transmission de shift par service (Matin / Après-midi / Nuit)
- **Maintenance** — Bons de travaux avec priorités et statuts

### Architecture v2 Multi-hôtel
- `hotel_id` sur toutes les entités
- Hiérarchie des rôles : **Super Admin → Admin Hôtel → Chef de service → Équipe**
- Isolation complète des données par hôtel
- Socket.io : rooms par hôtel (`hotel_<id>`)

---

## Structure du projet

```
vernet-ops/
├── server.js           # Point d'entrée Express + Socket.io
├── package.json
├── database/
│   ├── db.js           # Schema SQLite + seed
│   └── vernet_ops.db   # Base de données (créée au 1er démarrage)
├── routes/
│   ├── auth.js         # Authentification
│   ├── briefings.js    # Briefings
│   ├── alerts.js       # Alertes
│   ├── announcements.js # Annonces
│   ├── chat.js         # Chat (messages)
│   ├── deductions.js   # Déductions
│   └── operations.js   # Passations + Maintenance
└── public/
    ├── index.html      # SPA complète (frontend)
    ├── manifest.json   # PWA manifest
    └── sw.js           # Service Worker
```

---

## Déploiement réseau interne

Pour accéder depuis les tablettes de l'hôtel :

1. Lancer le serveur sur le PC principal
2. Trouver l'IP locale : `ipconfig` (Windows) ou `ifconfig` (Mac/Linux)
3. Sur les tablettes, aller sur `http://[IP-DU-PC]:3000`
4. Ajouter à l'écran d'accueil pour l'installer en PWA

### Changer le port
```bash
PORT=8080 npm start
```

### Lancement automatique Windows
Double-cliquer sur `start.bat`

---

## Évolutions prévues (v2.1+)
- [ ] Ajout/modification des utilisateurs depuis l'interface Admin
- [ ] Export PDF des déductions du jour
- [ ] Notifications push sur tablette
- [ ] Objets trouvés
- [ ] Tableau de bord Super Admin multi-hôtel
