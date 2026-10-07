// Génère une paire de clés VAPID à copier dans .env
import webpush from 'web-push';
const cles = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${cles.publicKey}\nVAPID_PRIVATE_KEY=${cles.privateKey}`);
