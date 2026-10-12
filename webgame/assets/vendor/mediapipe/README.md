# Local face landmark runtime

Pinned `@mediapipe/tasks-vision` 1.1.0 from the npm registry:
https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.1.0.tgz

Model: MediaPipe Face Landmarker float16 version 1:
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

Documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
Upstream license: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

Bundled locally to avoid runtime CDN dependencies. Face images are processed in
the browser; this runtime does not upload player photos to Google. The app stores
the cropped JPEG in its existing player-private Supabase bucket.
