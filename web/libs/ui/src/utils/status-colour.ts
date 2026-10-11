import { type GuardRead } from '../machines/guardBoard.js';

/** Each status's colour. */
export const STATUS_COLOUR: Record<GuardRead['status'], string> = {
    HEALTHY: 'var(--nori-light-green)',
    WARN: 'var(--nori-neon-blue)',
    PAUSED_AT_SOURCE: 'var(--nori-neon-blue)',
    STALE: 'var(--nori-muted)',
    TRIPPED: 'var(--nori-neon-red)',
};
