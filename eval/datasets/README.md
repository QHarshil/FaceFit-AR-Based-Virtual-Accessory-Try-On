# Datasets

Evaluation data is downloaded on demand into `eval/.cache/datasets/`, which git ignores. The repository holds only download scripts. Never commit images, labels, extracted landmarks or images derived from them.

## AFLW2000-3D

```sh
cd eval && node datasets/download-aflw2000.mjs              # fetch, hash-check, unpack
cd eval && node datasets/download-aflw2000.mjs --zip <path> # unpack a local copy, still hash-checked
```

- **What.** The first 2000 images of AFLW, cropped to 450x450, with a 3D morphable model fitted to each (Zhu et al., "Face Alignment Across Large Poses: A 3D Solution", CVPR 2016). Each `imageNNNNN.mat` holds `Pose_Para` (pitch, yaw and roll in radians, translation, scale) and `pt3d_68`, 68 landmarks of the fitted face in image pixels. The archive also ships the authors' MATLAB code, including the `RotationMatrix.m` that defines the angles.
- **Source.** `Database/AFLW2000-3D.zip` on the [3DDFA project page](http://www.cbsr.ia.ac.cn/users/xiangyuzhu/projects/3DDFA/main.htm). That link returned 404 on 2026-11-23, so the script falls back to the Internet Archive's capture of the same URL from 2026-04-05.
- **Integrity.** The script accepts only an archive of 87,413,900 bytes with SHA-256 `252bc35274d65ff27b6e573aa96c2f4c116ad88452cc984fb882258c0ed6e2d8`, the checksum TensorFlow Datasets records for the original URL. It refuses entries outside `AFLW2000/` before unpacking.
- **Licence.** None stated on the project page or in the archive. The images come from AFLW, which collected Flickr photos and was distributed for research use under its own agreement; its terms page could not be reached to confirm them. Treat the data as research-only: use it locally to measure, and do not redistribute it or anything derived from its images.

BIWI is not included. Its licence is non-commercial, and its download URL at ETH returns 403. See [docs/pose-benchmark.md](../../docs/pose-benchmark.md).
