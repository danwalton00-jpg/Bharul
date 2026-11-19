(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const camera = $('camera'), photo = $('photoPreview'), video = $('videoPreview'), audio = $('audioPreview');
  let stream = null, facing = 'user', files = [], activeUrl = null, selectedFile = null, recorder = null, recordingChunks = [], recordingUrl = null, aiResultUrl = null;
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
    $('startCamera').disabled=on; $('switchCamera').disabled=!on; $('stopCamera').disabled=!on; $('startRecording').disabled=!on || typeof MediaRecorder!=='function' || !!recorder;
    camera.style.display=on?'block':'none'; $('emptyState').classList.toggle('hidden',on||!!activeUrl);
    $('stageLabel').textContent=on?'Live camera is running':(activeUrl?'Personal media selected':'Ready when you are');
  }
  async function startCamera() {
    if (!secure) { diagnose('Secure connection required','Camera and microphone access require HTTPS, except on localhost. Deploy Bharul to an HTTPS website, then try again.'); toast('Open Bharul using HTTPS'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { diagnose('Camera API unavailable','This browser or context does not expose camera access. Update Safari or Edge and check site permissions.'); dot('checkCamera','warn'); setStatus('cameraValue','Unavailable'); return; }
    stopCamera(false);
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}}});
      camera.srcObject=stream; await camera.play(); updateCameraUI(true); dot('checkCamera','ok'); setStatus('cameraValue','Available'); dot('checkPermission','ok'); setStatus('permissionValue','Granted');
      diagnose('Camera is working','Your browser granted camera access. You can keep the camera running while previewing a selected media file.');
    } catch(err) {
      updateCameraUI(false);
      const map={NotAllowedError:['Permission blocked','Allow camera access for Bharul in the browser site settings, then return and tap Start camera.'],NotFoundError:['No camera found','No available camera was detected. You can still preview uploaded media.'],NotReadableError:['Camera is busy','Another app or browser tab may be using the camera. Close it and retry.'],OverconstrainedError:['Camera mode unsupported','This camera does not support the requested mode. Try again with the default camera.'],SecurityError:['Secure connection required','Camera access requires HTTPS or localhost.']};
      const info=map[err.name]||['Could not start camera',`${err.name||'Camera error'}: ${err.message||'Check browser permissions and retry.'}`];
      diagnose(info[0],info[1]); dot('checkPermission','warn'); setStatus('permissionValue',err.name==='NotAllowedError'?'Blocked':'Needs attention'); toast(info[0]);
    }
  }
  function stopCamera(show=true) {
    if(recorder && recorder.state!=='inactive') recorder.stop();
    if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}
    camera.srcObject=null; updateCameraUI(false);
    if(show){diagnose('Camera stopped','The camera is no longer active. Your selected media can still be previewed.');toast('Camera stopped');}
  }
  $('startCamera').addEventListener('click',startCamera);
  $('stopCamera').addEventListener('click',()=>stopCamera());
  $('switchCamera').addEventListener('click',async()=>{facing=facing==='user'?'environment':'user';await startCamera();});

  function chooseRecorderMime() {
    if (!window.MediaRecorder) return '';
    const candidates = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
  }
  function startRecording() {
    if (!stream) { toast('Start the camera before recording'); return; }
    if (!window.MediaRecorder) { toast('Video recording is not supported in this browser'); return; }
    try {
      if (recordingUrl) { URL.revokeObjectURL(recordingUrl); recordingUrl=null; }
      $('downloadRecording').classList.add('hidden');
      recordingChunks=[];
      const mimeType=chooseRecorderMime();
      recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);
      recorder.addEventListener('dataavailable', event => { if(event.data && event.data.size) recordingChunks.push(event.data); });
      recorder.addEventListener('stop', () => {
        const type=recorder?.mimeType || mimeType || 'video/webm';
        const blob=new Blob(recordingChunks,{type});
        if(blob.size){
          recordingUrl=URL.createObjectURL(blob);
          const ext=type.includes('mp4')?'mp4':'webm';
          const link=$('downloadRecording'); link.href=recordingUrl; link.download=`bharul-recording-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`; link.classList.remove('hidden');
          $('recordStatus').textContent=`Recording ready · ${(blob.size/1024/1024).toFixed(1)} MB`;
          diagnose('Recording ready','Your video is saved temporarily in this page. Tap Save recording to download it to your device.');
          toast('Recording ready to save');
        } else { $('recordStatus').textContent='No video data captured'; toast('No video was recorded'); }
        recorder=null; recordingChunks=[]; $('startRecording').disabled=!stream; $('stopRecording').disabled=true;
      });
      recorder.start(1000); $('recordStatus').textContent='Recording…'; $('startRecording').disabled=true; $('stopRecording').disabled=false;
      diagnose('Recording in progress','Bharul is recording the camera stream locally. Tap Stop recording when finished.');
    } catch(err) { recorder=null; $('recordStatus').textContent='Recording unavailable'; toast(`Could not start recording: ${err.message||err.name}`); }
  }
  function stopRecording() {
    if(recorder && recorder.state!=='inactive'){ recorder.stop(); $('recordStatus').textContent='Preparing video…'; $('stopRecording').disabled=true; }
  }
  $('startRecording').addEventListener('click',startRecording);
  $('stopRecording').addEventListener('click',stopRecording);

  function setAIStatus(title, message) {
    const box=$('aiEditStatus'); box.replaceChildren(); const b=document.createElement('b'); b.textContent=title; const p=document.createElement('p'); p.textContent=message; box.append(b,p);
  }
  async function blobFromVideoFrame(el) {
    if (!el || !el.videoWidth || !el.videoHeight) throw new Error('Play or pause the video at the frame you want to edit first.');
    const canvas=document.createElement('canvas'); canvas.width=el.videoWidth; canvas.height=el.videoHeight;
    canvas.getContext('2d').drawImage(el,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not capture this video frame.')),'image/jpeg',0.92));
  }
  async function getImageForAI() {
    if (selectedFile && selectedFile.type.startsWith('image/')) return selectedFile;
    if (selectedFile && selectedFile.type.startsWith('video/')) return new File([await blobFromVideoFrame(video)],'bharul-video-frame.jpg',{type:'image/jpeg'});
    if (stream && camera.srcObject) return new File([await blobFromVideoFrame(camera)],'bharul-camera-frame.jpg',{type:'image/jpeg'});
    if (photo.src && photo.classList.contains('visible')) {
      const response=await fetch(photo.src); const blob=await response.blob(); return new File([blob],'bharul-selected-photo.jpg',{type:blob.type||'image/jpeg'});
    }
    throw new Error('Choose a photo, pause a video on a frame, or start the camera first.');
  }
  $('captureFrame').addEventListener('click',async()=>{
    try { let file; if(stream && camera.srcObject) file=new File([await blobFromVideoFrame(camera)],'bharul-camera-frame.jpg',{type:'image/jpeg'}); else if(selectedFile && selectedFile.type.startsWith('video/')) file=new File([await blobFromVideoFrame(video)],'bharul-video-frame.jpg',{type:'image/jpeg'}); else if(selectedFile && selectedFile.type.startsWith('image/')) file=selectedFile; else throw new Error('Start the camera, select a video and pause it, or choose a photo first.'); selectedFile=file; setAIStatus('Image ready',`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB. Describe your edit and tap AI edit selected image.`); toast('Image frame ready'); }
    catch(err){setAIStatus('Could not capture frame',err.message);toast(err.message);}
  });
  $('editWithAI').addEventListener('click',async()=>{
    const prompt=$('poseRequest').value.trim();
    if(!prompt){toast('Describe the image edit first');$('poseRequest').focus();return;}
    let imageFile;
    try { imageFile=await getImageForAI(); } catch(err){setAIStatus('Image required',err.message);toast(err.message);return;}
    if(!['image/jpeg','image/png','image/webp'].includes(imageFile.type)){setAIStatus('Unsupported image format','Use a JPG, PNG, or WEBP image.');return;}
    if(imageFile.size>10*1024*1024){setAIStatus('Image is too large','Choose an image smaller than 10 MB.');return;}
    const button=$('editWithAI'); button.disabled=true; $('aiResult').classList.add('hidden'); $('downloadAIResult').classList.add('hidden');
    setAIStatus('AI editing in progress','Uploading your selected still image securely to Bharul’s server. This can take a little while.');
    try {
      const form=new FormData(); form.append('image',imageFile,imageFile.name||'bharul-image.jpg'); form.append('prompt',prompt);
      const response=await fetch('/ai/edit-image',{method:'POST',body:form,credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error||`AI edit failed (${response.status})`);
      if(!data.image) throw new Error('The AI service returned no edited image.');
      if(aiResultUrl) URL.revokeObjectURL(aiResultUrl);
      const resultBlob=await (await fetch(data.image)).blob(); aiResultUrl=URL.createObjectURL(resultBlob);
      const result=$('aiResult'); result.src=aiResultUrl; result.classList.remove('hidden');
      const save=$('downloadAIResult'); save.href=aiResultUrl; save.download='bharul-ai-edited.png'; save.classList.remove('hidden');
      setAIStatus('AI edit complete','Review the generated image below. Save it to your device if you like the result.'); toast('AI image edit complete');
    } catch(err) { setAIStatus('AI edit could not complete',err.message||'Check the server AI configuration and try again.'); toast(err.message||'AI edit failed'); }
    finally { button.disabled=false; }
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
    selectedFile=file; clearPreview(); activeUrl=URL.createObjectURL(file); $('mediaLayer').classList.remove('hidden'); $('emptyState').classList.add('hidden');
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
    const b=browserInfo(); const cameraApi=!!navigator.mediaDevices?.getUserMedia; const rtc=typeof window.RTCPeerConnection==='function'; const recorderApi=typeof window.MediaRecorder==='function';
    $('browserSummary').textContent=`${b.name}${b.isIOS?' · iOS/iPadOS':''}`; dot('checkBrowser','ok');setStatus('browserValue',`${b.name}${b.isIOS?' (iOS)':''}`);
    dot('checkSecure',secure?'ok':'warn');setStatus('secureValue',secure?'Secure':'HTTPS needed');
    dot('checkCamera',cameraApi?'ok':'warn');setStatus('cameraValue',cameraApi?'Available':'Unavailable');
    dot('checkWebRTC',rtc?'ok':'warn');setStatus('webrtcValue',rtc?'Available':'Unavailable');
    dot('checkRecorder',recorderApi?'ok':'warn');setStatus('recorderValue',recorderApi?'Available':'Unavailable');
    if(!cameraApi)setStatus('permissionValue','Unavailable');
    else if(stream){dot('checkPermission','ok');setStatus('permissionValue','Granted');}
    else {try{const p=await navigator.permissions?.query({name:'camera'});if(p){setStatus('permissionValue',p.state==='prompt'?'Not requested':p.state[0].toUpperCase()+p.state.slice(1));dot('checkPermission',p.state==='granted'?'ok':p.state==='denied'?'warn':'');}else setStatus('permissionValue','Not exposed by browser');}catch{setStatus('permissionValue','Not exposed by browser');}}
    dot('checkMedia','ok'); if(!secure)diagnose('HTTPS is required','Deploy Bharul to an HTTPS host. Camera and microphone access are restricted on ordinary HTTP pages.');
    else if(!cameraApi)diagnose('Camera API unavailable','Update Safari or Edge and check browser settings. File previews may still work.');
    else if(!rtc)diagnose('WebRTC unavailable','This browser cannot create WebRTC connections. Local media previews remain available.');
    else diagnose('Browser checks complete',`${b.name} exposes camera ${cameraApi?'and':'but not'} WebRTC ${rtc?'APIs':'APIs'}. Real calls still require a configured signaling service and network relay settings.`);
  }
  $('runChecks').addEventListener('click',runChecks);
  $('openSite').addEventListener('click',()=>{let value=$('siteUrl').value.trim();if(!value){toast('Enter a website address first');return;}if(!/^https?:\/\//i.test(value))value='https://'+value;try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw new Error();window.open(u.href,'_blank','noopener,noreferrer');}catch{toast('Enter a valid website address');}});
  window.addEventListener('pagehide',()=>{if(stream)stream.getTracks().forEach(t=>t.stop());if(activeUrl)URL.revokeObjectURL(activeUrl);if(aiResultUrl)URL.revokeObjectURL(aiResultUrl);if(recordingUrl)URL.revokeObjectURL(recordingUrl);if(recorder&&recorder.state!=='inactive')recorder.stop();});
  if(navigator.mediaDevices?.addEventListener)navigator.mediaDevices.addEventListener('devicechange',()=>diagnose('Camera devices changed','A camera was connected or disconnected. Run diagnostics or restart the camera if needed.'));
  if('serviceWorker' in navigator && secure) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  $('startRecording').disabled=typeof window.MediaRecorder!=='function';
  if(typeof window.MediaRecorder!=='function') $('recordStatus').textContent='Recording unsupported in this browser';
  updateCameraUI(false); runChecks();

  // Real one-to-one WebRTC calling, using the existing /signal WebSocket and /ice-config endpoint.
  const call = { ws:null, pc:null, local:null, room:'', muted:false, cameraOff:false, pendingIce:[] };
  const callStatus = (message) => { $('callStatus').textContent = message; };
  const callBadge = (message, kind='neutral') => { $('callBadge').textContent=message; $('callBadge').className='status '+kind; };
  const callSend = (payload) => {
    if (!call.ws || call.ws.readyState !== WebSocket.OPEN) throw new Error('Call signaling is not connected.');
    call.ws.send(JSON.stringify(payload));
  };
  async function preparePeerConnection() {
    const response=await fetch('/ice-config',{cache:'no-store'});
    if(!response.ok) throw new Error('Could not load call network settings.');
    const config=await response.json();
    call.pc=new RTCPeerConnection({iceServers:config.iceServers||[{urls:'stun:stun.l.google.com:19302'}]});
    call.pendingIce=[];
    call.pc.onicecandidate=e=>{if(e.candidate && call.ws?.readyState===WebSocket.OPEN)callSend({type:'ice-candidate',candidate:e.candidate.toJSON()});};
    call.pc.ontrack=e=>{const remote=$('remoteCallVideo');if(e.streams[0])remote.srcObject=e.streams[0];callStatus('Connected · live media received');callBadge('Connected','good');};
    call.pc.onconnectionstatechange=()=>{
      const state=call.pc?.connectionState;
      if(state==='connected'){callStatus('Connected · encrypted peer-to-peer media');callBadge('Connected','good');}
      else if(state==='connecting'){callStatus('Connecting media…');callBadge('Connecting');}
      else if(state==='failed'){callStatus('Connection failed. A TURN relay may be required on this network.');callBadge('Connection issue','bad');}
      else if(state==='disconnected'){callStatus('Connection interrupted. Waiting for network recovery…');callBadge('Reconnecting');}
    };
    call.local.getTracks().forEach(track=>call.pc.addTrack(track,call.local));
  }
  async function flushPendingIce() {
    if(!call.pc?.remoteDescription)return;
    for(const candidate of call.pendingIce.splice(0)){try{await call.pc.addIceCandidate(candidate);}catch(err){console.warn('Could not add queued ICE candidate',err);}}
  }
  async function handleCallSignal(message) {
    if(message.type==='joined'){callStatus(message.participants===2?'Peer is in the room · connecting…':'Room ready · waiting for the other person');callBadge('Waiting');return;}
    if(message.type==='peer-joined'){
      callStatus('Other person joined · creating secure connection…');
      const offer=await call.pc.createOffer();await call.pc.setLocalDescription(offer);callSend({type:'offer',description:call.pc.localDescription});return;
    }
    if(message.type==='offer'){
      await call.pc.setRemoteDescription(message.description);await flushPendingIce();
      const answer=await call.pc.createAnswer();await call.pc.setLocalDescription(answer);callSend({type:'answer',description:call.pc.localDescription});return;
    }
    if(message.type==='answer'){await call.pc.setRemoteDescription(message.description);await flushPendingIce();return;}
    if(message.type==='ice-candidate'){
      if(call.pc?.remoteDescription){try{await call.pc.addIceCandidate(message.candidate);}catch(err){console.warn('ICE candidate rejected',err);}}
      else call.pendingIce.push(message.candidate);
      return;
    }
    if(message.type==='peer-left'){callStatus('The other person left the call. You can keep the room open or end it.');callBadge('Peer left');$('remoteCallVideo').srcObject=null;return;}
    if(message.type==='room-full'){callStatus('This room already has two participants.');callBadge('Room full','bad');await endCall(false);return;}
    if(message.type==='error'){callStatus(message.message||'Call signaling error');callBadge('Error','bad');}
  }
  async function startCall() {
    if(!secure){toast('Calls require HTTPS');return;}
    if(!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.WebSocket){toast('This browser does not support WebRTC calling');return;}
    const button=$('startCall');button.disabled=true;
    try{
      const room=($('callRoom').value.trim()||('bharul-'+Math.random().toString(36).slice(2,10))).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
      if(room.length<6)throw new Error('Room code must contain at least 6 letters or numbers.');
      $('callRoom').value=room;call.room=room;
      callStatus('Requesting microphone and camera permission…');callBadge('Starting');
      call.local=await navigator.mediaDevices.getUserMedia({audio:true,video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}}});
      $('localCallVideo').srcObject=call.local;
      await preparePeerConnection();
      const wsUrl=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/signal';
      call.ws=new WebSocket(wsUrl);
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Signaling server did not respond. Try again.')),10000);
        call.ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
        call.ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Could not connect to the Bharul signaling server.'));},{once:true});
      });
      call.ws.addEventListener('message',async event=>{try{await handleCallSignal(JSON.parse(event.data));}catch(err){console.error(err);callStatus('Call setup error: '+err.message);callBadge('Error','bad');}});
      call.ws.addEventListener('close',()=>{if(call.pc)callStatus('Signaling connection closed.');});
      callSend({type:'join',room});
      $('toggleCallMic').disabled=false;$('toggleCallCamera').disabled=false;$('endCall').disabled=false;$('copyCallLink').disabled=false;
      $('toggleCallMic').textContent='Mute microphone';$('toggleCallCamera').textContent='Turn camera off';
      const invite=new URL(location.href);invite.searchParams.set('room',room);history.replaceState(null,'',invite.href);
      callStatus('Room created · share the invite link');callBadge('Waiting');
    }catch(err){
      callStatus(err.message||'Could not start call');callBadge('Not connected','bad');toast(err.message||'Could not start call');
      await endCall(false);
    }finally{button.disabled=false;}
  }
  async function endCall(sendLeave=true) {
    try{if(sendLeave&&call.ws?.readyState===WebSocket.OPEN)callSend({type:'leave'});}catch{}
    if(call.ws){call.ws.close();call.ws=null;}
    if(call.pc){call.pc.ontrack=null;call.pc.onicecandidate=null;call.pc.close();call.pc=null;}
    if(call.local){call.local.getTracks().forEach(track=>track.stop());call.local=null;}
    $('localCallVideo').srcObject=null;$('remoteCallVideo').srcObject=null;
    $('toggleCallMic').disabled=true;$('toggleCallCamera').disabled=true;$('endCall').disabled=true;$('copyCallLink').disabled=true;
    $('startCall').disabled=false;call.pendingIce=[];call.muted=false;call.cameraOff=false;
    callStatus('Not in a call');callBadge('Ready');
  }
  $('startCall').addEventListener('click',startCall);
  $('endCall').addEventListener('click',()=>endCall(true));
  $('toggleCallMic').addEventListener('click',()=>{
    if(!call.local)return;call.muted=!call.muted;call.local.getAudioTracks().forEach(t=>t.enabled=!call.muted);
    $('toggleCallMic').textContent=call.muted?'Unmute microphone':'Mute microphone';
  });
  $('toggleCallCamera').addEventListener('click',()=>{
    if(!call.local)return;call.cameraOff=!call.cameraOff;call.local.getVideoTracks().forEach(t=>t.enabled=!call.cameraOff);
    $('toggleCallCamera').textContent=call.cameraOff?'Turn camera on':'Turn camera off';
  });
  $('copyCallLink').addEventListener('click',async()=>{
    const invite=new URL(location.href);invite.searchParams.set('room',call.room);
    try{await navigator.clipboard.writeText(invite.href);toast('Call invite link copied');}
    catch{callStatus('Copy unavailable. Share this page URL with room code: '+call.room);}
  });
  const initialRoom=new URLSearchParams(location.search).get('room');
  if(initialRoom && /^[a-zA-Z0-9_-]{6,40}$/.test(initialRoom))$('callRoom').value=initialRoom;
  window.addEventListener('pagehide',()=>{if(call.local)call.local.getTracks().forEach(track=>track.stop());if(call.pc)call.pc.close();if(call.ws)call.ws.close();});

})();
