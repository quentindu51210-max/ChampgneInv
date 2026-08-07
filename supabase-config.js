'use strict';

/* =========================================================
   CONFIGURATION SUPABASE
   ---------------------------------------------------------
   1. Allez sur https://supabase.com -> crée un compte
      -> créez un nouveau projet (gratuit, sans carte).
   2. Dans supabase.com -> Settings -> API :
      copiez l'URL du projet et la clé « anon public ».
   3. Collez-les ci-dessous entre les guillemets.
   4. Dans supabase.com -> SQL Editor : collez le contenu
      du fichier schema.sql et exécutez-le (une seule fois).
   5. Ouvrez index.html de nouveau : connexion / inscription
      fonctionnent, et les données sont partagées.
   ========================================================= */

const SUPABASE_URL = 'https://xgmfnzptxcqqcwtmzfkv.supabase.co';   // à remplir
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnbWZuenB0eGNxcWN3dG16Zmt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMzI3NzYsImV4cCI6MjEwMTcwODc3Nn0.l76HWE17ITb9CaCEYfR8kjdSUd3lVHvR4FlbkI9HDEc';          // à remplir

/* =========================================================
   CONFIGURATION HCAPTCHA  (anti-robot pour l'inscription)
   ---------------------------------------------------------
   1. Allez sur https://dashboard.hcaptcha.com -> Inscrivez-vous.
   2. « Add new site » : nom = « Champagne Stock »,
      hosts/domains autorisés = votre site GitHub Pages
      (ex : votrenom.github.io — plus bas, les sous-domaines
      sont aussi couverts avec *.github.io si besoin).
   3. Récupérez la « Site Key » (clé publique, à coller ci-dessous).
   4. La « Secret Key » ne se met JAMAIS dans ce fichier :
      elle se colle dans Supabase -> Authentication -> Security
      -> CAPTCHA (voir étape 2 de l'intégration).
   Si ce champ reste vide, l'ancien petit calcul anti-robot
   sera réactivé automatiquement (mode secours).
   ========================================================= */

const HCAPTCHA_SITE_KEY = 'd546a9ee-97b8-4a2c-beb0-cf58e7e6162a';   // à remplir (clé publique hCaptcha)