import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chiffrer, dechiffrer, chiffrerBlob, dechiffrerBlob, chiffrerTexte, dechiffrerTexte, empreinteCle } from '../server/chiffrement.js';
import { ecrireBlob, lireBlob, supprimerBlob } from '../server/blobs.js';

test('chiffrement : aller-retour, IV différents, clé dérivée stable, altération détectée', async () => {
  const donnees = new TextEncoder().encode('Permis B n° 123456789');
  const a = await chiffrer(donnees); const b = await chiffrer(donnees);
  assert.notEqual(a.iv, b.iv);
  assert.deepEqual(await dechiffrer(a), donnees);
  assert.equal(await empreinteCle(), await empreinteCle());
  const blob = await chiffrerBlob(donnees);
  assert.ok(!Buffer.from(blob).includes(Buffer.from('123456789')));
  assert.deepEqual(await dechiffrerBlob(blob), donnees);
  blob[blob.length - 1] ^= 1;
  await assert.rejects(() => dechiffrerBlob(blob), /Déchiffrement impossible/);
  assert.equal(await dechiffrerTexte(await chiffrerTexte('FR76 3000')), 'FR76 3000');
});

test('blobs (fichiers) : écriture, lecture avec type, suppression, identifiant validé', async () => {
  await ecrireBlob('test-blob-1', new Uint8Array([1, 2, 3]), 'image/png');
  assert.deepEqual(await lireBlob('test-blob-1'), { bytes: new Uint8Array([1, 2, 3]), type: 'image/png' });
  await supprimerBlob('test-blob-1');
  assert.equal(await lireBlob('test-blob-1'), null);
  assert.throws(() => lireBlob('../etc/passwd'), /invalide/);
});
