// Authentification mono-utilisateur : mot de passe → cookie HMAC signé.
import crypto from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { config } from './config.js';

const NOM_COOKIE = 'assistant_session';
const DUREE_JOURS = 90;

function signer(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

export function creerJeton(maintenant = Date.now()) {
  const expiration = maintenant + DUREE_JOURS * 24 * 3600 * 1000;
  const payload = String(expiration);
  return `${payload}.${signer(payload)}`;
}

export function jetonValide(jeton, maintenant = Date.now()) {
  if (typeof jeton !== 'string') return false;
  const [payload, signature] = jeton.split('.');
  if (!payload || !signature) return false;
  const attendu = signer(payload);
  if (attendu.length !== signature.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(attendu), Buffer.from(signature))) return false;
  return Number(payload) > maintenant;
}

export function motDePasseValide(candidat) {
  if (typeof candidat !== 'string' || !config.password) return false;
  const a = Buffer.from(candidat);
  const b = Buffer.from(config.password);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function estConnecte(c) {
  return jetonValide(getCookie(c, NOM_COOKIE));
}

export function poserCookie(c) {
  const https = c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
  setCookie(c, NOM_COOKIE, creerJeton(), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: https,
    path: '/',
    maxAge: DUREE_JOURS * 24 * 3600,
  });
}

export function retirerCookie(c) {
  deleteCookie(c, NOM_COOKIE, { path: '/' });
}

// Middleware : toute route /api/* sauf /api/login exige une session valide.
export async function exigerSession(c, next) {
  if (!estConnecte(c)) return c.json({ erreur: 'Non authentifié' }, 401);
  await next();
}
