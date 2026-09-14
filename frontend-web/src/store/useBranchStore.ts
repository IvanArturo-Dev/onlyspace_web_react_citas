import { create } from "zustand";
import { branchService, type Branch } from "../services/branch.service";

const STORAGE_KEY = "active_branch_id";

function getStoredActiveId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage no disponible */
  }
}

interface BranchState {
  branches: Branch[];
  activeBranchId: string | null;
  loading: boolean;
  error: string;
  setActiveBranch: (id: string) => void;
  loadBranches: () => Promise<void>;
}

export const useBranchStore = create<BranchState>((set, get) => ({
  branches: [],
  activeBranchId: getStoredActiveId(),
  loading: false,
  error: "",

  setActiveBranch: (id) => {
    persistActiveId(id);
    set({ activeBranchId: id });
  },

  loadBranches: async () => {
    set({ loading: true, error: "" });
    try {
      const branches = await branchService.list();
      const stored = get().activeBranchId;
      // Mantiene la activa si sigue existiendo; si no, selecciona la primera.
      const stillValid = stored && branches.some((b) => b.id === stored);
      const nextActive = stillValid ? stored : branches[0]?.id ?? null;
      if (nextActive !== stored) persistActiveId(nextActive);
      set({ branches, activeBranchId: nextActive, loading: false });
    } catch (err: any) {
      set({
        loading: false,
        error: err?.response?.data?.error?.message || err?.message || "Error al cargar las sucursales",
      });
    }
  },
}));
