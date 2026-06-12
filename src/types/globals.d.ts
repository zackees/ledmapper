import type {
    MoviemakerDebugHooks,
    PerfCounters,
    LabelLayoutDebugHooks,
    ShapeeditorDebugHooks,
} from './domain';

export {};

declare global {
    interface Window {
        __mmDebug?: MoviemakerDebugHooks;
        __perf?: PerfCounters;
        __labelLayoutDebug?: LabelLayoutDebugHooks;
        __shapeeditorDebug?: ShapeeditorDebugHooks;
    }
}
