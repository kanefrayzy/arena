import { create } from 'zustand';

export interface Me {
  id: number;
  email: string;
  username: string;
  role: 'PLAYER' | 'ADMIN' | 'MODERATOR';
  cup?: number;
  mmr?: number;
}

interface AuthState {
  me: Me | null;
  setMe: (me: Me | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  me: null,
  setMe: (me) => set({ me }),
}));
