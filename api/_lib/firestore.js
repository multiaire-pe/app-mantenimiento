// Inicialización de firebase-admin (Firestore) para las funciones del bot.
// La credencial viene de la variable de entorno FIREBASE_SERVICE_ACCOUNT (JSON o base64),
// NUNCA del repo. Singleton perezoso: solo se inicializa al primer uso real.
import admin from 'firebase-admin';

let _db = null;

function credencial() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) throw new Error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT');
  // Acepta el JSON directo o codificado en base64 (para evitar problemas con saltos de línea).
  const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(json);
}

export function getDb() {
  if (_db) return _db;
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(credencial()) });
  }
  _db = admin.firestore();
  return _db;
}
