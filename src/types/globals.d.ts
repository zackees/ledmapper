import type {
    MoviemakerDebugHooks,
    PerfCounters,
    LabelLayoutDebugHooks,
    ShapeeditorDebugHooks,
    SpaHistory,
} from './domain';

export {};

declare global {
    interface Window {
        __mmDebug?: MoviemakerDebugHooks;
        __perf?: PerfCounters;
        __labelLayoutDebug?: LabelLayoutDebugHooks;
        __shapeeditorDebug?: ShapeeditorDebugHooks;
        spaHistory?: SpaHistory;
    }
}
