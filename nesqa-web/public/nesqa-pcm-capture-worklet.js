class NesqaPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 24000;
    this.position = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;

    const frameLength = channels[0].length;
    const mono = new Float32Array(frameLength);
    for (let channel = 0; channel < channels.length; channel += 1) {
      const samples = channels[channel];
      for (let index = 0; index < frameLength; index += 1) {
        mono[index] += samples[index] / channels.length;
      }
    }

    const ratio = sampleRate / this.targetRate;
    const output = [];
    let position = this.position;
    while (position < frameLength) {
      const left = Math.floor(position);
      const right = Math.min(left + 1, frameLength - 1);
      const fraction = position - left;
      const sample = mono[left] + (mono[right] - mono[left]) * fraction;
      output.push(Math.max(-1, Math.min(1, sample)));
      position += ratio;
    }
    this.position = position - frameLength;

    if (output.length > 0) {
      const pcm16 = new Int16Array(output.length);
      for (let index = 0; index < output.length; index += 1) {
        const sample = output[index];
        pcm16[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor("nesqa-pcm-capture", NesqaPcmCaptureProcessor);
