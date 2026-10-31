import { createContext, useContext } from 'react';
import type { CEIndex } from './ceIndex';
import type { Dataset } from './model';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
  title?: string;
  action?: { label: string; run: () => void };
}

export interface AppState {
  ds: Dataset;
  ix: CEIndex;
  busy: string | null;
  importFiles: (files: File[]) => void;
  openPicker: () => void;
  removeMatrix: (id: string) => void;
  removeTrips: () => void;
  removeSignalData: (file: string) => void;
  /** remove everything that came from one imported workbook */
  removeFile: (name: string) => void;
  clearAll: () => void;
  notify: (t: Omit<Toast, 'id'>) => void;
}

export const AppCtx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppCtx);
