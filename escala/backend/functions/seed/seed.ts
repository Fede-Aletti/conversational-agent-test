import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { configureFirestore } from '../src/shared/firestore';
import { normalizeName } from '../src/bookings/domain/normalize';
import type { Dataset } from '../src/shared/types';
import { buildDataset } from './dataset';

/** Projects the seed may write to besides the emulator. */
export const ALLOWED_PROJECTS = ['gen-lang-client-0907599903'];

const SEEDED = ['flights', 'bookings', 'policy_snippets', 'scenarios'];
const RUNTIME = ['quotes', 'rebookings', 'idempotency', 'handoff_cases'];

async function wipe(db: Firestore, collections: string[]): Promise<void> {
  for (const name of collections) await db.recursiveDelete(db.collection(name));
}

/**
 * Loads the scenario catalog into Firestore. Idempotent: fixed document ids, so re-running yields the same seeded state.
 * `reset` also clears runtime collections (quotes, rebookings, idempotency, handoff_cases).
 */
export async function seedFirestore(firestore: Firestore, data: Dataset = buildDataset(), opts: { reset?: boolean } = {}): Promise<Record<string, number>> {
  const db = configureFirestore(firestore);
  if (opts.reset) await wipe(db, [...SEEDED, ...RUNTIME]);
  const writer = db.bulkWriter();
  for (const f of data.flights) void writer.set(db.collection('flights').doc(`${f.flight_number}_${f.date}`), f);
  for (const b of data.bookings) {
    const surname_keys = [...new Set(b.passengers.map((p) => normalizeName(p.last_name)))];
    void writer.set(db.collection('bookings').doc(b.pnr), { ...b, surname_keys });
  }
  for (const s of data.policy_snippets) void writer.set(db.collection('policy_snippets').doc(s.topic), s);
  data.scenarios.forEach((s, order) => void writer.set(db.collection('scenarios').doc(s.scenario_id), { ...s, order }));
  await writer.close();
  return { flights: data.flights.length, bookings: data.bookings.length, policy_snippets: data.policy_snippets.length, scenarios: data.scenarios.length };
}

function parseArgs(argv: string[]): { emulator: boolean; project?: string; reset: boolean } {
  const args = { emulator: false, reset: false } as { emulator: boolean; project?: string; reset: boolean };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--emulator') args.emulator = true;
    else if (argv[i] === '--reset') args.reset = true;
    else if (argv[i] === '--project') args.project = argv[++i];
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.emulator === Boolean(args.project)) throw new Error('Pass exactly one of --emulator or --project <id>.');
  let projectId: string;
  if (args.emulator) {
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
    projectId = process.env.GCLOUD_PROJECT ?? 'demo-escala';
  } else {
    projectId = args.project as string;
    if (!ALLOWED_PROJECTS.includes(projectId)) throw new Error(`Refusing to seed project "${projectId}": not in the allowlist (${ALLOWED_PROJECTS.join(', ')}).`);
    if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is set; unset it to seed a real project.');
  }
  if (!getApps().length) initializeApp({ projectId });
  const counts = await seedFirestore(getFirestore(), buildDataset(), { reset: args.reset });
  console.log(`Seeded ${projectId}${args.reset ? ' (reset)' : ''}:`, counts);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
