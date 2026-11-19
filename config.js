// Bharul serves the PWA and WebRTC signaling from one HTTPS Render service.
const signalingProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
window.BHARUL_SIGNAL_URL = `${signalingProtocol}//${location.host}/signal`;
