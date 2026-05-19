import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ Archivo .env no encontrado.');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split(/\r?\n/).forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value.trim();
  }
});

const url = env['VITE_SUPABASE_URL'];
const key = env['VITE_SUPABASE_ANON_KEY'];

if (!url || !key) {
  console.error('❌ Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el archivo .env.');
  process.exit(1);
}

console.log('🔌 Conectando a Supabase:', url);
const supabase = createClient(url, key);

async function check() {
  try {
    const { data: preguntas, error, count } = await supabase
      .from('preguntas')
      .select('*', { count: 'exact' });
    
    if (error) {
      console.error('❌ Error de consulta en la tabla "preguntas":', error.message);
    } else {
      console.log('✅ ¡CONEXIÓN EXITOSA CON SUPABASE!');
      console.log(`📊 Número de preguntas encontradas en la tabla "preguntas": ${preguntas.length}`);
      if (preguntas.length > 0) {
        console.log('📝 Primeras preguntas de muestra:');
        preguntas.slice(0, 3).forEach((p, idx) => {
          console.log(`  ${idx + 1}. [${p.categoria}] ${p.pregunta}`);
        });
      }
    }
  } catch (err) {
    console.error('❌ Excepción al conectar:', err);
  }
}

check();
