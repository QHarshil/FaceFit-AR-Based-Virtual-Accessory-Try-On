# Device checklist

Manual checks on a phone, over HTTPS on the deployed site. Run them on iPhone Safari and on Android Chrome. The browser tests in [eval/README.md](../eval/README.md) cover desktop engines; they cannot grant a real camera permission prompt, rotate a device or dim a room.

Before you start, note the device model, OS version and browser version, and clear the site's camera permission in the browser settings. Use a front-facing, upright face in even light unless a step says otherwise. Open a frame from the catalogue for every step.

Each row has an expected result. Mark pass or fail and write down what you saw when it differs.

## Permission

| # | Step | Expected |
|---|------|----------|
| 1 | Open a frame for the first time | The browser asks for the camera. The page shows "Waiting for the camera" with "Use a photo" and "Back to catalogue" |
| 2 | Allow | The status moves to "Loading face tracking", then "Tracking". The glasses sit on your face |
| 3 | Reload, then deny | The page shows "Camera access is blocked" with "Try again", "Use a photo" and "Back to catalogue" |
| 4 | Allow the camera in the browser's site settings, return to the page, tap "Try again" | The status moves to "Tracking" without a reload |

## Tracking

| # | Step | Expected |
|---|------|----------|
| 5 | Hold still for 10 seconds | The glasses stay on the bridge of the nose with no visible shimmer |
| 6 | Tilt your head left and right | The glasses roll with your eye line |
| 7 | Move closer to and further from the camera | The glasses scale with your face |
| 8 | Turn your head far to one side | The glasses hide rather than slide off the face, and return when you face the camera |
| 9 | Move out of view and back | "Face not found", then "Tracking" |
| 10 | Let a second face into view | "More than one face in view"; the glasses stay on the larger face |

## Photo fallback

| # | Step | Expected |
|---|------|----------|
| 11 | From the blocked state, tap "Use a photo", then "Choose a photo" and pick a front-facing portrait | "Photo try-on" with the glasses on the face. The photo shows whole and unmirrored |
| 12 | Pick a photo with no face | "No face in this photo" with "Choose a photo" and "Use the camera" |

## Rotation

| # | Step | Expected |
|---|------|----------|
| 13 | While tracking in portrait, rotate to landscape | The video fills the screen, cropped on the sides it overflows, and the glasses stay on the face |
| 14 | Rotate back | The same, with no blank or stale frame |
| 15 | Rotate while a photo is showing | The photo and the glasses rescale together |

## Hidden tab and interruptions

| # | Step | Expected |
|---|------|----------|
| 16 | Switch to another app for 10 seconds and return | The camera indicator turns off while away; the page shows "Paused", then "Tracking" within a few seconds of return |
| 17 | Lock the screen for 10 seconds and unlock | The same as step 19 |
| 18 | Receive a call or start another camera app, then return | "The camera is in use" or "The camera disconnected" with "Try again"; "Try again" recovers once the other app lets go |

## Low light

| # | Step | Expected |
|---|------|----------|
| 19 | Cover the camera lens with a finger for 3 seconds | "Too dark to find your face" with "Use a photo" |
| 20 | Uncover it | "Looking for your face", then "Tracking" |
| 21 | In a dim room with a screen as the only light | Tracking holds or the page says "Too dark to find your face"; it never draws the glasses away from the face |

## Layout and access

| # | Step | Expected |
|---|------|----------|
| 22 | Look at the catalogue and a try-on page in portrait and landscape | No text is clipped, nothing is hidden behind the browser's toolbar, and every button can be tapped |
| 23 | Turn on the screen reader (VoiceOver or TalkBack), open a frame | Status changes are announced; every recovery button is reachable and named |
| 24 | Open the page over HTTP, if the host allows it | "This page cannot use a camera" with "Use a photo" |
