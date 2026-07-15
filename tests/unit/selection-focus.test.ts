import assert from 'node:assert/strict';
import test from 'node:test';
import { groupFocusOpacity, UNSELECTED_GROUP_OPACITY } from '../../src/shapeeditor/selection-focus';

test('group focus keeps the selected group opaque and dims other groups', () => {
    assert.equal(groupFocusOpacity(null, 1), 1);
    assert.equal(groupFocusOpacity(1, 1), 1);
    assert.equal(groupFocusOpacity(1, 0), UNSELECTED_GROUP_OPACITY);
    assert.equal(UNSELECTED_GROUP_OPACITY, 0.4);
});
test('every selected group remains opaque regardless of primary', () => {
    const selected = new Set([1, 3]);
    assert.equal(groupFocusOpacity(selected, 1), 1);
    assert.equal(groupFocusOpacity(selected, 3), 1);
    assert.equal(groupFocusOpacity(selected, 2), UNSELECTED_GROUP_OPACITY);
    assert.equal(groupFocusOpacity(new Set(), 2), 1);
});
