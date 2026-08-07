'use strict';

/* =========================================================
   CONFIGURATION SUPABASE
   ---------------------------------------------------------
   1. Allez sur https://supabase.com -> créez un compte
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