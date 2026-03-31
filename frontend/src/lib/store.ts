import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CommodityDataset } from "./types";

interface CommodityStore {
  // ── Data ──
  datasets: CommodityDataset[];
  activeDatasetIds: string[];

  // ── Data Actions ──
  addDataset: (dataset: CommodityDataset) => void;
  addDatasets: (datasets: CommodityDataset[]) => void;
  removeDataset: (id: string) => void;
  clearAllDatasets: () => void;

  // ── Selection Actions ──
  setActiveDatasets: (ids: string[]) => void;
  toggleActiveDataset: (id: string) => void;
  getActiveDatasets: () => CommodityDataset[];

  // ── UI State ──
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useCommodityStore = create<CommodityStore>()(
  persist(
    (set, get) => ({
      datasets: [],
      activeDatasetIds: [],

      addDataset: (dataset) =>
        set((state) => {
          const isDup = state.datasets.some(
            (d) =>
              d.ticker === dataset.ticker &&
              d.source === dataset.source &&
              d.interval === dataset.interval
          );
          if (isDup) return state;
          return {
            datasets: [dataset, ...state.datasets],
            activeDatasetIds: [dataset.id, ...state.activeDatasetIds],
          };
        }),

      addDatasets: (datasets) =>
        set((state) => {
          const newDatasets = datasets.filter(
            (d) =>
              !state.datasets.some(
                (e) =>
                  e.ticker === d.ticker &&
                  e.source === d.source &&
                  e.interval === d.interval
              )
          );
          if (newDatasets.length === 0) return state;
          return {
            datasets: [...newDatasets, ...state.datasets],
            activeDatasetIds: [
              ...newDatasets.map((d) => d.id),
              ...state.activeDatasetIds,
            ],
          };
        }),

      removeDataset: (id) =>
        set((state) => ({
          datasets: state.datasets.filter((d) => d.id !== id),
          activeDatasetIds: state.activeDatasetIds.filter((aid) => aid !== id),
        })),

      clearAllDatasets: () => set({ datasets: [], activeDatasetIds: [] }),

      setActiveDatasets: (ids) => set({ activeDatasetIds: ids }),

      toggleActiveDataset: (id) =>
        set((state) => ({
          activeDatasetIds: state.activeDatasetIds.includes(id)
            ? state.activeDatasetIds.filter((aid) => aid !== id)
            : [...state.activeDatasetIds, id],
        })),

      getActiveDatasets: () => {
        const { datasets, activeDatasetIds } = get();
        return datasets.filter((d) => activeDatasetIds.includes(d.id));
      },

      sidebarCollapsed: false,

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: "commodityiq-store",
    }
  )
);
