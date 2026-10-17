import { getFlightStatus } from '../operations/application/flight-status';
import { lookupBooking } from '../bookings/application/lookup-booking';
import { createHandoffCase } from '../handoff/application/create-handoff-case';
import { searchFaq } from '../policy-rules/application/faq';
import { createRebooking } from '../rebooking/application/create-rebooking';
import { getRebookingOptions } from '../rebooking/application/get-rebooking-options';
import { listScenarios } from '../scenarios/application/list-scenarios';
import { isIsoDate } from '../shared/time';
import type { Result } from '../shared/result';
import type { Deps } from '../shared/uow';

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  body: unknown;
}
export interface ApiResponse {
  status: number;
  body: unknown;
}

class BadRequest extends Error {}

type Ctx = { deps: Deps; params: Record<string, string>; query: ApiRequest['query']; body: Record<string, unknown> };

export interface Route {
  method: 'GET' | 'POST';
  path: string; // OpenAPI-style template
  operationId: string;
  /** Exposed to CES through the OpenAPI schema. */
  ces: boolean;
  handler: (ctx: Ctx) => Promise<Result<unknown>>;
}

const str = (v: unknown, name: string, required = true): string | undefined => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadRequest(`${name} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new BadRequest(`${name} must be a string`);
  return v;
};
const date = (v: unknown, name: string, required = true): string | undefined => {
  const s = str(v, name, required);
  if (s !== undefined && !isIsoDate(s)) throw new BadRequest(`${name} must be YYYY-MM-DD`);
  return s;
};

export const ROUTES: Route[] = [
  {
    method: 'GET',
    path: '/bookings/lookup',
    operationId: 'lookupBooking',
    ces: true,
    handler: async ({ deps, query }) => {
      const pnr = str(query.pnr, 'pnr', false);
      const last_name = str(query.last_name, 'last_name') as string;
      if (pnr) return lookupBooking(deps, { last_name, pnr });
      return lookupBooking(deps, {
        last_name,
        flight_date: date(query.flight_date, 'flight_date'),
        origin: str(query.origin, 'origin'),
        destination: str(query.destination, 'destination'),
      });
    },
  },
  {
    method: 'GET',
    path: '/flights/{flight_number}/status',
    operationId: 'getFlightStatus',
    ces: true,
    handler: ({ deps, params, query }) => getFlightStatus(deps, params.flight_number, date(query.date, 'date') as string),
  },
  {
    method: 'POST',
    path: '/disruptions/{pnr}/options',
    operationId: 'getRebookingOptions',
    ces: true,
    handler: ({ deps, params, body }) =>
      getRebookingOptions(deps, params.pnr, {
        deadline: str(body.deadline, 'deadline', false),
        target_date: str(body.target_date, 'target_date', false),
        destination: str(body.destination, 'destination', false),
      }),
  },
  {
    method: 'POST',
    path: '/rebookings',
    operationId: 'createRebooking',
    ces: true,
    handler: ({ deps, body }) => {
      const quote_id = str(body.quote_id, 'quote_id') as string;
      const confirmed = body.confirmed === true;
      if (confirmed && !Number.isInteger(body.confirmed_total_ars)) throw new BadRequest('confirmed_total_ars must be an integer');
      return createRebooking(deps, {
        quote_id,
        confirmed,
        confirmed_total_ars: body.confirmed_total_ars as number,
        idempotency_key: str(body.idempotency_key, 'idempotency_key', false) ?? '',
      });
    },
  },
  {
    method: 'POST',
    path: '/handoff-cases',
    operationId: 'createHandoffCase',
    ces: true,
    handler: ({ deps, body }) =>
      createHandoffCase(deps, {
        reason: str(body.reason, 'reason') as string,
        summary: str(body.summary, 'summary') as string,
        pnr: str(body.pnr, 'pnr', false),
        idempotency_key: str(body.idempotency_key, 'idempotency_key', false) ?? '',
      }),
  },
  {
    method: 'GET',
    path: '/policies/faq',
    operationId: 'searchFaq',
    ces: true,
    handler: ({ deps, query }) => searchFaq(deps, str(query.q, 'q') as string),
  },
  {
    method: 'GET',
    path: '/scenarios',
    operationId: 'listScenarios',
    ces: false,
    handler: ({ deps, query }) => {
      const limit = query.limit === undefined ? undefined : Number(query.limit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new BadRequest('limit must be a positive integer');
      return listScenarios(deps, { type: query.type, tag: query.tag, limit });
    },
  },
];

function match(template: string, path: string): Record<string, string> | null {
  const t = template.split('/');
  const p = path.split('/');
  if (t.length !== p.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < t.length; i++) {
    const m = /^\{(.+)\}$/.exec(t[i]);
    if (m) params[m[1]] = decodeURIComponent(p[i]);
    else if (t[i] !== p[i]) return null;
  }
  return params;
}

const envelope = (code: string, extra: Record<string, unknown> = {}) => ({ status: 'error', error_code: code, ...extra });

/** Transport-agnostic request handler: HTTP 200 envelope for domain outcomes, 4xx/5xx only for malformed requests and faults. */
export async function handleRequest(deps: Deps, req: ApiRequest): Promise<ApiResponse> {
  const path = req.path.replace(/^\/api(?=\/)/, '').replace(/\/+$/, '') || '/';
  const candidates = ROUTES.map((r) => ({ r, params: match(r.path, path) })).filter((x) => x.params);
  if (!candidates.length) return { status: 404, body: envelope('NOT_FOUND', { retryable: false }) };
  const hit = candidates.find((c) => c.r.method === req.method.toUpperCase());
  if (!hit) return { status: 405, body: envelope('METHOD_NOT_ALLOWED', { retryable: false }) };
  if (hit.r.operationId === 'listScenarios' && !deps.config.enableScenariosEndpoint) {
    return { status: 404, body: envelope('NOT_FOUND', { retryable: false }) };
  }
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    if (hit.r.method === 'POST' && req.body !== undefined && req.body !== null && body !== req.body) throw new BadRequest('body must be a JSON object');
    const result = await hit.r.handler({ deps, params: hit.params as Record<string, string>, query: req.query, body });
    if (result.ok) return { status: 200, body: result.value };
    const { code, retryable, agent_action, details } = result.error;
    return { status: 200, body: envelope(code, { retryable, agent_action, ...(details ? { details } : {}) }) };
  } catch (e) {
    if (e instanceof BadRequest) {
      return { status: 400, body: envelope('INVALID_REQUEST', { retryable: false, agent_action: `Fix the request and call again: ${e.message}.`, message: e.message }) };
    }
    console.error('unhandled error', e);
    return { status: 500, body: envelope('INTERNAL_ERROR', { retryable: true }) };
  }
}
