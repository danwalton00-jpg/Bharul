(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const camera = $('camera'), photo = $('photoPreview'), video = $('videoPreview'), audio = $('audioPreview');
  let stream = null, facing = 'user', files = [], activeUrl = null;
  const setStatus = (id, value) => { $(id).textContent = value; };
  const dot = (id, state='') => { $(id).className = `check-dot ${state}`; };
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  function browserInfo() {
    const ua = navigator.userAgent || '';
    const isEdge = /Edg\//.test(ua);
    const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !isEdge && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const name = isEdge ? 'Microsoft Edge' : isSafari ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : 'Other browser';
    return {name, isIOS, isEdge, isSafari};
  }
  function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),3000); }
  function diagnose(title, message) { const box=$('diagnosis'); box.replaceChildren(); const b=document.createElement('b'); b.textContent=title; const p=document.createElement('p'); p.textContent=message; box.append(b,p); }
  function updateCameraUI(on) {
    $('cameraBadge').textContent=on?'Camera active':'Camera off'; $('cameraBadge').className='status '+(on?'good':'neutral');
    $('startCamera').disabled=on; $('switchCamera').disabled=!on; $('stopCamera').disabled=!on;
    camera.style.display=on?'block':'none'; $('emptyState').classList.toggle('hidden',on||!!activeUrl);
    $('stageLabel').textContent=on?'Live camera is running':(activeUrl?'Personal media selected':'Ready when you are');
  }
  async function requestCameraWithFallback() {
    const attempts = [
      {audio:false, video:{facingMode:{ideal:facing}, width:{ideal:1280}, height:{ideal:720}}},
      {audio:false, video:{facingMode:{ideal:facing}}},
      {audio:false, video:true}
    ];
    let lastError;
    for (const constraints of attempts) {
      try { return await navigator.mediaDevices.getUserMedia(constraints); }
      catch (err) {
        lastError = err;
        // Retry only when the requested camera constraints are unsupported.
        if (!['OverconstrainedError','ConstraintNotSatisfiedError'].includes(err.name)) throw err;
      }
    }
    throw lastError || new Error('No compatible camera configuration was found.');
  }
  async function startCamera() {
    if (!secure) { diagnose('Secure connection required','Camera and microphone access require HTTPS, except on localhost. Deploy Bharul to an HTTPS website, then try again.'); toast('Open Bharul using HTTPS'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { diagnose('Camera API unavailable','This browser or context does not expose camera access. Update Safari or Edge and check site permissions.'); dot('checkCamera','warn'); setStatus('cameraValue','Unavailable'); return; }
    stopCamera(false);
    try {
      stream=await requestCameraWithFallback();
      camera.srcObject=stream; await camera.play(); updateCameraUI(true); dot('checkCamera','ok'); setStatus('cameraValue','Available'); dot('checkPermission','ok'); setStatus('permissionValue','Granted');
      diagnose('Camera is working','Your browser granted camera access. You can keep the camera running while previewing a selected media file.');
    } catch(err) {
      updateCameraUI(false);
      const map={NotAllowedError:['Permission blocked','Allow camera access for Bharul in the browser site settings, then return and tap Start camera.'],NotFoundError:['No camera found','No available camera was detected. You can still preview uploaded media.'],NotReadableError:['Camera is busy','Another app or browser tab may be using the camera. Close it and retry.'],OverconstrainedError:['Camera mode unsupported','This camera does not support the requested mode. Try again with the default camera.'],SecurityError:['Secure connection required','Camera access requires HTTPS or localhost.']};
      const info=map[err.name]||['Could not start camera',`${err.name||'Camera error'}: ${err.message||'Check browser permissions and retry.'}`];
      diagnose(info[0],info[1]); dot('checkPermission','warn'); setStatus('permissionValue',err.name==='NotAllowedError'?'Blocked':'Needs attention'); toast(info[0]);
      // Never loop permission prompts: recover automatically only for retryable device/constraint errors.
      if (['OverconstrainedError','ConstraintNotSatisfiedError'].includes(err.name)) {
        facing='user';
        diagnose('Camera mode adjusted','The preferred camera mode was unavailable. Bharul will use the browser default camera settings; tap Start camera to retry.');
      }
    }
  }
  function stopCamera(show=true) {
    if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
    camera.srcObject=null; updateCameraUI(false);
    if(show){diagnose('Camera stopped','The camera is no longer active. Your selected media can still be previewed.');toast('Camera stopped');}
  }
  $('startCamera').addEventListener('click',startCamera);
  $('stopCamera').addEventListener('click',()=>stopCamera());
  $('switchCamera').addEventListener('click',async()=>{
    const previous=facing; facing=facing==='user'?'environment':'user';
    await startCamera();
    if (!stream) { facing=previous; toast('That camera is unavailable; the previous selection was kept.'); }
  });

  function clearPreview() {
    photo.classList.remove('visible'); video.classList.remove('visible'); audio.classList.remove('visible');
    video.pause(); audio.pause();
    for (const el of [video,audio]) { el.removeAttribute('src'); el.load(); }
    photo.removeAttribute('src');
    if(activeUrl){URL.revokeObjectURL(activeUrl);activeUrl=null;}
    $('mediaLayer').classList.add('hidden'); $('emptyState').classList.toggle('hidden',!!stream);
  }
  function showFile(file) {
    clearPreview(); activeUrl=URL.createObjectURL(file); $('mediaLayer').classList.remove('hidden'); $('emptyState').classList.add('hidden');
    if(file.type.startsWith('image/')) { photo.src=activeUrl; photo.classList.add('visible'); setStatus('mediaValue','Photo ready'); diagnose('Photo ready','The image is displayed locally on this device. It has not been uploaded to a server.'); }
    else if(file.type.startsWith('video/')) { video.src=activeUrl; video.classList.add('visible'); video.load(); video.play().then(()=>{setStatus('mediaValue','Video playing');diagnose('Video playing','Your prerecorded video is playing locally. This is a media preview, not a live camera call.');}).catch(()=>{setStatus('mediaValue','Tap Play');diagnose('Video ready','Your browser requires a user gesture. Press Play on the video controls.');}); }
    else if(file.type.startsWith('audio/')) { audio.src=activeUrl; audio.classList.add('visible'); audio.load(); setStatus('mediaValue','Audio ready'); diagnose('Audio ready','Your audio file is ready for local playback. Press Play to listen.'); }
    $('stageLabel').textContent='Personal media selected'; $('hideMedia').disabled=false;
  }
  function renderFiles() {
    const list=$('mediaList'); list.replaceChildren();
    if(!files.length){const p=document.createElement('p');p.className='muted';p.textContent='No media selected yet.';list.append(p);}
    files.forEach((file,index)=>{
      const row=document.createElement('div');row.className='media-item';
      const thumb=document.createElement('div');thumb.className='media-thumb';thumb.textContent=file.type.startsWith('image/')?'▧':file.type.startsWith('video/')?'▶':'♫';
      const meta=document.createElement('div');meta.className='media-meta';const name=document.createElement('b');name.textContent=file.name;const size=document.createElement('small');size.textContent=`${file.type.startsWith('image/')?'Photo':file.type.startsWith('video/')?'Video':'Audio'} · ${(file.size/1024/1024).toFixed(1)} MB`;meta.append(name,size);
      const use=document.createElement('button');use.className='btn';use.textContent='Preview';use.addEventListener('click',()=>showFile(file));row.append(thumb,meta,use);list.append(row);
    });
    $('clearMedia').disabled=!files.length; $('hideMedia').disabled=!activeUrl;
  }
  $('mediaInput').addEventListener('change',e=>{
    const incoming=Array.from(e.target.files||[]).filter(f=>f.type.startsWith('image/')||f.type.startsWith('video/')||f.type.startsWith('audio/'));
    if(!incoming.length){toast('Choose a supported image, video, or audio file');return;}
    files=[...files,...incoming];renderFiles();showFile(incoming[incoming.length-1]);dot('checkMedia','ok');toast(`${incoming.length} file(s) added`);e.target.value='';
  });
  $('clearMedia').addEventListener('click',()=>{files=[];clearPreview();renderFiles();setStatus('mediaValue','Ready');});
  $('hideMedia').addEventListener('click',()=>{clearPreview();renderFiles();toast('Media hidden');});

  async function runChecks() {
    const b=browserInfo(); const mediaApi=!!navigator.mediaDevices?.getUserMedia; const cameraApi=mediaApi && !!navigator.mediaDevices?.enumerateDevices; const microphoneApi=mediaApi; const rtc=typeof window.RTCPeerConnection==='function'; const recorder=typeof window.MediaRecorder==='function'; const notifications=('Notification' in window); const pip=!!document.pictureInPictureEnabled;
    $('browserSummary').textContent=`${b.name}${b.isIOS?' · iOS/iPadOS':''}`; dot('checkBrowser','ok');setStatus('browserValue',`${b.name}${b.isIOS?' (iOS)':''}`);
    dot('checkSecure',secure?'ok':'warn');setStatus('secureValue',secure?'Secure':'HTTPS needed');
    dot('checkCamera',cameraApi?'ok':'warn');setStatus('cameraValue',cameraApi?'Available':'Unavailable');
    dot('checkWebRTC',rtc?'ok':'warn');setStatus('webrtcValue',rtc?'Available':'Unavailable');
    dot('checkRecorder',recorder?'ok':'warn');setStatus('recorderValue',recorder?'Available':'Unavailable');
    if(!cameraApi)setStatus('permissionValue','Unavailable');
    else if(stream){dot('checkPermission','ok');setStatus('permissionValue','Granted');}
    else {try{const p=await navigator.permissions?.query({name:'camera'});if(p){setStatus('permissionValue',p.state==='prompt'?'Not requested':p.state[0].toUpperCase()+p.state.slice(1));dot('checkPermission',p.state==='granted'?'ok':p.state==='denied'?'warn':'');}else setStatus('permissionValue','Not exposed by browser');}catch{setStatus('permissionValue','Not exposed by browser');}}
    dot('checkMedia','ok'); if(!secure)diagnose('HTTPS is required','Deploy Bharul to an HTTPS host. Camera and microphone access are restricted on ordinary HTTP pages.');
    else if(!cameraApi)diagnose('Camera API unavailable','Update Safari or Edge and check browser settings. File previews may still work.');
    else if(!rtc)diagnose('WebRTC unavailable','This browser cannot create WebRTC connections. Local media previews remain available.');
    else diagnose('Browser checks complete',`${b.name}: camera ${cameraApi?'available':'unavailable'}, microphone ${microphoneApi?'API available':'unavailable'}, WebRTC ${rtc?'available':'unavailable'}, recording ${recorder?'available':'unavailable'}, notifications ${notifications?'supported':'not supported'}, picture-in-picture ${pip?'supported':'not supported'}. API availability does not mean permission is granted. Real calls still require a configured signaling service and STUN/TURN network relay settings.`);
  }
  $('runChecks').addEventListener('click',runChecks);
  $('openSite').addEventListener('click',()=>{let value=$('siteUrl').value.trim();if(!value){toast('Enter a website address first');return;}if(!/^https?:\/\//i.test(value))value='https://'+value;try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw new Error();window.open(u.href,'_blank','noopener,noreferrer');}catch{toast('Enter a valid website address');}});
  window.addEventListener('pagehide',()=>{if(stream)stream.getTracks().forEach(t=>t.stop());if(activeUrl)URL.revokeObjectURL(activeUrl);});
  if(navigator.mediaDevices?.addEventListener)navigator.mediaDevices.addEventListener('devicechange',()=>diagnose('Camera devices changed','A camera was connected or disconnected. Run diagnostics or restart the camera if needed.'));
  if('serviceWorker' in navigator && secure) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));


  // Real WebRTC call client. No fake connected state: the UI changes only on signaling/peer events.
  const CALL_SIGNAL_URL = window.BHARUL_SIGNAL_URL || '';
  let signal=null, peer=null, callStream=null, joinedRoom=null, isOfferer=false;
  let micEnabled=true, camEnabled=true;
  const callStatus=(s)=>{ $('callStatus').textContent=s; };
  const callHelp=(s)=>{ $('callHelp').textContent=s; };
  function callButtons(on){ $('toggleMic').disabled=!on; $('toggleCallCamera').disabled=!on; $('endCall').disabled=!on; }
  function sendSignal(payload){ if(!signal || signal.readyState!==WebSocket.OPEN) throw new Error('Signaling connection is not open.'); signal.send(JSON.stringify(payload)); }
  async function loadIceConfig(){
    const base=[{urls:['stun:stun.l.google.com:19302']}];
    if(!CALL_SIGNAL_URL) throw new Error('Signaling server URL is not configured. Deploy server/ and set window.BHARUL_SIGNAL_URL in config.js.');
    const httpUrl=CALL_SIGNAL_URL.replace(/^wss:/,'https:').replace(/^ws:/,'http:').replace(/\/$/,'')+'/ice-config';
    const response=await fetch(httpUrl,{cache:'no-store'}); if(!response.ok) throw new Error('Could not load ICE configuration from the signaling server.');
    const data=await response.json(); return data.iceServers?.length?data.iceServers:base;
  }
  async function startCallMedia(){
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera/microphone access.');
    if(!window.isSecureContext) throw new Error('Calls require HTTPS (or localhost for development).');
    callStream=await navigator.mediaDevices.getUserMedia({audio:true,video:{facingMode:{ideal:'user'}}});
    $('localCallVideo').srcObject=callStream; return callStream;
  }
  async function connectSignaling(room){
    const wsUrl=new URL(CALL_SIGNAL_URL); wsUrl.protocol=wsUrl.protocol==='https:'?'wss:':'ws:'; wsUrl.searchParams.set('room',room);
    signal=new WebSocket(wsUrl);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Signaling server connection timed out.')),10000);signal.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});signal.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Could not connect to the signaling server. Check its URL and deployment.'));},{once:true});});
    signal.addEventListener('message',async event=>{
      let msg; try{msg=JSON.parse(event.data)}catch{return;}
      try{
        if(msg.type==='peer-joined' && isOfferer){const offer=await peer.createOffer();await peer.setLocalDescription(offer);sendSignal({type:'offer',description:peer.localDescription});callStatus('Calling…');}
        else if(msg.type==='offer'){await peer.setRemoteDescription(msg.description);const answer=await peer.createAnswer();await peer.setLocalDescription(answer);sendSignal({type:'answer',description:peer.localDescription});callStatus('Connecting…');}
        else if(msg.type==='answer'){await peer.setRemoteDescription(msg.description);callStatus('Connecting…');}
        else if(msg.type==='ice-candidate' && msg.candidate){await peer.addIceCandidate(msg.candidate);}
        else if(msg.type==='peer-left'){callStatus('Other person left');callHelp('The other participant disconnected. You can end this call and create or join another room.');}
        else if(msg.type==='room-full'){callStatus('Room full');callHelp('This room already has two participants. Create a new room for a separate call.');}
        else if(msg.type==='error'){callHelp(msg.message||'Signaling server reported an error.');}
      }catch(err){callHelp('Call setup error: '+err.message);callStatus('Call error');}
    });
    signal.addEventListener('close',()=>{if(joinedRoom)callStatus('Signaling disconnected');});
    sendSignal({type:'join',room});
  }
  async function joinCall(room){
    if(joinedRoom) await endCall(false);
    room=String(room||'').trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40); if(room.length<4)throw new Error('Room code must contain at least 4 letters or numbers.');
    callHelp('Requesting microphone and camera permission…'); await startCallMedia();
    const iceServers=await loadIceConfig();
    peer=new RTCPeerConnection({iceServers}); callStream.getTracks().forEach(track=>peer.addTrack(track,callStream));
    peer.ontrack=e=>{ $('remoteCallVideo').srcObject=e.streams[0];callStatus('Connected');callHelp('A real WebRTC peer connection is active.');callButtons(true); };
    peer.onicecandidate=e=>{if(e.candidate && signal?.readyState===WebSocket.OPEN)sendSignal({type:'ice-candidate',candidate:e.candidate});};
    peer.onconnectionstatechange=()=>{if(!peer)return; if(peer.connectionState==='connected'){callStatus('Connected');callButtons(true);}else if(['failed','disconnected','closed'].includes(peer.connectionState)){callStatus(peer.connectionState==='failed'?'Connection failed':'Disconnected');}};
    joinedRoom=room; $('roomCode').value=room; await connectSignaling(room); callStatus('Waiting for other person');callHelp('Share room code “'+room+'” with one person. Waiting for them to join.'); callButtons(true);
  }
  async function endCall(show=true){
    if(signal){try{if(signal.readyState===WebSocket.OPEN)sendSignal({type:'leave'});signal.close();}catch{}signal=null;}
    if(peer){peer.ontrack=null;peer.onicecandidate=null;peer.close();peer=null;}
    if(callStream){callStream.getTracks().forEach(t=>t.stop());callStream=null;}
    $('localCallVideo').srcObject=null;$('remoteCallVideo').srcObject=null;joinedRoom=null;callButtons(false);callStatus('Not connected');
    if(show)callHelp('Call ended. Your camera and microphone have been stopped.');
  }
  $('createRoom').addEventListener('click',()=>{const code='bharul-'+Math.random().toString(36).slice(2,9);$('roomCode').value=code;callHelp('Room created. Share this code with one person, then join the room here.');});
  $('joinRoom').addEventListener('click',()=>joinCall($('roomCode').value).catch(err=>{callStatus('Not connected');callHelp(err.message);toast(err.message);}));
  $('endCall').addEventListener('click',()=>endCall());
  $('toggleMic').addEventListener('click',()=>{if(!callStream)return;micEnabled=!micEnabled;callStream.getAudioTracks().forEach(t=>t.enabled=micEnabled);$('toggleMic').textContent=micEnabled?'Mute mic':'Unmute mic';});
  $('toggleCallCamera').addEventListener('click',()=>{if(!callStream)return;camEnabled=!camEnabled;callStream.getVideoTracks().forEach(t=>t.enabled=camEnabled);$('toggleCallCamera').textContent=camEnabled?'Turn camera off':'Turn camera on';});
  window.addEventListener('pagehide',()=>{if(joinedRoom)endCall(false);});

  updateCameraUI(false); runChecks();
})();
