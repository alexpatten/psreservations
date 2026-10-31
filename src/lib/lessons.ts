import { useCallback, useEffect, useState } from 'react';
import * as api from './api';

/** The club's instructors, types, pricing and lesson types, with a reload. */
export function useLessons(clubId: string) {
  const [data, setData] = useState<api.Lessons | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api.lessons(clubId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [clubId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload, setData };
}

/** "from $80/hr": the lowest one-player rate that could apply to an instructor. */
export function fromPrice(l: api.Lessons, instructor: api.Instructor): number | null {
  const rates = l.rates.filter(
    (r) =>
      r.maxPlayers >= 1 &&
      (r.instructorId === instructor.id || (!r.instructorId && r.instructorTypeId === instructor.typeId) || (!r.instructorId && !r.instructorTypeId)),
  );
  // The most specific level that has rates wins, as on the server.
  for (const level of [(r: api.Rate) => r.instructorId === instructor.id, (r: api.Rate) => !r.instructorId && !!r.instructorTypeId, (r: api.Rate) => !r.instructorId && !r.instructorTypeId]) {
    const found = rates.filter(level).filter((r) => r.maxPlayers === Math.min(...rates.map((x) => x.maxPlayers)));
    if (found.length) return Math.min(...found.map((r) => r.priceCents));
  }
  return null;
}
