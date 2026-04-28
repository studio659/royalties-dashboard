# Royalties Dashboard

Dashboard de suivi des royalties DistroKid — web app PWA, accessible depuis ton ordi, ton tel, et par toute ton équipe.

---

## 🚀 Setup en 3 étapes (~15 min)

### Étape 1 — Supabase (base de données)

1. Va sur [supabase.com](https://supabase.com) → **Start your project** (gratuit)
2. Crée un projet, choisis un mot de passe fort
3. Une fois créé, va dans **SQL Editor** et colle le contenu de `supabase/schema.sql`, puis clique **Run**
4. Va dans **Settings → API** et copie :
   - **Project URL** (ressemble à `https://xxxxx.supabase.co`)
   - **anon public key** (longue chaîne de caractères)
5. Renomme `.env.local.example` en `.env.local` et remplis les deux valeurs :
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

### Étape 2 — GitHub + Vercel (hébergement)

1. Crée un compte [GitHub](https://github.com) si tu n'en as pas
2. Crée un nouveau repository (public ou privé), upload tous ces fichiers
3. Va sur [vercel.com](https://vercel.com) → **New Project** → importe ton repo GitHub
4. Dans Vercel, va dans **Settings → Environment Variables** et ajoute :
   - `NEXT_PUBLIC_SUPABASE_URL` → ta valeur
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → ta valeur
5. Clique **Deploy** → Vercel te donne une URL (ex: `royalties-dashboard.vercel.app`)

### Étape 3 — Ajouter des utilisateurs

1. Dans Supabase → **Authentication → Users → Invite user**
2. Envoie une invitation par email à chaque membre de ton équipe
3. Ils reçoivent un lien, créent leur mot de passe, et accèdent au dashboard

---

## 📱 Installer sur mobile (PWA)

**iPhone** : Ouvre l'URL dans Safari → bouton Partager → "Sur l'écran d'accueil"  
**Android** : Ouvre l'URL dans Chrome → menu ⋮ → "Ajouter à l'écran d'accueil"

---

## 📂 Importer les données

1. Sur DistroKid → **Reporting → Royalties** → exporte en CSV
2. Dans le dashboard → bouton **"↑ Importer CSV"** → glisse ou clique
3. Les données s'ajoutent automatiquement (les mois présents dans le CSV remplacent l'historique de ces mois)

---

## 🔧 En local (développement)

```bash
npm install
npm run dev
# → http://localhost:3000
```

---

## 📁 Structure du projet

```
royalties-app/
├── lib/
│   ├── supabase.js     # client Supabase
│   ├── artists.js      # config artistes (couleurs, normalisation)
│   └── csvParser.js    # parsing CSV DistroKid
├── pages/
│   ├── _app.jsx        # app shell + PWA meta
│   ├── login.jsx       # page de connexion
│   └── index.jsx       # dashboard principal
├── components/
│   └── ImportModal.jsx # modal d'import CSV
├── styles/
│   └── globals.css     # styles globaux
├── supabase/
│   └── schema.sql      # à coller dans Supabase SQL Editor
└── public/
    └── manifest.json   # config PWA
```

---

## 🎨 Artistes configurés

| Artiste | Normalisation CSV |
|---|---|
| NoSnow | "NoSnow", "No Snow" |
| Magie! | "Magie!", "Magie! & Veridis Project" |
| Veridis Project | "Veridis Project & Joe la panic" |
| Louis Marguier | "Louis Marguier" |

Pour modifier, édite `lib/artists.js`.
