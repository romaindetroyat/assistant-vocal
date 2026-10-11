// Façade de stockage binaire (fichiers du coffre de documents) : R2 sur Cloudflare si le binding DOCS existe, sinon KV
// (valeurs binaires jusqu'à 25 Mo), et fichiers sur Node. Même principe d'injection que store.js (utiliserBlobs).
let backend = null;

export function utiliserBlobs(b) { backend = b; }
function b() {
  if (!backend) throw new Error('Aucun backend de blobs configuré (utiliserBlobs)');
  return backend;
}

export const ID_BLOB = /^[a-z0-9-]{8,64}$/;
function verifierId(id) {
  if (!ID_BLOB.test(String(id || ''))) throw new Error('Identifiant de blob invalide');
  return id;
}

export const ecrireBlob = (id, octets, type) => b().ecrireBlob(verifierId(id), octets instanceof Uint8Array ? octets : new Uint8Array(octets), String(type || 'application/octet-stream'));
export const lireBlob = (id) => b().lireBlob(verifierId(id));
export const supprimerBlob = (id) => b().supprimerBlob(verifierId(id));

// R2 : objet par identifiant, type d'origine dans httpMetadata.
export function creerBlobsR2(bucket) {
  return {
    async ecrireBlob(id, octets, type) { await bucket.put(id, octets, { httpMetadata: { contentType: type } }); },
    async lireBlob(id) {
      const objet = await bucket.get(id);
      if (!objet) return null;
      return { bytes: new Uint8Array(await objet.arrayBuffer()), type: objet.httpMetadata?.contentType || 'application/octet-stream' };
    },
    async supprimerBlob(id) { await bucket.delete(id); },
  };
}

// KV : clé blob:<id>, valeur binaire, type dans les métadonnées.
export function creerBlobsKv(kv) {
  const cle = (id) => `blob:${id}`;
  return {
    async ecrireBlob(id, octets, type) { await kv.put(cle(id), octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength), { metadata: { type } }); },
    async lireBlob(id) {
      const { value, metadata } = await kv.getWithMetadata(cle(id), 'arrayBuffer');
      if (!value) return null;
      return { bytes: new Uint8Array(value), type: metadata?.type || 'application/octet-stream' };
    },
    async supprimerBlob(id) { await kv.delete(cle(id)); },
  };
}

// Fichiers (Node) : DATA_DIR/blobs/<id> et <id>.json pour le type.
export function creerBlobsFs(dataDir) {
  let fsPromesse = null;
  const modules = () => (fsPromesse ||= Promise.all([import('node:fs/promises'), import('node:path')]).then(([fs, path]) => ({ fs, path })));
  const chemins = async (id) => {
    const { path } = await modules();
    const dossier = path.join(path.resolve(dataDir), 'blobs');
    return { dossier, fichier: path.join(dossier, id), meta: path.join(dossier, `${id}.json`) };
  };
  return {
    async ecrireBlob(id, octets, type) {
      const { fs } = await modules(); const { dossier, fichier, meta } = await chemins(id);
      await fs.mkdir(dossier, { recursive: true });
      await fs.writeFile(fichier, octets);
      await fs.writeFile(meta, JSON.stringify({ type }));
    },
    async lireBlob(id) {
      const { fs } = await modules(); const { fichier, meta } = await chemins(id);
      try {
        const bytes = new Uint8Array(await fs.readFile(fichier));
        const { type } = JSON.parse(await fs.readFile(meta, 'utf8').catch(() => '{}'));
        return { bytes, type: type || 'application/octet-stream' };
      } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async supprimerBlob(id) {
      const { fs } = await modules(); const { fichier, meta } = await chemins(id);
      await fs.rm(fichier, { force: true }); await fs.rm(meta, { force: true });
    },
  };
}
