import type { Firestore, Query, Transaction } from 'firebase-admin/firestore';

/** Reads/writes through a Firestore transaction when one is supplied, otherwise directly. */
export class FsCtx {
  constructor(
    readonly db: Firestore,
    readonly tx?: Transaction,
  ) {}

  async get<T>(collection: string, id: string): Promise<T | null> {
    const ref = this.db.collection(collection).doc(id);
    const snap = this.tx ? await this.tx.get(ref) : await ref.get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async set(collection: string, id: string, data: object): Promise<void> {
    const ref = this.db.collection(collection).doc(id);
    if (this.tx) this.tx.set(ref, data);
    else await ref.set(data);
  }

  async query<T>(q: Query): Promise<T[]> {
    const snap = this.tx ? await this.tx.get(q) : await q.get();
    return snap.docs.map((d) => d.data() as T);
  }
}
