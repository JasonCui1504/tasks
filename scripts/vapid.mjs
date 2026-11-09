// Prints a fresh VAPID key pair for push notifications. Run once: npm run vapid
// Put both in Vercel's environment variables. Changing them later means
// turning notifications off and on again on each device.
import { generateVAPIDKeys } from "web-push";

const { publicKey, privateKey } = generateVAPIDKeys();
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
