class PCMProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      // Use the first channel (mono)
      const channelData = input[0];
      
      // Convert Float32 samples [-1.0, 1.0] to PCM 16-bit Int16 [-32768, 32767]
      const int16Buffer = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      
      // Send the Int16Array buffer back to main thread
      this.port.postMessage(int16Buffer.buffer, [int16Buffer.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
