import { getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { VertexFaqSearch } from './policy-rules/adapters/firestore';
import { configFromEnv } from './shared/config';
import { createFirestoreDeps } from './shared/firestore-deps';
import { handleRequest } from './http/router';
import type { Deps } from './shared/uow';

let cached: Deps | null = null;

function deps(): Deps {
  if (cached) return cached;
  if (!getApps().length) initializeApp();
  const dataStore = process.env.FAQ_DATASTORE_ID;
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  const faq =
    dataStore && project
      ? new VertexFaqSearch(
          `projects/${project}/locations/global/collections/default_collection/dataStores/${dataStore}/servingConfigs/default_search`,
          async () => {
            const credential = getApp().options.credential;
            const token = credential ? await credential.getAccessToken() : null;
            if (!token) throw new Error('no access token');
            return token.access_token;
          },
        )
      : null;
  cached = createFirestoreDeps(getFirestore(), { config: configFromEnv(process.env), faq });
  return cached;
}

/** Single HTTPS function. Auth is IAM (Cloud Run invoker); the function itself is not public. */
export const api = onRequest({ region: 'us-central1', invoker: 'private', timeoutSeconds: 60 }, async (req, res) => {
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) query[k] = typeof v === 'string' ? v : undefined;
  const out = await handleRequest(deps(), { method: req.method, path: req.path, query, body: req.body });
  res.status(out.status).json(out.body);
});
