export interface Signal {
  tag: string;
  desc: string;
  /** Number printed on the chart (cause row no. / effect column no.) */
  num: string;
}

/** One cause & effect matrix (one Excel sheet). */
export interface Matrix {
  id: string;
  name: string;
  source: string;
  causes: Signal[];
  effects: Signal[];
  /** Sparse intersections: [causeIndex, effectIndex, code] */
  links: [number, number, string][];
}

export type TripItem = { kind: 'heading'; text: string } | { kind: 'signal'; tag: string; desc: string };

/** A package / shutdown level and the list of signals that trip it. */
export interface TripGroup {
  id: string;
  name: string;
  source: string;
  sheet: string;
  items: TripItem[];
}

export interface SheetReport {
  file: string;
  sheet: string;
  status: 'matrix' | 'trips' | 'data' | 'notes' | 'skipped';
  detail: string;
}

export interface SignalNote {
  ref?: string;
  text: string;
  /** where the note comes from, e.g. "note 25 on sheets 1, 2" */
  where?: string;
}

/** Extra facts about a signal: set point, range, voting, notes … from a matrix's info columns or a Signal data sheet. */
export interface SignalData {
  tag: string;
  role?: 'cause' | 'effect';
  /** shown to the user: matrix name or the Source column */
  source: string;
  /** workbook the row came from (used to replace data on re-import) */
  file: string;
  values: { label: string; value: string }[];
  notes: SignalNote[];
}

export interface ParseResult {
  matrices: Matrix[];
  tripGroups: TripGroup[];
  signalData: SignalData[];
  report: SheetReport[];
}

export interface Dataset {
  matrices: Matrix[];
  tripGroups: TripGroup[];
  /** optional so data saved by earlier versions still loads */
  signalData?: SignalData[];
  files: { name: string; importedAt: string; report: SheetReport[] }[];
}

export const emptyDataset = (): Dataset => ({ matrices: [], tripGroups: [], signalData: [], files: [] });
