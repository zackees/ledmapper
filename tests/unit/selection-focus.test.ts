import assert from 'node:assert/strict';
import test from 'node:test';
import { groupFocusOpacity, UNSELECTED_GROUP_OPACITY } from '../../src/shapeeditor/selection-focus';

test('group focus keeps the selected group opaque and dims other groups', () => {
    assert.equal(groupFocusOpacity(null, 1), 1);
    assert.equal(groupFocusOpacity(1, 1), 1);
    assert.equal(groupFocusOpacity(1, 0), UNSELECTED_GROUP_OPACITY);
    assert.equal(UNSELECTED_GROUP_OPACITY, 0.4);
});
