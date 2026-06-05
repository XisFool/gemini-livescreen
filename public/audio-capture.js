class AudioCapture {
  static globalContext = null;

  constructor(onAudioChunkCallback) {
    this.onAudioChunk = onAudioChunkCallback;
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.isActive = false;
  }

  async start() {
    if (this.isActive) return;

    try {
      // 1. Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1
        }
      });
      if (window.MediaRegistry) window.MediaRegistry.registerStream(this.mediaStream);

      // 2. Initialize or reuse AudioContext (preferably using window.getSharedAudioContext)
      if (window.getSharedAudioContext) {
        AudioCapture.globalContext = window.getSharedAudioContext();
      } else if (!AudioCapture.globalContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        AudioCapture.globalContext = new AudioContextClass({ sampleRate: 16000 });
        if (window.MediaRegistry) window.MediaRegistry.registerContext(AudioCapture.globalContext);
      }

      // 3. Register and load the AudioWorklet (Only add once per context)
      if (!AudioCapture.globalContext.workletLoaded) {
        let workletPath = 'audio-worklet.js';
        if (window.location.protocol === 'file:') {
          workletPath = '../../public/audio-worklet.js';
        }
        await AudioCapture.globalContext.audioWorklet.addModule(workletPath);
        AudioCapture.globalContext.workletLoaded = true;
      }

      this.audioContext = AudioCapture.globalContext;
      const inputSampleRate = this.audioContext.sampleRate;
      console.log(`AudioContext initialized. Actual sample rate: ${inputSampleRate}Hz`);

      // 4. Create Node and link stream source
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

      // 5. Connect node graphs
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      // 6. Handle raw PCM data returning from Worklet
      this.workletNode.port.onmessage = (event) => {
        if (!this.isActive) return;

        const rawPCMBuffer = event.data; // ArrayBuffer of Int16 samples
        const int16Samples = new Int16Array(rawPCMBuffer);

        // Downsample to 16000Hz if the browser context sample rate is different
        let finalSamples = int16Samples;
        if (inputSampleRate !== 16000) {
          finalSamples = this.downsample(int16Samples, inputSampleRate, 16000);
        }

        // Convert the final 16000Hz Int16Array to base64
        const base64Data = this.arrayBufferToBase64(finalSamples.buffer);
        this.onAudioChunk(base64Data);
      };

      // Resume context if suspended (browser security policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.isActive = true;
      console.log("Audio capture started successfully.");
      return true;
    } catch (error) {
      console.error("Error starting audio capture:", error);
      this.stop();
      throw error;
    }
  }

  stop() {
    this.isActive = false;

    // Disconnect graphs
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (e) {}
      this.sourceNode = null;
    }

    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (e) {}
      this.workletNode = null;
    }

    // Suspend context instead of closing to preserve hardware resources
    if (this.audioContext) {
      try {
        this.audioContext.suspend();
      } catch (e) {}
      this.audioContext = null;
    }

    // Stop all media tracks
    if (this.mediaStream) {
      if (window.MediaRegistry) window.MediaRegistry.unregisterStream(this.mediaStream);
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    console.log("Audio capture stopped.");
  }

  // Linear interpolation downsampling algorithm
  downsample(buffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) {
      return buffer;
    }
    if (inputSampleRate < outputSampleRate) {
      console.warn("Cannot upsample. Input rate smaller than output rate.");
      return buffer;
    }

    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Int16Array(newLength);
    
    let offsetResult = 0;
    let offsetBuffer = 0;
    
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0;
      let count = 0;
      
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    
    return result;
  }

  // Convert ArrayBuffer to Base64
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}
