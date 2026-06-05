class ScreenCapture {
  constructor(videoElement, canvasElement) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.stream = null;
    this.frameIntervalId = null;
    this.isCapturing = false;
    this.maxDimension = 1280; // Downscale big screens to speed up API response
  }

  async start() {
    try {
      // Prompt user to select screen or window
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 5, max: 10 }
        },
        audio: false // We capture audio separately from microphone
      });

      this.videoElement.srcObject = this.stream;
      this.videoElement.style.display = 'block';
      this.isCapturing = true;
      if (window.MediaRegistry) window.MediaRegistry.registerStream(this.stream);

      // Handle when user clicks the native browser "Stop sharing" button
      this.stream.getVideoTracks()[0].onended = () => {
        this.stop();
        if (this.onStopCallback) {
          this.onStopCallback();
        }
      };

      return true;
    } catch (error) {
      console.error("Error capturing screen:", error);
      throw error;
    }
  }

  startFrameLoop(fps, onFrameCallback) {
    if (!this.isCapturing) return;

    const intervalMs = 1000 / fps;
    const ctx = this.canvasElement.getContext('2d');

    this.frameIntervalId = setInterval(() => {
      if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
        // Source video size
        const vWidth = this.videoElement.videoWidth;
        const vHeight = this.videoElement.videoHeight;

        // Downscale calculations to keep bandwidth minimal
        let targetWidth = vWidth;
        let targetHeight = vHeight;

        if (vWidth > this.maxDimension || vHeight > this.maxDimension) {
          if (vWidth > vHeight) {
            targetWidth = this.maxDimension;
            targetHeight = Math.round((vHeight * this.maxDimension) / vWidth);
          } else {
            targetHeight = this.maxDimension;
            targetWidth = Math.round((vWidth * this.maxDimension) / vHeight);
          }
        }

        if (this.canvasElement.width !== targetWidth || this.canvasElement.height !== targetHeight) {
          this.canvasElement.width = targetWidth;
          this.canvasElement.height = targetHeight;
        }

        // Draw frame onto hidden canvas
        ctx.drawImage(this.videoElement, 0, 0, targetWidth, targetHeight);

        // Convert canvas image to base64 JPEG
        const fullDataUrl = this.canvasElement.toDataURL('image/jpeg', 0.4);
        const base64Data = fullDataUrl.split(',')[1];

        onFrameCallback(base64Data);
      }
    }, intervalMs);
  }

  stop() {
    this.isCapturing = false;

    // Clear capture loop
    if (this.frameIntervalId) {
      clearInterval(this.frameIntervalId);
      this.frameIntervalId = null;
    }

    // Stop all media tracks
    if (this.stream) {
      if (window.MediaRegistry) window.MediaRegistry.unregisterStream(this.stream);
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    // Reset video player
    this.videoElement.srcObject = null;
    this.videoElement.style.display = 'none';
  }

  pauseFrameLoop() {
    if (this.frameIntervalId) {
      clearInterval(this.frameIntervalId);
      this.frameIntervalId = null;
    }
  }

  resumeFrameLoop(fps, onFrameCallback) {
    if (!this.isCapturing) return;
    this.pauseFrameLoop(); // Prevent double intervals
    this.startFrameLoop(fps, onFrameCallback);
  }

  onStop(callback) {
    this.onStopCallback = callback;
  }
}
