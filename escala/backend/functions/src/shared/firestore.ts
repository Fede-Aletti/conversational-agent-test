import type { Firestore } from 'firebase-admin/firestore';

export function configureFirestore(db: Firestore): Firestore {
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings already applied for this instance
  }
  return db;
}
