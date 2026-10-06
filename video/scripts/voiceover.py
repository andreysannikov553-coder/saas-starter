"""Generate the Intro voiceover with the sherpa-onnx engine used by VoiceStudio.

usage: python -I voiceover.py <model_dir> <out.wav> <text>
"""
import sys

import numpy as np
import sherpa_onnx
import soundfile as sf

model_dir, out, text = sys.argv[1], sys.argv[2], sys.argv[3]

tts = sherpa_onnx.OfflineTts(
    sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=f"{model_dir}/ru_RU-irina-medium.onnx",
                tokens=f"{model_dir}/tokens.txt",
                data_dir=f"{model_dir}/espeak-ng-data",
            ),
        ),
    )
)
audio = tts.generate(text, sid=0, speed=1.0)
sf.write(out, np.array(audio.samples, dtype=np.float32), audio.sample_rate)
print(f"{out}: {len(audio.samples) / audio.sample_rate:.2f}s @ {audio.sample_rate} Hz")
