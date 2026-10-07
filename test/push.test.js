import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envoyerNotification, pushDisponible } from '../server/push.js';
import { ajouterAbonnement, listerAbonnements } from '../server/store.js';

test('push : charge chiffrée aes128gcm + en-tête VAPID, abonnement expiré retiré', async () => {
  // Paire de clés VAPID et clés d'abonnement générées à la volée
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  process.env.VAPID_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey('raw', vapid.publicKey)).toString('base64url');
  process.env.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d;
  assert.equal(pushDisponible(), true);
  const client = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const keys = { p256dh: Buffer.from(await crypto.subtle.exportKey('raw', client.publicKey)).toString('base64url'), auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url') };
  await ajouterAbonnement({ endpoint: 'https://push.example/ok', keys });
  await ajouterAbonnement({ endpoint: 'https://push.example/expire', keys });

  const appels = [];
  const fetchSimule = async (url, init) => { appels.push({ url, init }); return new Response(null, { status: url.endsWith('expire') ? 410 : 201 }); };
  const n = await envoyerNotification({ titre: 'Salut', corps: 'Test' }, fetchSimule);
  assert.equal(n, 1);
  assert.equal(appels.length, 2);
  assert.equal(appels[0].init.method.toUpperCase(), 'POST');
  assert.match(appels[0].init.headers.authorization || appels[0].init.headers.Authorization, /^vapid t=.+, k=/);
  assert.equal((appels[0].init.headers['content-encoding'] || appels[0].init.headers['Content-Encoding']), 'aes128gcm');
  assert.deepEqual((await listerAbonnements()).map((a) => a.endpoint), ['https://push.example/ok']);
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
});
