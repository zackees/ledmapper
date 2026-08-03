import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductionQuery } from '../../src/production/contract';
import {
    canTransitionProductionPhase,
    createProductionState,
    snapshotProductionState,
    transitionProductionPhase,
    updateProductionProgress,
} from '../../src/production/state';

const config = parseProductionQuery('v=1&input=https%3A%2F%2Fexample.com%2Finput.zip&output=both');

describe('production state model', () => {
    void test('initializes expected artifacts and serializable state', () => {
        const state = createProductionState(config);
        assert.equal(state.phase, 'awaiting-input');
        assert.deepEqual(state.expectedArtifacts, ['fled', 'mp4']);
        assert.doesNotThrow(() => JSON.stringify(state));
    });

    void test('allows monotonic progress and terminal failures', () => {
        const state = createProductionState(config);
        transitionProductionPhase(state, 'validating-input');
        transitionProductionPhase(state, 'ready');
        transitionProductionPhase(state, 'rendering');
        transitionProductionPhase(state, 'encoding');
        transitionProductionPhase(state, 'completed');
        assert.equal(state.phase, 'completed');
        assert.equal(canTransitionProductionPhase('completed', 'failed'), false);
        assert.throws(() => { transitionProductionPhase(state, 'failed'); }, /Invalid production phase transition/);
    });

    void test('rejects backward and repeated transitions', () => {
        const state = createProductionState(config);
        assert.throws(() => { transitionProductionPhase(state, 'awaiting-input'); });
        transitionProductionPhase(state, 'ready');
        assert.throws(() => { transitionProductionPhase(state, 'validating-input'); });
    });

    void test('validates and bounds frame progress', () => {
        const state = createProductionState(config);
        updateProductionProgress(state, 3, 4, 30);
        assert.deepEqual(state.progress, { completedFrames: 3, totalFrames: 4, fraction: 0.75, fps: 30 });
        assert.throws(() => { updateProductionProgress(state, 5, 4); }, RangeError);
        assert.throws(() => { updateProductionProgress(state, 1.5, 4); }, RangeError);
    });

    void test('returns detached snapshots', () => {
        const state = createProductionState(config);
        const snapshot = snapshotProductionState(state);
        snapshot.expectedArtifacts.pop();
        assert.deepEqual(state.expectedArtifacts, ['fled', 'mp4']);
    });
});
