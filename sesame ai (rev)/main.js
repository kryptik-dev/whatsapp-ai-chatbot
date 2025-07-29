// main.js

// --- Timer Logic ---
let seconds = 0;
let timerInterval = null;
const timerEl = document.getElementById('call-timer');

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    const min = String(Math.floor(seconds / 60)).padStart(2, '0');
    const sec = String(seconds % 60).padStart(2, '0');
    timerEl.textContent = `${min}:${sec}`;
  }, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
}

startTimer();

// --- Mic State & UI ---
let micOn = true;
const micStatusEl = document.getElementById('mic-status');
const callCircle = document.getElementById('call-circle');
const micIcon = document.getElementById('mic-icon');
const muteBtn = document.getElementById('mute-btn');
const endBtn = document.getElementById('end-btn');

function updateMicUI() {
  if (micOn) {
    micStatusEl.textContent = 'Mic On';
    micStatusEl.className = 'mt-4 text-green-200 text-lg';
    callCircle.classList.add('ring-4', 'ring-green-300', 'animate-pulse');
    micIcon.classList.remove('text-red-400');
    micIcon.classList.add('text-green-200');
    muteBtn.querySelector('span').textContent = 'Mute';
  } else {
    micStatusEl.textContent = 'Mic Off';
    micStatusEl.className = 'mt-4 text-red-400 text-lg';
    callCircle.classList.remove('ring-green-300', 'animate-pulse');
    callCircle.classList.add('ring-4', 'ring-red-400');
    micIcon.classList.remove('text-green-200');
    micIcon.classList.add('text-red-400');
    muteBtn.querySelector('span').textContent = 'Unmute';
  }
}

function toggleMic() {
  micOn = !micOn;
  updateMicUI();
  if (micOn) {
    startMicStream();
  } else {
    stopMicStream();
  }
}

// --- Spacebar to toggle mic ---
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    toggleMic();
  }
});

// --- Mute/Unmute button ---
muteBtn.addEventListener('click', () => {
  toggleMic();
});

// --- End Call button ---
endBtn.addEventListener('click', () => {
  stopTimer();
  micOn = false;
  updateMicUI();
  micStatusEl.textContent = 'Call Ended';
  micStatusEl.className = 'mt-4 text-gray-400 text-lg';
  callCircle.classList.remove('ring-green-300', 'ring-red-400', 'animate-pulse');
  callCircle.classList.add('opacity-50');
  stopMicStream();
  closeWebSocket();
});

// --- Initial UI State ---
updateMicUI();

// --- WebSocket Setup ---
// JWT extracted from WebSocket URL in official app
const ID_TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6Ijk1MWRkZTkzMmViYWNkODhhZmIwMDM3YmZlZDhmNjJiMDdmMDg2NmIiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiQW1hYW4iLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTHQybFFveEJwd1FfTHVXMENKNDhPTmY0MmtGNlFQc3M4MHdVWmhOMm5YZmprYUpBPXM5Ni1jIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL3Nlc2FtZS1haS1kZW1vIiwiYXVkIjoic2VzYW1lLWFpLWRlbW8iLCJhdXRoX3RpbWUiOjE3NTM3MTI5MTksInVzZXJfaWQiOiJSVGdldGVSVk9jUzc1T0R4ZkQxZ2VzcVU4d0EyIiwic3ViIjoiUlRnZXRlUlZPY1M3NU9EeGZEMWdlc3FVOHdBMiIsImlhdCI6MTc1MzcxMjkxOSwiZXhwIjoxNzUzNzE2NTE5LCJlbWFpbCI6InRoZTM2MHVuaXR5QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmaXJlYmFzZSI6eyJpZGVudGl0aWVzIjp7Imdvb2dsZS5jb20iOlsiMTA2MTkxMzQ5Mzc5MDU3NTc4NzkyIl0sImVtYWlsIjpbInRoZTM2MHVuaXR5QGdtYWlsLmNvbSJdfSwic2lnbl9pbl9wcm92aWRlciI6Imdvb2dsZS5jb20ifX0.VNSb6JkEHcxVkK6aMD3NMRuAcYuVhegIiMsIlwLFKjY7E7pj8YKPJUfQDmEWRhA_SlN2NrNLyzu8F-1MOaOIsly7g9eqlHG44q4Ztz2pyworPBVf8e4s5Ha4ht3AgXk2AGlX4tDWE_BMVG2juHHQuGzIMG8rjPN3TmAK8Z8AALVpFWBJpgK9nrXUy0EW3ur6er_m3fUCAY96oOuzBywXe_fLAES7omcYGklweUBXHP7AwXTAtnLm_U0A4Ut53Y4mlegNlKlGyFaFVyQgFz_FkqJER8ZxzmrtQL4ZNtd0kgBSVBFY4qdAZQQi5tGCEmDKji2F_zzrdEMFRtRxegXHMQ";
const CHARACTER = "Maya";
const TIMEZONE = "Africa/Johannesburg";
const WS_URL = `wss://sesameai.app/agent-service-0/v1/connect` +
  `?id_token=${encodeURIComponent(ID_TOKEN)}` +
  `&client_name=Consumer-Web-App` +
  `&usercontext=${encodeURIComponent(JSON.stringify({ timezone: TIMEZONE }))}` +
  `&character=${CHARACTER}`;

// --- WebRTC Variables ---
let ws = null;
let audioContext = null;
let micStream = null;
let peerConnection = null;
let remoteAudio = null;
let iceServers = [];
let pendingCandidates = [];
let webrtcReady = false;

function openWebSocket() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onopen = async () => {
    console.log('[+] Connected to Sesame AI (Voice)');
    // 1. Send client_location_state (mimic official client)
    ws.send(JSON.stringify({
      type: "client_location_state",
      session_id: null, // will be filled after initialize
      call_id: null,
      content: {
        latitude: 0,
        longitude: 0,
        address: "",
        timezone: TIMEZONE
      }
    }));
    // The rest of the flow will be handled in ws.onmessage after receiving 'initialize' and 'webrtc_config'.
  };

  // --- WebSocket message handler ---
  ws.onmessage = async (event) => {
    if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data);
        console.log('[<] Non-binary message (parsed):', msg);
        // Save session_id and call_id for later use
        if (msg.type === 'initialize') {
          ws._session_id = msg.session_id;
        }
        // Handle webrtc_config and call_connect
        if (msg.type === 'webrtc_config' && msg.content && msg.content.ice_servers) {
          iceServers = msg.content.ice_servers.map(s => ({
            urls: s.urls,
            username: s.username,
            credential: s.credential
          }));
          await setupWebRTC();
        }
        // Handle WebRTC offer/answer
        if (msg.type === 'webrtc_offer' && msg.content && msg.content.sdp) {
          if (!peerConnection) await setupWebRTC();
          console.log('[WebRTC] setRemoteDescription (offer)');
          await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.content.sdp }));
          const answer = await peerConnection.createAnswer({ offerToReceiveAudio: true });
          console.log('[WebRTC] setLocalDescription (answer)');
          await peerConnection.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'webrtc_answer', content: { sdp: answer.sdp } }));
          console.log('[WebRTC] Sent answer:', answer.sdp);
        }
        if (msg.type === 'webrtc_ice_candidate' && msg.content && msg.content.candidate) {
          if (peerConnection) {
            try {
              await peerConnection.addIceCandidate(msg.content.candidate);
            } catch (e) {
              pendingCandidates.push(msg.content.candidate);
            }
          } else {
            pendingCandidates.push(msg.content.candidate);
          }
        }
        // After receiving both initialize and webrtc_config, send call_connect
        if (ws._session_id && msg.type === 'webrtc_config' && msg.content && msg.content.ice_servers) {
          // Compose call_connect payload as seen in logs
          const clientMetadata = {
            user_agent: navigator.userAgent,
            mobile_browser: /Mobi|Android/i.test(navigator.userAgent),
            language: navigator.language,
            media_devices: (await navigator.mediaDevices.enumerateDevices()).map(d => ({
              deviceId: d.deviceId,
              kind: d.kind,
              label: d.label,
              groupId: d.groupId
            }))
          };
          // Optionally, you can generate a local SDP offer if needed
          let webrtc_offer_sdp = null;
          if (peerConnection) {
            const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
            await peerConnection.setLocalDescription(offer);
            webrtc_offer_sdp = offer.sdp;
          }
          ws.send(JSON.stringify({
            type: "call_connect",
            session_id: ws._session_id,
            call_id: null,
            request_id: crypto.randomUUID(),
            content: {
              sample_rate: 48000,
              audio_codec: "none",
              reconnect: false,
              is_private: false,
              settings: { character: CHARACTER },
              client_name: "Consumer-Web-App",
              client_metadata: clientMetadata,
              webrtc_offer_sdp
            }
          }));
        }
        // Handle call_connect_response (set remote description for WebRTC)
        if (msg.type === 'call_connect_response' && msg.content && msg.content.webrtc_answer_sdp) {
          if (peerConnection) {
            await peerConnection.setRemoteDescription(
              new RTCSessionDescription({ type: 'answer', sdp: msg.content.webrtc_answer_sdp })
            );
            console.log('[WebRTC] setRemoteDescription (answer)');
          }
          ws._call_id = msg.call_id;
        }
        // Handle call_connect_response (optional, for call_id)
        if (msg.type === 'call_connect_response') {
          ws._call_id = msg.call_id;
        }
      } catch (e) {
        console.log('[<] Non-binary message (raw):', event.data);
      }
      return;
    }
    // No binary audio expected in WebRTC mode
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  ws.onclose = () => {
    console.log('[-] Connection closed');
    stopMicStream();
    closeWebRTC();
  };
}

function closeWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

// --- WebRTC Setup ---
async function setupWebRTC() {
  if (peerConnection) return;
  // Add fallback STUN server
  const fallbackIce = [
    { urls: 'stun:stun.l.google.com:19302' },
    ...iceServers
  ];
  peerConnection = new RTCPeerConnection({ iceServers: fallbackIce });
  webrtcReady = true;

  // Handle ICE candidates from browser
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'webrtc_ice_candidate', content: { candidate: event.candidate } }));
    }
  };

  // Handle remote audio track
  peerConnection.ontrack = (event) => {
    console.log('[WebRTC] Remote track received:', event);
    if (!remoteAudio) {
      remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudio.style.display = 'none';
      document.body.appendChild(remoteAudio);
    }
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.volume = 1.0;
    remoteAudio.onloadedmetadata = () => {
      remoteAudio.play().catch(err => console.error('Auto-play blocked:', err));
    };
    // Log tracks
    if (remoteAudio.srcObject) {
      console.log('[WebRTC] Remote audio tracks:', remoteAudio.srcObject.getTracks());
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', peerConnection.connectionState);
  };
  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
  };

  // Add mic stream if available and mic is on
  if (micOn) {
    await startMicStream();
  }

  // Add any pending ICE candidates
  for (const cand of pendingCandidates) {
    try { await peerConnection.addIceCandidate(cand); } catch (e) {}
  }
  pendingCandidates = [];
}

function closeWebRTC() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (remoteAudio) {
    remoteAudio.srcObject = null;
    remoteAudio.remove();
    remoteAudio = null;
  }
  webrtcReady = false;
}

// --- Mic Capture and Streaming (WebRTC) ---
async function startMicStream() {
  if (!webrtcReady || !peerConnection) return;
  if (micStream) return; // Already running
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 }, video: false });
  for (const track of micStream.getAudioTracks()) {
    peerConnection.addTrack(track, micStream);
  }
  console.log('[WebRTC] Mic stream added:', micStream);
  // Log senders to confirm mic is attached
  console.log('[WebRTC] Senders after mic attach:', peerConnection.getSenders().map(s => s.track?.kind));
}

function stopMicStream() {
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  // Remove all local tracks from peerConnection
  if (peerConnection) {
    const senders = peerConnection.getSenders();
    senders.forEach(sender => {
      if (sender.track && sender.track.kind === 'audio') {
        peerConnection.removeTrack(sender);
      }
    });
  }
}

// --- Audio Playback (handled by remoteAudio element) ---
// No need for playPcmAudio in WebRTC mode

// Fetch Sesame user info from REST API using JWT
async function fetchSesameUser(jwt) {
  const response = await fetch('https://app.sesame.com/api/external/user', {
    headers: {
      'Authorization': `Bearer ${jwt}`
    }
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  const data = await response.json();
  console.log('Sesame user info:', data);
  return data;
}
// Usage example:
// fetchSesameUser('YOUR_JWT_HERE').then(user => { ... }).catch(console.error);

// --- Start everything ---
openWebSocket(); 