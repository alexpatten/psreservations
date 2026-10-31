import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from './api';
import { useAuth } from './auth';

interface ClubState {
  club: api.Club | null;
  error: string | null;
  /** Fetches the club again (after a settings change elsewhere, or joining). */
  reload: () => Promise<void>;
  /** Replaces the club with what a settings call returned. */
  setClub: (club: api.Club) => void;
}

const ClubContext = createContext<ClubState | null>(null);

export function useClub(): ClubState & { club: api.Club } {
  const ctx = useContext(ClubContext);
  if (!ctx?.club) throw new Error('useClub must be used inside a loaded <ClubProvider>');
  return ctx as ClubState & { club: api.Club };
}

export function useClubState(): ClubState {
  const ctx = useContext(ClubContext);
  if (!ctx) throw new Error('useClubState must be used inside <ClubProvider>');
  return ctx;
}

export function ClubProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const { status } = useAuth();
  const [club, setClub] = useState<api.Club | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await api.getClub(slug);
      if (!next) setError('We couldn’t find that club.');
      else {
        setClub(next);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    if (status === 'signedIn') reload();
  }, [status, reload]);

  return <ClubContext.Provider value={{ club, error, reload, setClub }}>{children}</ClubContext.Provider>;
}
