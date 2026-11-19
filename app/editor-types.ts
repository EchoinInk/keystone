export type Row = Record<string, unknown> & { id: string };
export type DataSet = Record<string, Row[]>;
export type EditorTarget = { entity: string; row?: Row; initial?: Record<string, unknown> };
export type Save = (entity: string, action: string, payload: Record<string, unknown>) => Promise<void>;
