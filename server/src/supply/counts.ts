import { one } from '../db.js';

export interface SupplyCounts {
  new_requests: number;
  in_review: number;
  topups_to_add: number;
  available: number;
  reserved: number;
  assigned: number;
}

/** What is waiting for support: new number requests, paid top-ups to add, free numbers left. */
export async function supplyCounts(): Promise<SupplyCounts> {
  return (await one<SupplyCounts>(
    `SELECT (SELECT count(*) FROM number_requests WHERE status = 'submitted') AS new_requests,
            (SELECT count(*) FROM number_requests WHERE status = 'in_review') AS in_review,
            (SELECT count(*) FROM topups WHERE status = 'paid') AS topups_to_add,
            (SELECT count(*) FROM number_pool WHERE status = 'available') AS available,
            (SELECT count(*) FROM number_pool WHERE status = 'reserved') AS reserved,
            (SELECT count(*) FROM number_pool WHERE status = 'assigned') AS assigned`,
  ))!;
}
