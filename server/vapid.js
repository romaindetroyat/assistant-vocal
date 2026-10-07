// Génère une paire de clés VAPID (format base64url, compatible navigateurs et serveurs push).
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const paire = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publique = b64url(await crypto.subtle.exportKey('raw', paire.publicKey));
const privee = (await crypto.subtle.exportKey('jwk', paire.privateKey)).d;
console.log(`VAPID_PUBLIC_KEY=${publique}\nVAPID_PRIVATE_KEY=${privee}`);
