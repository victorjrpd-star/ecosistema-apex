// Configuración global del cliente Supabase
const SUPABASE_URL = 'https://hluzsmsledaanzvhzoqk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_cfF9a9UZIsU--SdLJFGPjA_RObvNj9P';

// Inicialización de la librería Supabase
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);