# Mobile validation

This guide defines Ledmapper's supported mobile baseline and the repeatable
validation procedure for Play, Create, and Record. Automated emulation is the
regression gate; physical devices verify the browser, media, file-picker, and
lifecycle behavior that emulation cannot faithfully reproduce.

## Supported baseline

- Current stable iOS Safari on an iPhone.
- Current stable Android Chrome on an Android phone.
- Phone viewport widths from 320 through 430 CSS pixels.
- Portrait and landscape orientations.
- The `/play`, `/create`, and `/record` routes.
- Browser zoom, safe-area insets, touch input, file selection, and camera
  permission flows.

"Current stable" means the latest generally available browser and operating
system updates offered to the device on the validation date. Record the exact
versions in the evidence; a result without version and commit information is
not a completed validation.

## Automated regression gate

The `mobile-chromium` and `mobile-webkit` Playwright projects cover 320x568,
360x800, 390x844, 430x932, and 844x390 viewports. The suite checks every app
mode for overflow, reachable controls, safe areas, browser zoom, touch targets,
gesture isolation, source recovery, orientation/lifecycle state, and recording
loss prevention.

Before physical testing, run:

```bash
npm ci
npm run lint
npm run build
npm test
npm run test:integration -- mobile-safety --project=mobile-chromium --project=mobile-webkit
```

All non-device-dependent checks must pass. A documented skip is acceptable
only when the emulated engine lacks the required media or browser API; the
equivalent physical-device step remains mandatory.

## Prepare a physical-device run

1. Use the deployed HTTPS site for the exact commit under test. Record the
   commit SHA and URL. HTTPS is required for representative camera permission
   behavior.
2. Install all available OS and browser updates, then record the device model,
   OS version, and browser version.
3. Put these repository fixtures in each phone's local file provider:
   `tests/fixtures/test-video.fled`, `tests/fixtures/test-screenmap.json`, and
   `tests/fixtures/test-video.mp4`.
4. Start with browser zoom at its default, no external keyboard or mouse, and
   no previously granted camera permission. Clear the site's storage before
   the first run, but not between journeys unless a step says to do so.
5. Run the complete matrix once on iPhone/Safari and once on Android/Chrome.
   Exercise every journey in both portrait and landscape.

## Journey matrix

Mark each numbered journey pass or fail for each device. On failure, capture a
screenshot or short video, copy diagnostics when offered, and file a focused
issue before continuing.

### Shared shell and accessibility

1. Open each of Play, Create, and Record directly in a fresh tab.
2. Confirm Play, Create, and Record are visible, tappable, and indicate the
   current mode. Navigate through all three using touch only.
3. On every route, rotate portrait to landscape and back. Confirm controls
   reflow without horizontal page scrolling, clipping, overlap, or lost state.
4. Zoom the page to at least 200 percent and return to default. Confirm the page
   remains navigable and controls can still be reached.
5. Background the browser for at least five seconds and restore it. Confirm the
   current route and work are preserved and no blank canvas or unrecoverable
   dialog appears.
6. Confirm normal page areas scroll with one finger while gestures over an
   interactive canvas affect only that canvas.

### Play

1. Open `/play` and choose `test-video.fled` with the system file picker.
2. Start playback, pause it, seek to a different position, and resume.
3. Rotate and background/restore during playback. Confirm controls remain
   reachable and playback can continue.
4. Switch to Create, then return to Play. Confirm navigation completes without
   a stuck overlay, frozen page, or browser error.

Pass when the selected file renders, playback controls respond to touch, seek
works, and orientation/lifecycle changes do not corrupt the player.

### Create

1. Open `/create` and load `test-screenmap.json`.
2. Select LEDs or a group, drag the selection, pan, pinch-zoom, and use every
   exposed selection action with touch. No essential action may require hover,
   right-click, a keyboard, or a mouse.
3. Rotate and background/restore with an edit present. Confirm the edit remains.
4. Navigate to Play and back to Create. Confirm the saved/restored map contains
   the edit.
5. Export the screenmap, reopen it from the phone's file provider, and confirm
   its LED count and visible geometry match.

Pass when editing is touch-complete, the canvas and controls remain reachable,
and no orientation, interruption, or navigation step silently loses the map.

### Record

Run the file-source path and the camera path separately.

1. Open `/record`, select a screenmap, choose the video-file source, and load
   `test-video.mp4` from the system file picker.
2. Start a FLED recording. While it is active, try to switch to Create. Cancel
   the warning and confirm recording continues; repeat and explicitly accept
   discard, then confirm navigation completes without downloading a partial
   result.
3. Start another recording, rotate the phone, and background/restore the
   browser. Confirm the app either preserves the capture or gives an explicit,
   actionable interruption message; it must not silently report success or
   lose a completed output.
4. Stop normally, save the result, load it in Play, and confirm it renders.
5. Return to Record and choose Camera. Deny permission once and confirm the UI
   explains how to recover. Grant permission on the next attempt and confirm a
   live preview appears.
6. Start and stop a short camera recording, then load the result in Play.
7. Revoke camera permission in browser/site settings and retry. Confirm Record
   returns to a usable source-selection state with an actionable error.

Pass when file and camera sources are recoverable, active capture cannot be
silently discarded, and every normally completed output can be retrieved and
played.

## Evidence and triage

Post one result table to the tracking issue using this template:

```markdown
Commit / deployment:
Validation date:

| Device | OS | Browser | Shared | Play | Create | Record | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone model | iOS version | Safari version | PASS/FAIL | PASS/FAIL | PASS/FAIL | PASS/FAIL | links |
| Android model | Android version | Chrome version | PASS/FAIL | PASS/FAIL | PASS/FAIL | PASS/FAIL | links |

Failures filed:
- #issue - short description, device, orientation, journey step
```

Classify crashes, inaccessible critical controls, unrecoverable camera/file
flows, corrupted state, and silent loss of work or completed output as P0/P1.
Do not close the mobile-safety tracking issue while any discovered P0/P1 defect
is open. Link lower-priority defects from the evidence report so they remain
traceable.

The physical-device gate passes only when every journey above passes on both
required browser/device combinations and the completed evidence table is linked
from the tracking issue.
