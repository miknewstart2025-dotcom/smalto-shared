export declare const SCAN_DEFAULTS: { minLength: number; maxGapMs: number };

export interface ScanOptions {
  /** Longueur minimale d'un code (défaut 6). */
  minLength?: number;
  /** Écart maximal entre deux touches d'un même scan, en ms (défaut 100). */
  maxGapMs?: number;
}

export type ScanStep =
  | { type: "scan"; code: string }
  | { type: "start" }
  | { type: "char" }
  | { type: "ignore" };

/** Touche physique → caractère d'un clavier américain (indépendant de la langue du clavier). */
export declare function keyFromEvent(e: { code: string; key: string; shiftKey: boolean }): string;

export declare function createScanDetector(options?: ScanOptions): {
  push(key: string, at: number): ScanStep;
  /** Code numérique suivi d'un silence (douchette sans « Entrée » final). */
  idle(at: number): ScanStep;
  reset(): void;
};

/** Écoute la douchette sur la page ; renvoie la fonction qui débranche l'écoute. */
export declare function listenForScans(onScan: (code: string) => void, options?: ScanOptions): () => void;
